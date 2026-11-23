import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { createServer } from 'vite'

test('all instruments expose sound settings to numeric sources and resolve without changing saved settings', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { inputs, isCompatible } = await server.ssrLoadModule('/src/parameters.ts')
    const { effectiveControls } = await server.ssrLoadModule('/src/modulation.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const lfo = createControl('lfo', 0, 0, 'lfo')
    const knob = createControl('knob', 1, 0, 'knob')
    const wheel = createControl('wheel', 2, 0, 'mod-wheel')
    const cases = [
      ['sample-hit', ['volume', 'pitch', 'envelope.attack', 'envelope.decay', 'envelope.sustain', 'envelope.release', 'playback', 'loopMode', 'reverse']],
      ['sample-loop', ['volume', 'pitch', 'envelope.attack', 'envelope.decay', 'envelope.sustain', 'envelope.release', 'playback']],
      ['303', ['transpose', 'resonance', 'volume', 'slideTime', 'filterFrequency', 'filterAmount', 'envelope.attack', 'filterEnvelope.release']],
      ['808', ['drum', 'pitch', 'volume', 'tonality', 'tone', 'envelope.attack', 'envelope.release']],
      ['909', ['drum', 'pitch', 'volume', 'tonality', 'tone', 'envelope.attack', 'envelope.release']],
    ]
    for (const [type, expected] of cases) {
      const pad = createControl('pad', 3, 0, 'instrument-pad', type)
      const original = JSON.stringify(pad)
      for (const parameter of expected) {
        assert.ok(inputs(pad).some((input) => input.id === parameter), `${type}: ${parameter}`)
        for (const source of [lfo, knob, wheel]) {
          assert.equal(isCompatible(source, 'value', pad, parameter), true, `${type}: ${parameter}`)
        }
      }
      const wire = { id: 'wire', sourceId: lfo.id, sourceParameter: 'value', targetId: pad.id, targetParameter: 'volume' }
      const layout = { columns: 4, rows: 1, items: [lfo, knob, wheel, pad], connections: [wire] }
      const signals = new Map([['lfo:value', 1]])
      const effective = () => effectiveControls(layout, signals).find((item) => item.id === pad.id)
      assert.equal(effective().settings.instrumentParams.volume, 0)
      wire.sourceId = knob.id
      assert.equal(effective().settings.instrumentParams.volume, 0)
      wire.sourceId = wheel.id
      signals.set('wheel:value', 0)
      assert.equal(effective().settings.instrumentParams.volume, -48)
      wire.sourceId = lfo.id
      wire.targetParameter = 'envelope.attack'
      assert.equal(effective().settings.instrumentParams.envelope.attack, 1)
      if (type === '808' || type === '909') {
        wire.targetParameter = 'drum'
        assert.equal(effective().settings.instrumentParams.drum, 'tom')
      }
      if (type === 'sample-hit') {
        wire.targetParameter = 'playback'
        assert.equal(effective().settings.instrumentParams.playback, 'loop')
        assert.equal(effective().settings.instrumentParams.loopMode, 'loop')
        wire.targetParameter = 'reverse'
        assert.equal(effective().settings.instrumentParams.reverse, true)
        pad.settings.instrumentParams.playback = 'loop'
        pad.settings.instrumentParams.loopMode = 'loop'
        wire.targetParameter = 'loopMode'
        assert.equal(effective().settings.instrumentParams.loopMode, 'back-and-forth')
        pad.settings.instrumentParams.playback = 'order'
        pad.settings.instrumentParams.loopMode = 'once'
      }
      assert.equal(JSON.stringify(pad), original)
      const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout }] }
      assert.equal(isSavedProject(JSON.parse(JSON.stringify(project))), true)
    }
  } finally {
    await server.close()
  }
})

test('new instrument envelopes isolate state and drum-kit defaults stay short', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { InstrumentFactory } = await server.ssrLoadModule('/src/instruments/index.ts')
    for (const type of ['sample-hit', 'sample-loop', '303', '808', '909']) {
      const first = InstrumentFactory.getDefaultParams(type)
      const second = InstrumentFactory.getDefaultParams(type)
      if (type === '808' || type === '909') {
        assert.deepEqual(first.envelope, { attack: 0.001, decay: 0.25, sustain: 0, release: 0.05 })
        assert.deepEqual(second.envelope, { attack: 0.001, decay: 0.25, sustain: 0, release: 0.05 })
      } else {
        assert.equal(first.envelope.sustain, 1)
        assert.equal(first.envelope.release, 0.5)
        first.envelope.sustain = 0.25
        assert.equal(second.envelope.sustain, 1)
      }
      if (type === '303') {
        assert.equal(second.filterEnvelope.sustain, 1)
        assert.equal(second.filterEnvelope.release, 0.5)
        second.envelope.sustain = 0.3
        assert.equal(second.filterEnvelope.sustain, 1)
      }
    }
  } finally {
    await server.close()
  }
})

test('808 and 909 use bounded, instrument-specific drum voices', async () => {
  const source = await readFile(new URL('../src/instruments/DrumKit.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
  const voices = []
  class Node {
    constructor(options = {}) {
      this.envelope = { ...(options.envelope || {}) }
      this.calls = []
      this.frequency = { setValueAtTime() {} }
      this.gain = { rampTo() {} }
      this.disposed = false
      voices.push(this)
    }
    connect() { return this }
    toDestination() { return this }
    triggerAttackRelease(...args) { this.calls.push(args) }
    dispose() { this.disposed = true }
  }
  const nodeType = (kind) => class extends Node {
    constructor(options) { super(options); this.kind = kind }
  }
  const tone = {
    now: () => 1,
    Gain: nodeType('gain'),
    Filter: nodeType('filter'),
    MembraneSynth: nodeType('membrane'),
    MetalSynth: nodeType('metal'),
    NoiseSynth: nodeType('noise'),
    Synth: nodeType('synth'),
  }
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports,
    require: (name) => name === 'tone' ? tone : { defaultEnvelope: () => ({ attack: 0.001, decay: 0.25, sustain: 0, release: 0.05 }) } })
  const drum = new module.exports.DrumKit({}, '808')
  assert.deepEqual(voices.map((voice) => voice.kind), ['gain', 'membrane'])
  const initialVoice = drum.voice
  drum.updateParameter('drum', 'kick')
  assert.equal(drum.voice, initialVoice)
  const kick = drum.voice.membrane
  drum.trigger(127)
  assert.deepEqual(kick.calls[0], [50, 0.45, 1, 1])
  const kickNodeCount = voices.length
  for (let index = 0; index < 1000; index++) drum.trigger(127)
  assert.equal(voices.length, kickNodeCount)
  drum.updateParameter('drum', 'snare')
  assert.equal(kick.disposed, true)
  drum.trigger(127)
  assert.deepEqual(drum.voice.body.calls[0], [180, 0.16, 1, 1])
  assert.deepEqual(drum.voice.noise.synth.calls[0], [0.2, 1, 0.5])
  drum.updateParameter('drum', 'closed-hat')
  drum.trigger(127)
  assert.deepEqual(drum.voice.synth.calls[0], [250, 0.055, 1, 1])
  const hat = drum.voice.synth
  const hatNodeCount = voices.length
  drum.updateParameter('drum', 'open-hat')
  drum.trigger(127)
  assert.equal(drum.voice.synth, hat)
  assert.equal(voices.length, hatNodeCount)
  assert.deepEqual(hat.calls[1], [250, 0.32, 1, 1])
  drum.updateParameter('envelope.decay', 0.1)
  drum.updateParameter('drum', 'kick')
  drum.trigger(127)
  assert.deepEqual(drum.voice.membrane.calls[0], [50, 0.2, 1, 1])
  const drum909 = new module.exports.DrumKit({}, '909')
  drum909.trigger(127)
  assert.deepEqual(drum909.voice.click.synth.calls[0], [0.025, 1, 1])
  drum909.updateParameter('drum', 'snare')
  drum909.trigger(127)
  assert.deepEqual(drum909.voice.body.calls[0], [198.00000000000003, 0.16, 1, 1])
  assert.deepEqual(drum909.voice.noise.synth.calls[0], [0.2, 1, 0.625])
})
