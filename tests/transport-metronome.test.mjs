import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { createServer } from 'vite'

async function setup() {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  const sequencer = await server.ssrLoadModule('/src/sequencedLoop.ts')
  const source = await readFile(new URL('../src/composables/useTransport.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  let now = 0
  let callback
  let cleanup
  let disposed = false
  const scheduledDraws = []
  const clicks = []
  const cancelledClicks = []
  const releasedClicks = []
  const starts = []
  const stops = []
  const tempos = []
  const cleared = []
  const transport = {
    PPQ: 192,
    bpm: { setValueAtTime: (value, time) => tempos.push([value, time]) },
    scheduleRepeat: (fn, interval) => { callback = fn; assert.equal(interval, '4n'); return 7 },
    getTicksAtTime: (time) => time * 192,
    start: (...args) => starts.push(args),
    stop: (...args) => stops.push(args),
    clear: (id) => cleared.push(id),
  }
  class Synth {
    envelope = { cancel: (time) => cancelledClicks.push(time) }
    connect() { return this }
    triggerAttackRelease(note, duration, time) { clicks.push([note, duration, time]) }
    triggerRelease(time) { releasedClicks.push(time) }
    dispose() { disposed = true }
  }
  const tone = {
    Synth, start: async () => {}, immediate: () => now,
    getTransport: () => transport,
    getDraw: () => ({ schedule: (fn, time) => scheduledDraws.push([fn, time]) }),
    getContext: () => ({ rawContext: { destination: {} } }),
  }
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, console,
    require: (path) => path === 'vue' ? { ...vue, onUnmounted: (fn) => { cleanup = fn } } : path === 'tone' ? tone :
      path === '../sequencedLoop' ? sequencer : { gridScopes: () => [], sameBankScope: () => false } })
  const options = { banks: vue.ref([]), bpm: vue.ref(120), editing: vue.ref(false), projectError: vue.ref('') }
  const scope = vue.effectScope()
  const player = scope.run(() => module.exports.useTransport(options))
  return {
    player, options, starts, stops, tempos, clicks, cancelledClicks, releasedClicks, scheduledDraws, cleared,
    advance: (time) => { now = time },
    tick: (time) => callback(time),
    disposed: () => disposed,
    close: async () => { cleanup(); scope.stop(); await server.close() },
  }
}

test('transport schedules metronome clicks at the supplied audio time', async () => {
  const context = await setup()
  try {
    context.player.metronomeEnabled.value = true
    await context.player.togglePlayback()
    assert.deepEqual(context.starts, [[0, 0]])
    context.tick(0)
    context.tick(1)
    context.tick(4)
    assert.deepEqual(context.clicks, [['C6', 0.03, 0], ['G5', 0.03, 1], ['C6', 0.03, 4]])
    assert.equal(context.player.beat.value, 0)
    context.scheduledDraws[1][0]()
    assert.equal(context.player.beat.value, 1)
    context.player.metronomeEnabled.value = false
    assert.deepEqual(context.cancelledClicks, [0])
    assert.deepEqual(context.releasedClicks, [0])
    context.tick(5)
    assert.equal(context.clicks.length, 3)
  } finally { await context.close() }
  assert.deepEqual(context.cleared, [7])
  assert.equal(context.disposed(), true)
})

test('tempo changes and stop use the audio clock and invalidate pending draws', async () => {
  const context = await setup()
  try {
    await context.player.togglePlayback()
    context.advance(0.25)
    assert.equal(context.player.transportClock.position(), 0.25)
    context.options.bpm.value = 90
    assert.deepEqual(context.tempos, [[120, 0], [90, 0.25]])
    context.tick(2)
    await context.player.togglePlayback()
    assert.deepEqual(context.stops, [[0.25]])
    assert.equal(context.player.transportClock.position(), 0.25)
    context.scheduledDraws[0][0]()
    assert.equal(context.player.beat.value, 0)
    await context.player.togglePlayback()
    context.scheduledDraws[0][0]()
    assert.equal(context.player.beat.value, 0)
  } finally { await context.close() }
})

test('stopping cancels a metronome click already scheduled by Transport', async () => {
  const context = await setup()
  try {
    context.player.metronomeEnabled.value = true
    await context.player.togglePlayback()
    context.tick(1)
    context.advance(0.5)
    await context.player.togglePlayback()
    assert.deepEqual(context.cancelledClicks, [0.5])
    assert.deepEqual(context.releasedClicks, [0.5])
  } finally { await context.close() }
})
