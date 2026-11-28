import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createServer } from 'vite'

test('loop notes notify only their pad with updated overlapping notes and audio times', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { useGridPlayback } = await server.ssrLoadModule('/src/components/useGridPlayback.ts')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { BankEventBus } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const layout = vue.reactive({ columns: 2, rows: 1, items: [
      createControl('first', 0, 0, 'instrument-pad'),
      createControl('second', 1, 0, 'instrument-pad'),
    ], connections: [] })
    const bus = new BankEventBus()
    const calls = []
    let playback
    const renderer = vue.createRenderer({
      createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
      setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null,
      insert() {}, remove() {}, patchProp() {},
    })
    const app = renderer.createApp({
      setup() {
        playback = useGridPlayback({
          layout: () => layout, banks: () => undefined, bankId: 'A', bankEvents: bus,
          clock: { position: () => 0 }, playing: () => false, editing: () => false,
          transportStartImmediate: () => false, triggeredByInput: () => false,
          startOnInput: () => undefined, signals: new Map(), routeNote() {},
          loopNotesChanged: (id, time) => calls.push({ id, time, notes: playback.recordedNotes(id) }),
        })
        return () => vue.h('div')
      },
    })
    app.mount({})
    try {
      let updates = 0
      const unwatch = vue.watch(() => playback.recordedNotes('second'), () => updates++, { flush: 'sync' })
      const note = { instrumentId: 'first', note: 60, velocity: 100, position: 0, duration: 1 }
      const emit = (voiceId, on, time) => bus.emit({ kind: 'loop-note', bankId: 'A', voiceId, note, on, time })
      emit('one', true, 1)
      emit('two', true, 1.1)
      emit('one', false, 1.2)
      emit('two', false, 1.3)
      assert.deepEqual(calls.map(({ id, time, notes }) => [id, time, notes[0]?.count ?? 0]), [
        ['first', 1, 1], ['first', 1.1, 2], ['first', 1.2, 1], ['first', 1.3, 0],
      ])
      assert.equal(updates, 0)
      unwatch()
    } finally { app.unmount() }
  } finally { await server.close() }
})

async function samplePad(contextState, start) {
  const source = await readFile(new URL('../src/components/widgets/tone/InstrumentPad.vue', import.meta.url), 'utf8')
  const script = compileScript(parse(source).descriptor, { id: 'sample-pad' }).content
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const calls = []
  class SampleHit {
    constructor(params) { this.params = { ...params } }
    updateParameters(params) { Object.assign(this.params, params) }
    trigger(...args) { calls.push(['trigger', ...args]); return Promise.resolve() }
    release(...args) { calls.push(['release', ...args]) }
    dispose() {}
  }
  const tone = { immediate: () => 0, getContext: () => ({ state: contextState }), start }
  const instruments = {
    SampleHit, SampleLoop: class {}, Bass303: class {}, DrumKit: class {},
    InstrumentFactory: { create: (_type, params) => new SampleHit(params) },
  }
  const errors = []
  const vueMock = { ...vue, onBeforeUnmount() {} }
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, Error,
    console: { error: (...args) => errors.push(args) },
    require: (path) => path === 'vue' ? vueMock : path === 'tone' ? tone
      : path === '../../../instruments' ? instruments : { default: {} } })
  const scope = vue.effectScope()
  let exposed
  const settings = { instrumentType: 'sample-hit', instrumentParams: { polyphony: 2, sample: '' }, mode: 'trigger' }
  const api = scope.run(() => module.exports.default.setup(
    vue.reactive({ settings, playing: false }), { emit() {}, expose: (value) => { exposed = value } },
  ))
  return { calls, errors, api, exposed, scope }
}

test('running audio schedules sample hits before a nearby release', async () => {
  const pad = await samplePad('running', () => { throw new Error('audio should already be running') })
  try {
    pad.exposed.setPlaybackNotes([], [{ note: 60, velocity: 90, count: 1 }], 1)
    pad.exposed.setPlaybackNotes([], [], 1.01)
    assert.deepEqual(pad.calls.map((call) => call[0]), ['trigger', 'release'])
    assert.deepEqual(pad.calls[0].slice(1), [90, 60, 1, 'note:60:0', 0])
    assert.deepEqual(pad.calls[1].slice(1), ['note:60:0', 1.01])
  } finally { pad.scope.stop() }
})

test('suspended audio waits for startup and reports startup failures', async () => {
  let resolveStart
  const pending = new Promise((resolve) => { resolveStart = resolve })
  const pad = await samplePad('suspended', () => pending)
  try {
    pad.exposed.setPlaybackNotes([], [{ note: 60, velocity: 90, count: 1 }], 1)
    assert.equal(pad.calls.length, 0)
    resolveStart()
    await pending
    await Promise.resolve()
    assert.equal(pad.calls[0][0], 'trigger')
  } finally { pad.scope.stop() }

  const failed = await samplePad('suspended', () => Promise.reject(new Error('startup failed')))
  try {
    failed.exposed.setPlaybackNotes([], [{ note: 60, velocity: 90, count: 1 }], 1)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(failed.api.error.value, 'Audio error: startup failed')
    assert.equal(failed.errors.length, 1)
    assert.equal(failed.calls.length, 0)
  } finally { failed.scope.stop() }
})
