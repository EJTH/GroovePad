import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

function installAnimationFrame() {
  const frames = new Map()
  let sequence = 0
  const previousRequest = globalThis.requestAnimationFrame
  const previousCancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++sequence
    frames.set(id, callback)
    return id
  }
  globalThis.cancelAnimationFrame = (id) => frames.delete(id)
  return {
    frames,
    restore() {
      if (previousRequest === undefined) delete globalThis.requestAnimationFrame
      else globalThis.requestAnimationFrame = previousRequest
      if (previousCancel === undefined) delete globalThis.cancelAnimationFrame
      else globalThis.cancelAnimationFrame = previousCancel
    },
    run(time) {
      const entry = frames.entries().next().value
      assert.ok(entry, 'a refresh frame should be scheduled')
      frames.delete(entry[0])
      entry[1](time)
    },
  }
}

test('signal runtimes share a refresh and batch changed values at control rate', async () => {
  const animation = installAnimationFrame()
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { SignalRuntime } = await server.ssrLoadModule('/src/audio/signalRuntime.ts')
    const first = new SignalRuntime()
    const second = new SignalRuntime()
    let firstUpdates = 0
    let secondUpdates = 0
    first.subscribe(() => firstUpdates++)
    second.subscribe(() => secondUpdates++)

    first.set('lfo:value', 0)
    first.set('lfo:value', 0.5)
    second.set('envelope:value', 0.25)
    assert.equal(animation.frames.size, 1)

    animation.run(16)
    assert.equal(firstUpdates, 1)
    assert.equal(secondUpdates, 1)

    first.set('lfo:value', 0.75)
    animation.run(32)
    assert.equal(firstUpdates, 1)
    animation.run(50)
    assert.equal(firstUpdates, 2)

    first.set('lfo:value', 0.75)
    assert.equal(animation.frames.size, 0)
    first.dispose()
    second.dispose()
  } finally {
    await server.close()
    animation.restore()
  }
})

test('immediate signal changes notify synchronously and disposal cancels pending updates', async () => {
  const animation = installAnimationFrame()
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { SignalRuntime } = await server.ssrLoadModule('/src/audio/signalRuntime.ts')
    const runtime = new SignalRuntime()
    let updates = 0
    runtime.subscribe(() => updates++)

    runtime.set('boundary:value', 1, true)
    assert.equal(updates, 1)

    runtime.set('boundary:value', 2)
    assert.equal(animation.frames.size, 1)
    runtime.dispose()
    assert.equal(animation.frames.size, 0)
    assert.equal(runtime.values.size, 0)
    assert.equal(updates, 1)
  } finally {
    await server.close()
    animation.restore()
  }
})
