import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'

async function environment() {
  let now = 0
  let nextTimer = 0
  const timers = new Map()
  const mounted = []
  const unmounted = []
  const listeners = new Map()
  const observers = []
  let frame
  const document = {
    visibilityState: 'visible',
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
  }
  class IntersectionObserver {
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe(target) { this.target = target }
    disconnect() { this.disconnected = true }
    show(isIntersecting) { this.callback([{ target: this.target, isIntersecting }]) }
  }
  const vueMock = { ...vue, onMounted: (callback) => mounted.push(callback),
    onBeforeUnmount: (callback) => unmounted.push(callback), useId: () => 'test' }
  const globals = {
    document, IntersectionObserver, performance: { now: () => now },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (callback) => { frame = callback; return 1 },
    cancelAnimationFrame: () => { frame = undefined },
  }
  function advance(ms) {
    const end = now + ms
    while (true) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (!next || next[1].at > end) break
      timers.delete(next[0])
      now = next[1].at
      next[1].callback()
    }
    now = end
  }
  function load(code, dependencies = {}) {
    const module = { exports: {} }
    vm.runInNewContext(code, { ...globals, module, exports: module.exports,
      require: (path) => path === 'vue' ? vueMock : dependencies[path] ?? { default: {} } })
    return module.exports
  }
  const helperSource = await readFile(new URL('../src/composables/useVisualRefresh.ts', import.meta.url), 'utf8')
  const helper = load(ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)
  async function component(path, props, dependencies = {}, emit = () => {}) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8')
    const script = compileScript(parse(source).descriptor, { id: 'test' }).content
    const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const module = load(code, { '../../composables/useVisualRefresh': helper, ...dependencies })
    const scope = vue.effectScope()
    const api = scope.run(() => module.default.setup(props, { expose() {}, emit }))
    return { api, scope }
  }
  return { component, observers, document, listeners, advance,
    frame: (time) => frame(time),
    mount: () => mounted.forEach((callback) => callback()),
    unmount: () => unmounted.forEach((callback) => callback()) }
}

test('loop previews coalesce curves and notes, pause off-screen, and catch up', async () => {
  const env = await environment()
  const note = { instrumentId: 'pad', note: 60, velocity: 100, position: 0, duration: 1 }
  const event = { sourceId: 'knob', parameter: 'value', position: 0, value: 1 }
  const props = vue.reactive({
    item: { settings: { clipIndex: 0, automation: { 0: [event], 1: [] } } },
    clipIndex: 0, automation: [event], notes: [note], length: 4, playhead: 10,
    previewX: (position, length) => position / length * 100,
    previewY: (value) => value, previewColor: () => 'red',
    getCurves: (item) => { calls++; return [{ key: 'curve', path: String(item.settings.automation[item.settings.clipIndex][0]?.value ?? ''), color: 'red' }] },
  })
  let calls = 0
  const { api, scope } = await env.component('../src/components/widgets/LoopPreview.vue', props)
  api.element.value = {}
  env.mount()
  env.observers[0].show(true)
  await vue.nextTick()
  env.advance(200)
  assert.equal(calls, 2)

  props.item = { ...props.item, settings: { ...props.item.settings } }
  props.playhead = 20
  await vue.nextTick()
  env.advance(0)
  assert.equal(calls, 2)
  assert.equal(api.displayPlayhead.value, 20)
  props.automation[0].value = 2
  props.automation[0].value = 3
  props.notes[0].position = 2
  await vue.nextTick()
  env.advance(199)
  assert.equal(calls, 2)
  env.advance(1)
  assert.equal(calls, 3)
  assert.equal(api.preview.value.curves[0].path, '3')
  assert.equal(api.preview.value.notes[0].x, 50)

  env.observers[0].show(false)
  await vue.nextTick()
  props.automation[0].value = 4
  props.notes.push({ ...note, position: 3 })
  props.playhead = 30
  await vue.nextTick()
  env.advance(500)
  assert.equal(calls, 3)
  assert.equal(api.displayPlayhead.value, 20)
  env.observers[0].show(true)
  await vue.nextTick()
  env.advance(0)
  assert.equal(calls, 4)
  assert.equal(api.preview.value.curves[0].path, '4')
  assert.equal(api.preview.value.notes.length, 2)
  assert.equal(api.displayPlayhead.value, 30)

  props.item.settings.clipIndex = 1
  props.clipIndex = 1
  props.automation = props.item.settings.automation[1]
  props.notes = []
  await vue.nextTick()
  env.advance(200)
  assert.equal(api.preview.value.curves[0].path, '')
  assert.equal(api.preview.value.notes.length, 0)

  props.notes.push(note)
  await vue.nextTick()
  env.unmount()
  scope.stop()
  env.advance(200)
  assert.equal(api.preview.value.notes.length, 0)
  assert.equal(env.observers[0].disconnected, true)
})

test('LFO waveform snapshots update at 12 FPS and pause when the page is hidden', async () => {
  const env = await environment()
  const props = vue.reactive({ settings: { waveform: 'sine', rateMode: 'free', rate: 1, depth: 1, offset: 0, smoothness: 0, color: 'red' },
    phase: 0, randomValue: 0 })
  const lfo = { lfoWaveValue: (waveform, position) => Math.sin(position * 2 * Math.PI),
    lfoLevel: (raw, settings) => Math.max(-1, Math.min(1, raw * settings.depth + settings.offset)) }
  const { api, scope } = await env.component('../src/components/widgets/LFOWaveform.vue', props, { '../../lfo': lfo })
  api.element.value = {}
  env.mount()
  env.observers[0].show(true)
  await vue.nextTick()
  env.advance(84)
  const shape = api.shape.value
  props.phase = 0.1
  props.phase = 0.2
  await vue.nextTick()
  env.advance(83)
  assert.equal(api.snapshot.value.phase, 0)
  env.advance(1)
  assert.equal(api.snapshot.value.phase, 0.2)
  assert.equal(api.shape.value, shape)

  env.document.visibilityState = 'hidden'
  env.listeners.get('visibilitychange')()
  await vue.nextTick()
  props.phase = 0.7
  props.settings.depth = 0.5
  await vue.nextTick()
  env.advance(500)
  assert.equal(api.snapshot.value.phase, 0.2)
  env.document.visibilityState = 'visible'
  env.listeners.get('visibilitychange')()
  await vue.nextTick()
  env.advance(0)
  assert.equal(api.snapshot.value.phase, 0.7)
  assert.equal(api.shape.value.depth, 0.5)
  env.unmount()
  scope.stop()
})

test('LFO signal output continues on every animation frame', async () => {
  const env = await environment()
  const props = vue.reactive({ label: 'LFO', bpm: 120,
    settings: { waveform: 'sine', rateMode: 'free', rate: 1, depth: 1, offset: 0, smoothness: 0 } })
  const outputs = []
  const lfo = { lfoWaveValue: (waveform, position) => Math.sin(position * 2 * Math.PI),
    lfoLevel: (raw) => raw }
  const pointerTap = { pointerTap: () => ({}) }
  const { scope } = await env.component('../src/components/widgets/LFO.vue', props,
    { '../../lfo': lfo, '../../pointerTap': pointerTap }, (event, value) => {
      if (event === 'output') outputs.push(value.value)
    })
  env.mount()
  for (let time = 10; time <= 100; time += 10) env.frame(time)
  assert.equal(outputs.length, 9)
  assert.ok(Math.abs(outputs.at(-1) - Math.sin(0.18 * Math.PI)) < 1e-10)
  env.unmount()
  scope.stop()
})

test('ADSR geometry stays cached for unchanged settings', async () => {
  const env = await environment()
  const props = vue.reactive({ envelope: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3 },
    width: 200, height: 50, color: 'red' })
  const { api, scope } = await env.component('../src/components/UI/ADSRVisualizer.vue', props)
  const labels = api.labels.value
  const path = api.pathData.value
  props.envelope = { ...props.envelope }
  assert.equal(api.labels.value, labels)
  assert.equal(api.pathData.value, path)
  props.envelope.attack = 0.4
  assert.notEqual(api.pathData.value, path)
  assert.notEqual(api.labels.value, labels)
  scope.stop()
})
