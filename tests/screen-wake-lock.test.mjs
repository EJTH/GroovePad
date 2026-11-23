import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

class Screen extends EventTarget {
  visibilityState = 'visible'

  setVisibility(state) {
    this.visibilityState = state
    this.dispatchEvent(new Event('visibilitychange'))
  }
}

class Sentinel extends EventTarget {
  released = false

  async release() {
    this.released = true
    this.dispatchEvent(new Event('release'))
  }
}

test('screen wake lock follows visibility and releases pending requests on cleanup', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { keepScreenAwake } = await server.ssrLoadModule('/src/screenWakeLock.ts')
    const screen = new Screen()
    const requests = []
    const navigator = { wakeLock: { request: () => new Promise((resolve) => requests.push(resolve)) } }
    const stop = keepScreenAwake(screen, navigator)
    assert.equal(requests.length, 1)

    screen.setVisibility('hidden')
    screen.setVisibility('visible')
    const stale = new Sentinel()
    requests[0](stale)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(stale.released, true)
    assert.equal(requests.length, 2)

    const active = new Sentinel()
    requests[1](active)
    await new Promise((resolve) => setImmediate(resolve))
    screen.setVisibility('hidden')
    assert.equal(active.released, true)
    screen.setVisibility('visible')
    assert.equal(requests.length, 3)

    stop()
    const late = new Sentinel()
    requests[2](late)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(late.released, true)
    screen.setVisibility('visible')
    assert.equal(requests.length, 3)

    assert.doesNotThrow(() => keepScreenAwake(new Screen(), {})())
  } finally { await server.close() }
})

test('screen wake lock retries once on interaction after rejection or unexpected release', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  const originalWarn = console.warn
  const warnings = []
  console.warn = (...args) => warnings.push(args)
  try {
    const { keepScreenAwake } = await server.ssrLoadModule('/src/screenWakeLock.ts')
    const screen = new Screen()
    let attempts = 0
    const locks = []
    const navigator = { wakeLock: { request: async () => {
      attempts++
      if (attempts <= 2) throw new Error('Wake lock denied')
      const lock = new Sentinel()
      locks.push(lock)
      return lock
    } } }
    const stop = keepScreenAwake(screen, navigator)
    await new Promise((resolve) => setImmediate(resolve))
    screen.dispatchEvent(new Event('pointerdown'))
    await new Promise((resolve) => setImmediate(resolve))
    screen.dispatchEvent(new Event('pointerdown'))
    assert.equal(attempts, 2)
    assert.equal(warnings.length, 2)

    screen.setVisibility('hidden')
    screen.setVisibility('visible')
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(attempts, 3)
    await locks[0].release()
    screen.dispatchEvent(new Event('pointerdown'))
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(attempts, 4)
    stop()
    assert.equal(locks[1].released, true)
  } finally {
    console.warn = originalWarn
    await server.close()
  }
})
