import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { createServer } from 'vite'

test('playhead refresh runs only while an enabled loop is playing', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  const originalRequest = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  const frames = new Map()
  let nextFrame = 0
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++nextFrame
    frames.set(id, callback)
    return id
  }
  globalThis.cancelAnimationFrame = (id) => frames.delete(id)
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const dependencies = {}
    for (const [key, path] of [
      ['../grid', '/src/grid.ts'], ['../modulation', '/src/modulation.ts'],
      ['../parameters', '/src/parameters.ts'], ['../settingsAutomation', '/src/settingsAutomation.ts'],
      ['../pointerTap', '/src/pointerTap.ts'],
    ]) dependencies[key] = await server.ssrLoadModule(path)
    class BankEventBus {
      listeners = new Set()
      subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
      emit(event) { for (const listener of this.listeners) listener(event) }
    }
    class SequencedLoopEngine {
      states = new Map()
      constructor(_loops, position) { this.position = position }
      isEnabled(id) { return this.states.has(id) }
      isPending() { return false }
      toggle(loop, at) {
        if (this.states.has(loop.id)) this.states.delete(loop.id)
        else this.states.set(loop.id, at)
      }
      playhead(id) {
        const origin = this.states.get(id)
        return origin === undefined ? undefined : (this.position() - origin) / 4
      }
      setScheduled() {}
      refresh() {}
      stop() { this.states.clear() }
    }
    dependencies['../sequencedLoop'] = { SequencedLoopEngine }
    const source = await readFile(new URL('../src/components/useGridPlayback.ts', import.meta.url), 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const module = { exports: {} }
    vm.runInNewContext(code, { module, exports: module.exports, requestAnimationFrame: globalThis.requestAnimationFrame,
      cancelAnimationFrame: globalThis.cancelAnimationFrame,
      require: (path) => path === 'vue' ? vue : path === 'tone' ? { immediate: () => 0 } : dependencies[path] })
    const { useGridPlayback } = module.exports
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    const layout = vue.reactive({ columns: 1, rows: 1, items: [loop], connections: [] })
    const playing = vue.ref(true)
    let position = 0
    let playback
    const renderer = vue.createRenderer({
      createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
      setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null,
      insert() {}, remove() {}, patchProp() {},
    })
    const app = renderer.createApp({
      setup() {
        playback = useGridPlayback({
          layout: () => layout, banks: () => undefined, bankId: 'A', bankEvents: new BankEventBus(),
          clock: { position: () => position }, playing: () => playing.value, editing: () => false,
          transportStartImmediate: () => false, triggeredByInput: () => false,
          startOnInput: () => undefined, signals: new Map(), routeNote() {},
        })
        return () => vue.h('div')
      },
    })
    app.mount({})
    try {
      assert.equal(frames.size, 0)
      playback.toggleLoopPlayback('loop')
      assert.equal(frames.size, 1)
      const [id, callback] = frames.entries().next().value
      frames.delete(id)
      position = 1
      callback()
      assert.ok(playback.loopPlayheads.value.get('loop') > 0)
      assert.equal(frames.size, 1)
      playback.toggleLoopPlayback('loop')
      assert.equal(frames.size, 0)
      assert.equal(playback.loopPlayheads.value.size, 0)
      playback.toggleLoopPlayback('loop')
      assert.equal(frames.size, 1)
      playing.value = false
      assert.equal(frames.size, 0)
    } finally { app.unmount() }
  } finally {
    if (originalRequest === undefined) delete globalThis.requestAnimationFrame
    else globalThis.requestAnimationFrame = originalRequest
    if (originalCancel === undefined) delete globalThis.cancelAnimationFrame
    else globalThis.cancelAnimationFrame = originalCancel
    await server.close()
  }
})
