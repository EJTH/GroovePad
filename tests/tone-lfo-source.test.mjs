import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { createServer } from 'vite'

test('grid LFO samples the Tone oscillator and disposes replaced sources', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const routes = await server.ssrLoadModule('/src/audio/audioRoutes.ts')
    const modulation = await server.ssrLoadModule('/src/modulation.ts')
    const parameters = await server.ssrLoadModule('/src/parameters.ts')
    const source = await readFile(new URL('../src/audio/bankAudio.ts', import.meta.url), 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const nodes = []
    const analysers = []
    const context = { currentTime: 5.125, now: () => 5, state: 'running' }
    class Node {
      disposed = false
      connect() { return this }
      disconnect() { return this }
      toDestination() { return this }
      dispose() { this.disposed = true; return this }
    }
    class Gain extends Node { constructor() { super(); this.gain = { rampTo() {} } } }
    class LFO extends Node {
      constructor(options) { super(); this.options = options; this.context = context; nodes.push(this) }
      start(time) { this.started = time; return this }
    }
    class Waveform extends Node {
      constructor() { super(); analysers.push(this) }
      getValue() { return new Float32Array([0.25, 0.5]) }
    }
    const tone = { ToneAudioNode: Node, Gain, LFO, Waveform }
    const module = { exports: {} }
    vm.runInNewContext(code, { module, exports: module.exports, console,
      require: (name) => name === 'tone' ? tone : name === '../modulation' ? modulation :
        name === '../parameters' ? parameters : routes })
    const graph = new module.exports.BankAudio((error) => { throw new Error(error) })
    const lfo = createControl('lfo', 0, 0, 'lfo')
    lfo.settings.rateMode = 'sync'
    lfo.settings.rate = 2
    const layout = { columns: 1, rows: 1, items: [lfo], connections: [] }
    graph.update(layout, [], { bpm: 120 })
    const sample = graph.getLfoSample('lfo', lfo.settings, 120)
    assert.equal(sample.value, 0.5)
    assert.equal(sample.phase, 0.5)
    assert.equal(nodes[0].started, 5)
    context.state = 'suspended'
    assert.equal(graph.getLfoSample('lfo', lfo.settings, 120), undefined)
    context.state = 'running'
    assert.equal(graph.getLfoSample('lfo', { ...lfo.settings, rate: 3 }, 120), undefined)
    lfo.settings.rate = 3
    graph.update(layout, [], { bpm: 120 })
    assert.equal(nodes[0].disposed, true)
    assert.equal(analysers[0].disposed, true)
    graph.dispose()
    assert.equal(nodes[1].disposed, true)
    assert.equal(analysers[1].disposed, true)
  } finally {
    await server.close()
  }
})
