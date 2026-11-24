import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

test('session recording saves chunks and disconnects only its recording branch', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  const original = globalThis.MediaRecorder
  try {
    const { startSessionRecording } = await server.ssrLoadModule('/src/audio/sessionRecording.ts')
    let recorder
    globalThis.MediaRecorder = class {
      static isTypeSupported(type) { return type === 'audio/ogg;codecs=opus' }
      state = 'inactive'
      mimeType = 'audio/ogg;codecs=opus'
      constructor(stream, options) { this.stream = stream; this.options = options; recorder = this }
      start(timeslice) { this.state = 'recording'; this.timeslice = timeslice }
      stop() { this.state = 'inactive' }
    }
    let stopped = 0
    const destination = { stream: { getTracks: () => [{ stop: () => stopped++ }] } }
    const connections = new Set(['speakers'])
    const output = {
      connect: (node) => connections.add(node),
      disconnect: (node) => connections.delete(node),
    }
    let result
    const errors = []
    const session = await startSessionRecording({ createMediaStreamDestination: () => destination }, output, 'ogg',
      (blob) => { result = blob }, (error) => errors.push(error.message))
    assert.equal(recorder.stream, destination.stream)
    assert.equal(recorder.options.mimeType, 'audio/ogg;codecs=opus')
    assert.equal(recorder.timeslice, 1000)
    assert.deepEqual(connections, new Set(['speakers', destination]))
    recorder.ondataavailable({ data: new Blob(['first'], { type: 'audio/ogg' }) })
    session.stop()
    recorder.ondataavailable({ data: new Blob(['second']) })
    recorder.onstop()
    assert.equal(await result.text(), 'firstsecond')
    assert.equal(result.type, 'audio/ogg;codecs=opus')
    assert.deepEqual(connections, new Set(['speakers']))
    assert.equal(stopped, 1)
    assert.deepEqual(errors, [])
    session.dispose()
    assert.equal(stopped, 1)
  } finally {
    globalThis.MediaRecorder = original
    await server.close()
  }
})

test('session recording reports failures and cleans up audio resources', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  const original = globalThis.MediaRecorder
  try {
    const { startSessionRecording } = await server.ssrLoadModule('/src/audio/sessionRecording.ts')
    let recorder
    globalThis.MediaRecorder = class {
      static isTypeSupported(type) { return type === 'audio/ogg;codecs=opus' }
      state = 'inactive'
      mimeType = 'audio/ogg'
      constructor() { recorder = this }
      start() { this.state = 'recording' }
      stop() { this.state = 'inactive' }
    }
    let tracksStopped = 0
    let disconnected = 0
    const context = { createMediaStreamDestination: () => ({ stream: { getTracks: () => [{ stop: () => tracksStopped++ }] } }) }
    const output = { connect() {}, disconnect() { disconnected++ } }
    const errors = []
    const complete = () => assert.fail('Failed recordings must not be downloaded')
    const fail = (error) => errors.push(error.message)

    await startSessionRecording(context, output, 'ogg', complete, fail)
    recorder.onerror({ error: new Error('encoder failed') })
    recorder.onstop()
    assert.match(errors[0], /encoder failed/)
    assert.equal(tracksStopped, 1)
    assert.equal(disconnected, 1)

    await startSessionRecording(context, output, 'ogg', complete, fail)
    recorder.state = 'inactive'
    recorder.onstop()
    assert.match(errors[1], /unexpectedly/)

    const session = await startSessionRecording(context, output, 'ogg', complete, fail)
    session.stop()
    recorder.onstop()
    assert.match(errors[2], /empty/)
    assert.equal(tracksStopped, 3)
    assert.equal(disconnected, 3)
  } finally {
    globalThis.MediaRecorder = original
    await server.close()
  }
})

test('WAV records stereo and flushes before disconnecting', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  const originalRecorder = globalThis.MediaRecorder
  const originalWorklet = globalThis.AudioWorkletNode
  const originalSecure = globalThis.isSecureContext
  try {
    const { startSessionRecording } = await server.ssrLoadModule('/src/audio/sessionRecording.ts')
    globalThis.MediaRecorder = class { static isTypeSupported() { return false } }
    globalThis.isSecureContext = true
    let node
    globalThis.AudioWorkletNode = class {
      constructor(context, name, options) {
        this.context = context; this.name = name; this.options = options; node = this
        this.port = { postMessage: (message) => { this.message = message }, close: () => { this.closed = true } }
      }
      connect(target) { this.target = target }
      disconnect() { this.disconnected = true }
    }
    const mute = { gain: { value: 1 }, connect(target) { this.target = target }, disconnect() { this.disconnected = true } }
    const audio = { sampleRate: 48000, destination: {}, audioWorklet: { async addModule(url) { this.url = url } },
      createGain: () => mute }
    const connections = new Set(['speakers'])
    const output = { connect: (target) => connections.add(target), disconnect: (target) => connections.delete(target) }
    let result
    const context = { rawContext: audio, createAudioWorkletNode: (name, options) =>
      new AudioWorkletNode(audio, name, options) }
    const session = await startSessionRecording(context, output, 'wav', (blob) => { result = blob },
      (error) => assert.fail(error.message))
    assert.equal(node.options.processorOptions.channels, 2)
    assert.equal(mute.gain.value, 0)
    assert.deepEqual(connections, new Set(['speakers', node]))
    node.port.onmessage({ data: { type: 'samples', samples: Float32Array.of(-1, 1, 0.5, -0.5) } })
    session.stop()
    assert.equal(node.message, 'stop')
    assert.equal(connections.has(node), true)
    node.port.onmessage({ data: { type: 'stopped' } })
    assert.deepEqual(connections, new Set(['speakers']))
    assert.equal(node.closed, true)
    const bytes = await result.arrayBuffer()
    const wav = new DataView(bytes)
    assert.equal(result.type, 'audio/wav')
    assert.equal(wav.getUint16(22, true), 2)
    assert.equal(wav.getUint32(28, true), 192000)
    assert.equal(wav.getUint32(40, true), 8)
    assert.deepEqual([44, 46, 48, 50].map((offset) => wav.getInt16(offset, true)), [-32768, 32767, 16383, -16384])
  } finally {
    globalThis.MediaRecorder = originalRecorder
    globalThis.AudioWorkletNode = originalWorklet
    globalThis.isSecureContext = originalSecure
    await server.close()
  }
})

test('format choices reflect browser support and reject unsupported selections', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  const originalRecorder = globalThis.MediaRecorder
  const originalWorklet = globalThis.AudioWorkletNode
  const originalSecure = globalThis.isSecureContext
  try {
    const { supportedRecordingFormats, startSessionRecording } = await server.ssrLoadModule('/src/audio/sessionRecording.ts')
    globalThis.MediaRecorder = class {
      static isTypeSupported(type) { return type === 'audio/ogg;codecs=opus' || type === 'audio/mp4' }
    }
    globalThis.AudioWorkletNode = class {}
    globalThis.isSecureContext = true
    assert.deepEqual(supportedRecordingFormats(), ['ogg', 'wav', 'm4a'])
    globalThis.isSecureContext = false
    assert.deepEqual(supportedRecordingFormats(), ['ogg', 'm4a'])
    await assert.rejects(startSessionRecording({}, {}, 'wav', () => {}, () => {}), /not supported/)
    await assert.rejects(startSessionRecording({}, {}, 'mp3', () => {}, () => {}), /not supported/)
  } finally {
    globalThis.MediaRecorder = originalRecorder
    globalThis.AudioWorkletNode = originalWorklet
    globalThis.isSecureContext = originalSecure
    await server.close()
  }
})
