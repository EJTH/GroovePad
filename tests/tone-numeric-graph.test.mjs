import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { createServer } from 'vite'

test('numeric audio graph combines sources, follows automation, and releases routes', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const routes = await server.ssrLoadModule('/src/audio/audioRoutes.ts')
    const modulation = await server.ssrLoadModule('/src/modulation.ts')
    const parameters = await server.ssrLoadModule('/src/parameters.ts')
    const source = await readFile(new URL('../src/audio/bankAudio.ts', import.meta.url), 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const oscillators = []
    const nodes = []
    class Param {
      inputs = []
      value = 0
      rampTo(value) { this.value = value }
      read() { return this.inputs.length ? this.inputs.reduce((sum, node) => sum + node.read(), 0) : this.value }
    }
    class Node {
      inputs = []
      disposed = false
      constructor() { nodes.push(this) }
      connect(target) {
        target.inputs.push(this)
        if (target instanceof Signal) { target.value = 0; target.overridden = true }
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
      rampTo(value) { this.value = this.overridden ? 0 : value }
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
        this.frequency = new Signal()
        this.frequency.value = options.frequency
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
    class FeedbackDelay extends Node {}
    class Reverb extends Node {}
    class Envelope extends Node {}
    const tone = { ToneAudioNode: Node, Gain, Signal, Add, Multiply, WaveShaper, LFO, Waveform,
      Filter, FeedbackDelay, Reverb, Envelope }
    const module = { exports: {} }
    vm.runInNewContext(code, { module, exports: module.exports,
      require: (name) => name === 'tone' ? tone : name === '../modulation' ? modulation :
        name === '../parameters' ? parameters : routes })
    const graph = new module.exports.BankAudio((error) => { throw new Error(error) })
    const lfo = createControl('lfo', 0, 0, 'lfo')
    const knob = createControl('knob', 1, 0, 'knob')
    const wheel = createControl('wheel', 2, 0, 'mod-wheel')
    const filter = createControl('filter', 3, 0, 'tone-element')
    filter.settings.elementType = 'filter'
    const layout = { columns: 4, rows: 1, items: [lfo, knob, wheel, filter], connections: [
      { id: 'a', sourceId: 'lfo', sourceParameter: 'value', targetId: 'knob', targetParameter: 'value',
        mappingMode: 'abs', absoluteMin: 20, absoluteMax: 100 },
      { id: 'b', sourceId: 'knob', sourceParameter: 'value', targetId: 'filter', targetParameter: 'cutoff' },
      { id: 'c', sourceId: 'wheel', sourceParameter: 'value', targetId: 'filter', targetParameter: 'cutoff',
        mappingMode: 'mod', modulationMin: 0, modulationMax: 10 },
    ] }
    const signals = new Map([['wheel:value', 0.25]])
    graph.update(layout, [], { signals })
    const param = graph.getInput('filter').frequency
    const sample = (value) => {
      oscillators[0].value = value
      const expected = modulation.effectiveControls(layout, new Map([...signals, ['lfo:value', value]]))
        .find((item) => item.id === 'filter').settings.cutoff
      assert.ok(Math.abs(param.read() - expected) < 1e-6, `${param.read()} != ${expected}`)
    }
    sample(-1)
    sample(0)
    sample(1)
    assert.ok(Math.abs(graph.getModulationSample('knob') - 100) < 1e-5)
    signals.set('wheel:value', 0.8)
    graph.update(layout, [], { signals })
    sample(0)
    const original = oscillators[0]
    filter.settings.gain = 0.7
    graph.update(layout, [], { signals })
    assert.equal(oscillators[0], original)
    assert.equal(original.disposed, false)
    sample(0)
    graph.update(layout, [], { signals, boundaryInputs: new Set(['filter:cutoff']),
      toneSettings: new Map([['filter', { ...filter.settings, cutoff: 1234 }]]) })
    assert.equal(param.inputs.length, 0)
    assert.equal(param.value, 1234)
    assert.equal(param.overridden, false)

    layout.connections = [
      { id: 'depth', sourceId: 'lfo', sourceParameter: 'value', targetId: 'wheel', targetParameter: 'depth' },
      { id: 'output', sourceId: 'wheel', sourceParameter: 'value', targetId: 'filter', targetParameter: 'cutoff' },
    ]
    wheel.settings.depth = 0
    signals.set('wheel:value', 0)
    const wheelPositions = new Map([['wheel', 0.5]])
    graph.update(layout, [], { signals, wheelPositions })
    for (const [wave, depth] of [[-1, 0], [0, 0.5], [1, 1]]) {
      original.value = wave
      assert.ok(Math.abs(param.read() - (20 + 19980 * depth * 0.5)) < 1e-6)
    }
    wheelPositions.set('wheel', 0.8)
    graph.update(layout, [], { signals, wheelPositions })
    original.value = 1
    assert.ok(Math.abs(param.read() - (20 + 19980 * 0.8)) < 1e-6)
    signals.set('wheel:value', 0.2)
    graph.update(layout, [], { signals, wheelPositions, automatedWheels: new Set(['wheel']) })
    assert.ok(Math.abs(param.read() - (20 + 19980 * 0.2)) < 1e-6)

    layout.connections = [
      { id: 'relative', sourceId: 'lfo', sourceParameter: 'value', targetId: 'filter', targetParameter: 'cutoff',
        mappingMode: 'mod', modulationMin: -10, modulationMax: 10 },
    ]
    filter.settings.cutoff = 6000
    lfo.settings.depth = 1
    graph.update(layout, [], { signals })
    original.value = 0.5
    assert.ok(Math.abs(param.read() - 6999) < 1e-6)
    const count = nodes.length
    filter.settings.cutoff = 7000
    lfo.settings.depth = 0.5
    graph.update(layout, [], { signals })
    assert.equal(nodes.length, count)
    assert.ok(Math.abs(param.read() - 7499.5) < 1e-6)

    const second = createControl('second', 4, 0, 'lfo')
    second.settings.rateMode = 'free'
    second.settings.rate = 2
    layout.items.push(second)
    layout.connections = [
      { id: 'rate', sourceId: 'lfo', sourceParameter: 'value', targetId: 'second', targetParameter: 'rate',
        mappingMode: 'abs', absoluteMin: 1, absoluteMax: 5 },
      { id: 'second-output', sourceId: 'second', sourceParameter: 'value', targetId: 'filter', targetParameter: 'cutoff' },
    ]
    lfo.settings.depth = 1
    graph.update(layout, [], { signals })
    const secondNode = oscillators[1]
    original.value = 0
    assert.ok(Math.abs(secondNode.frequency.read() - 3) < 1e-6)
    layout.connections.shift()
    graph.update(layout, [], { signals })
    assert.equal(secondNode.frequency.value, 2)
    assert.equal(secondNode.frequency.overridden, false)

    graph.dispose()
    assert.equal(original.disposed, true)
  } finally {
    await server.close()
  }
})
