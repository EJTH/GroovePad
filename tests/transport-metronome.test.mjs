import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { createServer } from 'vite'

async function setup(clickLatency = 0) {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  const sequencer = await server.ssrLoadModule('/src/sequencedLoop.ts')
  const source = await readFile(new URL('../src/composables/useTransport.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  let now = 0
  let positionCalls = 0
  let timeoutStarts = 0
  let nextId = 0
  const timeouts = new Map()
  const intervals = new Map()
  const clicks = []
  let cleanup
  let disposed = false
  class Clock extends sequencer.TransportClock {
    constructor() { super(() => now) }
    position() { positionCalls++; return super.position() }
  }
  class Synth {
    connect() { return this }
    triggerAttackRelease(note) { clicks.push({ note, at: now }); now += clickLatency }
    dispose() { disposed = true }
  }
  const window = {
    setTimeout: (callback, delay) => { timeoutStarts++; const id = ++nextId; timeouts.set(id, { callback, at: now + delay }); return id },
    clearTimeout: (id) => timeouts.delete(id),
    setInterval: (callback, delay) => { const id = ++nextId; intervals.set(id, { callback, delay }); return id },
    clearInterval: (id) => intervals.delete(id),
  }
  const vueMock = { ...vue, onUnmounted: (callback) => { cleanup = callback } }
  const tone = { Synth, start: async () => {}, getContext: () => ({ rawContext: { destination: {} } }) }
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, window, console,
    require: (path) => path === 'vue' ? vueMock : path === 'tone' ? tone :
      path === '../sequencedLoop' ? { ...sequencer, TransportClock: Clock } : { gridScopes: () => [], sameBankScope: () => false } })
  const options = { banks: vue.ref([]), bpm: vue.ref(120), editing: vue.ref(false), projectError: vue.ref('') }
  const scope = vue.effectScope()
  const transport = scope.run(() => module.exports.useTransport(options))
  function runDue() {
    while (true) {
      const next = [...timeouts.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (!next || next[1].at > now) break
      timeouts.delete(next[0])
      next[1].callback()
    }
  }
  function advance(ms) {
    const end = now + ms
    while (true) {
      const next = [...timeouts.values()].sort((a, b) => a.at - b.at)[0]
      if (!next || next.at > end) break
      now = next.at
      runDue()
    }
    now = end
  }
  return { transport, options, timeouts, intervals, clicks, advance, runDue,
    jump: (ms) => { now += ms }, positionCalls: () => positionCalls, timeoutStarts: () => timeoutStarts, disposed: () => disposed,
    close: async () => { cleanup(); scope.stop(); await server.close() } }
}

test('metronome does no polling while disabled and resumes at the next beat', async () => {
  const test = await setup()
  try {
    await test.transport.togglePlayback()
    assert.equal(test.timeouts.size, 0)
    const calls = test.positionCalls()
    test.advance(1000)
    assert.equal(test.positionCalls(), calls)
    test.transport.metronomeEnabled.value = true
    assert.equal(test.timeouts.size, 1)
    test.advance(499)
    assert.deepEqual(test.clicks, [])
    test.advance(1)
    assert.deepEqual(test.clicks.map((click) => click.note), ['G5'])
    test.transport.metronomeEnabled.value = false
    assert.equal(test.timeouts.size, 0)
    test.advance(1000)
    test.transport.metronomeEnabled.value = true
    test.advance(500)
    assert.deepEqual(test.clicks.map((click) => click.note), ['G5', 'G5'])
    await test.transport.togglePlayback()
    assert.equal(test.timeouts.size, 0)
    assert.equal(test.intervals.size, 0)
  } finally { await test.close() }
})

test('enabled metronome schedules once per beat at 120 BPM', async () => {
  const test = await setup()
  try {
    test.transport.metronomeEnabled.value = true
    await test.transport.togglePlayback()
    test.advance(10000)
    assert.equal(test.clicks.length, 21)
    assert.equal(test.timeoutStarts(), 21)
    assert.equal(test.positionCalls(), 42)
  } finally { await test.close() }
})

test('a slow click catches up to the latest beat without waiting another full beat', async () => {
  const test = await setup(650)
  try {
    test.transport.metronomeEnabled.value = true
    await test.transport.togglePlayback()
    assert.equal([...test.timeouts.values()][0].at, 651)
    test.jump(1)
    test.runDue()
    assert.deepEqual(test.clicks.map((click) => click.note), ['C6', 'G5'])
  } finally { await test.close() }
})

test('beat-aligned metronome handles tempo changes, missed beats and cleanup', async () => {
  const test = await setup()
  try {
    test.transport.metronomeEnabled.value = true
    await test.transport.togglePlayback()
    assert.deepEqual(test.clicks.map((click) => click.note), ['C6'])
    test.advance(250)
    test.options.bpm.value = 60
    test.advance(499)
    assert.equal(test.clicks.length, 1)
    test.advance(1)
    assert.equal(test.clicks[1].at, 750)
    assert.equal(test.clicks[1].note, 'G5')
    test.jump(3200)
    test.runDue()
    assert.deepEqual(test.clicks.map((click) => click.note), ['C6', 'G5', 'C6'])
    assert.equal(test.timeouts.size, 1)
  } finally {
    await test.close()
    assert.equal(test.timeouts.size, 0)
    assert.equal(test.intervals.size, 0)
    assert.equal(test.disposed(), true)
  }
})
