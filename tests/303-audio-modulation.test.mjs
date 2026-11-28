import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createServer } from 'vite'

function fakeTone() {
  const oscillators = []
  class Param {
    inputs = []
    value = 0
    rampTo(value) { this.value = value }
    read() { return this.inputs.length ? this.inputs.reduce((sum, node) => sum + node.read(), 0) : this.value }
  }
  class Node {
    inputs = []
    disposed = false
    connect(target) {
      target.inputs.push(this)
      if (target instanceof Signal || target instanceof Param) {
        target.value = 0
        if (target instanceof Signal) target.overridden = true
      }
      return this
    }
    disconnect(target) { target.inputs = target.inputs.filter((node) => node !== this); return this }
    toDestination() { return this }
    dispose() { this.disposed = true; return this }
    read() { return this.inputs.reduce((sum, node) => sum + node.read(), 0) }
  }
  class Gain extends Node {
    constructor(value = 1) { super(); this.gain = new Param(); this.gain.value = value }
    read() { return super.read() * this.gain.read() }
  }
  class Signal extends Node {
    constructor(value = 0) { super(); this.value = value; this.overridden = false }
    read() { return this.inputs.length ? super.read() : this.value }
  }
  class Add extends Node {
    constructor(value) { super(); this.addend = new Param(); this.addend.value = value }
    read() { return super.read() + this.addend.read() }
  }
  class Multiply extends Node {
    constructor(value) { super(); this.factor = new Param(); this.factor.value = value }
    read() { return super.read() * this.factor.read() }
  }
  class WaveShaper extends Node {
    constructor(map) { super(); this.map = map }
    read() { return this.map(Math.max(-1, Math.min(1, super.read()))) }
  }
  class LFO extends Node {
    constructor(options) {
      super()
      this.context = { now: () => 0, currentTime: 0, state: 'running' }
      this.frequency = new Signal(options.frequency)
      this.value = 0
      oscillators.push(this)
    }
    start() { return this }
    read() { return this.value }
  }
  class Waveform extends Node {
    constructor() { super(); this.context = { state: 'running' } }
    getValue() { return new Float32Array([super.read()]) }
  }
  class Filter extends Node { constructor() { super(); this.frequency = new Signal(); this.Q = new Signal() } }
  class FrequencyEnvelope extends Node {
    constructor(options) { super(); Object.assign(this, options); this.level = 0 }
    read() { return this.baseFrequency * (1 + (2 ** this.octaves - 1) * this.level ** 2) }
  }
  class MonoSynth extends Node {
    constructor(options) {
      super()
      this.filter = new Filter()
      this.filterEnvelope = new FrequencyEnvelope(options.filterEnvelope)
      this.filterEnvelope.connect(this.filter.frequency)
      this.envelope = { ...options.envelope }
      this.volume = new Param()
    }
  }
  class FeedbackDelay extends Node {}
  class Reverb extends Node {}
  class Envelope extends Node {}
  return { ToneAudioNode: Node, Gain, Signal, Add, Multiply, WaveShaper, LFO, Waveform,
    Filter, FeedbackDelay, Reverb, Envelope, MonoSynth, oscillators }
}

async function loadCommonJs(path, modules) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => {
    if (!(name in modules)) throw new Error(`Unexpected import: ${name}`)
    return modules[name]
  } })
  return module.exports
}

test('303 audio-rate base frequency preserves the filter envelope', async () => {
  const tone = fakeTone()
  const { Bass303 } = await loadCommonJs('../src/instruments/Bass303.ts', {
    tone, './defaultEnvelope': { defaultEnvelope: () => ({ attack: 0, decay: 0, sustain: 1, release: 0 }) },
  })
  const instrument = new Bass303({ filterFrequency: 500, filterAmount: 0.5 })
  const synth = instrument.synth
  const source = new tone.Signal(1200)
  instrument.setFilterFrequencySignal(source)
  for (const level of [0, 0.5, 1]) {
    synth.filterEnvelope.level = level
    assert.equal(synth.filter.frequency.read(), 1200 * (1 + (4 - 1) * level ** 2))
  }
  instrument.updateParameter('filterAmount', 1)
  synth.filterEnvelope.level = 0.5
  assert.equal(synth.filter.frequency.read(), 1200 * (1 + (16 - 1) * 0.25))
  instrument.updateParameter('filterFrequency', 700)
  assert.equal(synth.filter.frequency.read(), 1200 * (1 + (16 - 1) * 0.25))
  source.value = 700
  assert.equal(synth.filter.frequency.read(), 700 * (1 + (16 - 1) * 0.25))
  instrument.dispose()
  assert.equal(instrument.filterScale.disposed, true)
  assert.equal(instrument.filterScale.factor.inputs.length, 0)
})

test('303 modulation graph follows mapped LFO and restores control-rate fallback', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const routes = await server.ssrLoadModule('/src/audio/audioRoutes.ts')
    const modulation = await server.ssrLoadModule('/src/modulation.ts')
    const parameters = await server.ssrLoadModule('/src/parameters.ts')
    const tone = fakeTone()
    const { BankAudio } = await loadCommonJs('../src/audio/bankAudio.ts', {
      tone, '../audio/audioRoutes': routes, './audioRoutes': routes,
      '../modulation': modulation, '../parameters': parameters,
    })
    const graph = new BankAudio((error) => { throw new Error(error) })
    const lfo = createControl('lfo', 0, 0, 'lfo')
    const knob = createControl('knob', 1, 0, 'knob')
    const pad = createControl('pad', 2, 0, 'instrument-pad', '303')
    const layout = { columns: 3, rows: 1, items: [lfo, knob, pad], connections: [
      { id: 'a', sourceId: 'lfo', sourceParameter: 'value', targetId: 'knob', targetParameter: 'value' },
      { id: 'b', sourceId: 'knob', sourceParameter: 'value', targetId: 'pad', targetParameter: 'filterFrequency' },
    ] }
    graph.update(layout)
    const frequency = graph.getInstrumentFilterFrequency('pad')
    assert.equal(graph.isModulationDriven('pad', 'filterFrequency'), true)
    assert.equal(graph.hasModulationMonitor('knob'), true)
    for (const wave of [-1, -0.5, 0, 0.5, 1]) {
      tone.oscillators[0].value = wave
      const expected = modulation.effectiveControls(layout, new Map([['lfo:value', wave]]))
        .find((item) => item.id === 'pad').settings.instrumentParams.filterFrequency
      assert.ok(Math.abs(frequency.read() - expected) < 1e-6)
    }
    graph.setInstrumentFilterFrequency('pad', 777)
    assert.notEqual(frequency.read(), 777)
    assert.equal(frequency.value, 0)
    graph.update(layout, [], { boundaryInputs: new Set(['pad:filterFrequency']) })
    assert.equal(graph.isModulationDriven('pad', 'filterFrequency'), false)
    assert.equal(frequency.read(), 777)
    graph.setInstrumentFilterFrequency('pad', 1234)
    assert.equal(frequency.read(), 1234)
    graph.update(layout)
    assert.equal(graph.isModulationDriven('pad', 'filterFrequency'), true)
    lfo.settings.smoothness = 0.5
    graph.update(layout)
    assert.equal(graph.isModulationDriven('pad', 'filterFrequency'), false)
    assert.equal(frequency.read(), 1234)
    lfo.settings.smoothness = 0
    graph.update(layout)
    assert.equal(graph.isModulationDriven('pad', 'filterFrequency'), true)
    layout.connections.pop()
    graph.update(layout)
    assert.equal(graph.isModulationDriven('pad', 'filterFrequency'), false)
    assert.equal(frequency.read(), 1234)
    graph.dispose()
    assert.equal(frequency.disposed, true)
  } finally { await server.close() }
})

test('mixed LFO routes retain reactive output instead of bypassing unsupported targets', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  const scope = vue.effectScope()
  try {
    const modules = {}
    for (const [key, path] of [
      ['../grid', '/src/grid.ts'], ['../parameters', '/src/parameters.ts'],
      ['../modulation', '/src/modulation.ts'], ['../sequencedLoop', '/src/sequencedLoop.ts'],
      ['../audio/audioRoutes', '/src/audio/audioRoutes.ts'], ['../audio/toneOscillator', '/src/audio/toneOscillator.ts'],
      ['../music', '/src/music.ts'],
    ]) modules[key] = await server.ssrLoadModule(path)
    const { createControl } = modules['../grid']
    const lfo = createControl('lfo', 0, 0, 'lfo')
    const knob = createControl('knob', 1, 0, 'knob')
    const pad = createControl('pad', 2, 0, 'instrument-pad', '303')
    const props = vue.reactive({ layout: { columns: 3, rows: 1, items: [lfo, knob, pad], connections: [
      { id: 'a', sourceId: 'lfo', sourceParameter: 'value', targetId: 'knob', targetParameter: 'value' },
      { id: 'b', sourceId: 'knob', sourceParameter: 'value', targetId: 'pad', targetParameter: 'filterFrequency' },
    ] }, editing: false, wiring: false, settingsOpen: false, volumeMode: false, bpm: 120 })
    let beforeMount
    const vueMock = { ...vue, onBeforeMount: (callback) => { beforeMount = callback },
      onMounted: () => {}, onBeforeUnmount: () => {}, onUnmounted: () => {} }
    modules['../audio/bankAudio'] = { BankAudio: class {
      update() { return false }
      hasModulationMonitor(id) { return id === 'knob' }
      isModulationDriven(id, parameter) { return id === 'pad' && parameter === 'filterFrequency' }
      getModulationSample() { return 64 }
      dispose() {}
    } }
    modules['./useGridInteraction'] = { useGridInteraction: () => ({ interaction: vue.ref(null), dropAction: vue.ref(null) }) }
    modules['./useGridPlayback'] = { useGridPlayback: (options) => ({
      effectiveSignals: vue.computed(() => new Map(options.signals)),
      automationItems: vue.computed(() => options.layout().items),
      displayItems: vue.computed(() => options.layout().items),
      displayedAutomation: () => undefined, liveControls: new Set(),
      recordedNotes: () => [],
      loopPlayheads: vue.ref(new Map()), loopEditorPlayheads: vue.ref(new Map()),
    }) }
    const source = await readFile(new URL('../src/components/GrooveGrid.vue', import.meta.url), 'utf8')
    const script = compileScript(parse(source).descriptor, { id: 'grid' }).content
    const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const module = { exports: {} }
    vm.runInNewContext(code, { module, exports: module.exports, console, clearTimeout, setTimeout, performance,
      require: (path) => path === 'vue' ? vueMock : modules[path] ?? { default: {} } })
    const api = scope.run(() => module.exports.default.setup(props, { emit() {}, expose() {} }))
    beforeMount()
    api.publishLfo(lfo, 0.5, true)
    assert.equal(api.signals.has('lfo:value'), false)
    props.layout.connections.push({ id: 'c', sourceId: 'lfo', sourceParameter: 'value',
      targetId: 'pad', targetParameter: 'filterAmount' })
    await vue.nextTick()
    api.publishLfo(lfo, 0.5, true)
    assert.equal(api.signals.get('lfo:value'), 0.5)
  } finally {
    scope.stop()
    await server.close()
  }
})
