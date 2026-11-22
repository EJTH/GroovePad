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
      if (type === '808') {
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

test('new instrument envelopes default to full sustain and half-second release without sharing state', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { InstrumentFactory } = await server.ssrLoadModule('/src/instruments/index.ts')
    for (const type of ['sample-hit', 'sample-loop', '303', '808']) {
      const first = InstrumentFactory.getDefaultParams(type)
      const second = InstrumentFactory.getDefaultParams(type)
      assert.equal(first.envelope.sustain, 1)
      assert.equal(first.envelope.release, 0.5)
      first.envelope.sustain = 0.25
      assert.equal(second.envelope.sustain, 1)
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

test('808 initializes its synthesizer with the configured envelope', async () => {
  const source = await readFile(new URL('../src/instruments/Drum808.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
  let synthOptions
  class Node {
    connect() {}
    toDestination() { return this }
    start() {}
  }
  const tone = {
    Gain: Node, Filter: Node, Oscillator: Node,
    Synth: class extends Node { constructor(options) { super(); synthOptions = options } },
  }
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports,
    require: (name) => name === 'tone' ? tone : { defaultEnvelope: () => ({ attack: 0.001, decay: 0.5, sustain: 1, release: 0.5 }) } })
  const drum = new module.exports.Drum808({})
  assert.equal(synthOptions.envelope.sustain, 1)
  assert.equal(synthOptions.envelope.release, 0.5)
  assert.equal(synthOptions.envelope, drum.params.envelope)
  const custom = { attack: 0.1, decay: 0.2, sustain: 0.3, release: 0.4 }
  new module.exports.Drum808({ envelope: custom })
  assert.equal(synthOptions.envelope, custom)
})
