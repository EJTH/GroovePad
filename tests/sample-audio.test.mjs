import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { createServer } from 'vite'
import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js'

async function loadTypeScript(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}

function audioBuffer(channels, sampleRate = 48000) {
  const data = channels.map((channel) => Float32Array.from(channel))
  return {
    length: data[0].length,
    numberOfChannels: data.length,
    sampleRate,
    getChannelData: (index) => data[index],
  }
}

test('reverse and back-and-forth stay within the selected cut', async () => {
  const { createSampleRegion } = await loadTypeScript('../src/instruments/sampleRegion.ts')
  const input = audioBuffer([[0, 1, 2, 3, 4, 5], [10, 11, 12, 13, 14, 15]])
  const create = (channels, length, rate) => audioBuffer(Array.from({ length: channels }, () => new Array(length).fill(0)), rate)
  const region = (reverse, bounce) => createSampleRegion(input, 1 / 6, 5 / 6, reverse, bounce, create)
  assert.deepEqual([...region(true, false).getChannelData(0)], [4, 3, 2, 1])
  assert.deepEqual([...region(false, true).getChannelData(0)], [1, 2, 3, 4, 3, 2])
  assert.deepEqual([...region(true, true).getChannelData(1)], [14, 13, 12, 11, 12, 13])
  assert.deepEqual([...input.getChannelData(0)], [0, 1, 2, 3, 4, 5])
  assert.deepEqual([...createSampleRegion(input, 0, 1 / 6, true, true, create).getChannelData(0)], [0])
})

test('a long release does not silence a short one-shot during its attack', async () => {
  const { oneShotGateDuration } = await loadTypeScript('../src/instruments/sampleRegion.ts')
  assert.equal(oneShotGateDuration(0.5, 0.01, 10), 0.01)
  assert.equal(oneShotGateDuration(0.005, 0.01, 10), 0.005)
  assert.equal(oneShotGateDuration(1, 0.01, 0.1), 0.9)
})

test('hit loops include the lead-in and locate the release direction', async () => {
  const { createHitLoop, hitLoopPosition } = await loadTypeScript('../src/instruments/sampleHitLoop.ts')
  const input = audioBuffer([[0, 1, 2, 3, 4, 5, 6, 7]], 8)
  const create = (channels, length, rate) => audioBuffer(Array.from({ length: channels }, () => new Array(length).fill(0)), rate)
  const plan = createHitLoop(input, 0, 1, [2 / 8, 6 / 8], false, true, create)
  assert.deepEqual([...plan.buffer.getChannelData(0)], [0, 1, 2, 3, 4, 5, 4, 3])
  assert.equal(plan.loopStartOffset, 2)
  assert.equal(plan.loopEndOffset, 8)
  assert.deepEqual(hitLoopPosition(plan, 1), { frame: 1, reverse: false })
  assert.deepEqual(hitLoopPosition(plan, 5), { frame: 5, reverse: true })
  assert.deepEqual(hitLoopPosition(plan, 6), { frame: 4, reverse: true })
  assert.deepEqual(hitLoopPosition(plan, 8), { frame: 2, reverse: false })
  const reverse = createHitLoop(input, 0, 1, [2 / 8, 6 / 8], true, true, create)
  assert.deepEqual([...reverse.buffer.getChannelData(0)], [7, 6, 5, 4, 3, 2, 3, 4])
  assert.deepEqual(hitLoopPosition(reverse, 1), { frame: 6, reverse: true })
  assert.deepEqual(hitLoopPosition(reverse, 5), { frame: 2, reverse: false })
  assert.deepEqual(hitLoopPosition(reverse, 6), { frame: 3, reverse: false })
  const single = createHitLoop(input, 0, 1, [4 / 8], false, false, create)
  assert.equal(single.loopStartOffset, 0)
  assert.equal(single.loopEndOffset, 4)
  assert.deepEqual(hitLoopPosition(single, 5), { frame: 1, reverse: false })
  const full = createHitLoop(input, 0, 1, [], false, false, create)
  assert.equal(full.loopStartOffset, 0)
  assert.equal(full.loopEndOffset, 8)
})

test('release keeps looping until a tail can finish and handles short releases', async () => {
  const { createHitLoop, createSliceLoop, scheduleLoopRelease } = await loadTypeScript('../src/instruments/sampleHitLoop.ts')
  const input = audioBuffer([[0, 1, 2, 3, 4, 5, 6, 7]], 8)
  const create = (channels, length, rate) => audioBuffer(Array.from({ length: channels }, () => new Array(length).fill(0)), rate)
  const plan = createHitLoop(input, 0, 1, [2 / 8, 6 / 8], false, true, create)
  assert.deepEqual(scheduleLoopRelease(plan, 2, 18), { waitFrames: 16, frame: 6, reverse: false, tailFrames: 2 })
  assert.deepEqual(scheduleLoopRelease(plan, 2, 15), { waitFrames: 13, frame: 1, reverse: true, tailFrames: 2 })
  assert.deepEqual(scheduleLoopRelease(plan, 3, 1), { waitFrames: 0, frame: 3, reverse: false, tailFrames: 5 })
  const slice = createSliceLoop(input, 2 / 8, 4 / 8, 1)
  assert.equal(slice.buffer, input)
  assert.deepEqual(scheduleLoopRelease(slice, 1, 8), { waitFrames: 3, frame: 4, reverse: false, tailFrames: 4 })
  const full = createHitLoop(input, 0, 1, [], false, false, create)
  assert.equal(scheduleLoopRelease(full, 1, 8), undefined)
})

test('sample modulation updates active voices without restarting them and tracks loop position', async () => {
  const source = await readFile(new URL('../src/instruments/SamplePlayer.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
  let time = 2
  let releasePosition
  const tone = { now: () => time, ToneAudioBuffer: class { get() { return { sampleRate: 100 } } } }
  const modules = {
    tone,
    './sampleRegion': {},
    './sampleHitLoop': { scheduleLoopRelease: (_, position) => { releasePosition = position; return undefined } },
  }
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports, require: (name) => modules[name] })
  class Sample extends module.exports.SamplePlayer {
    type = 'sample-hit'
    params = { sample: 'audio', pitch: 0, volume: -12, envelope: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 1 } }
  }
  const sample = new Sample()
  const volumeChanges = []
  const stops = []
  const player = { playbackRate: 1, volume: { rampTo: (value) => volumeChanges.push(value) }, stop: (when) => stops.push(when) }
  const envelope = { triggerRelease: () => {} }
  const voice = { player, envelope, note: 60, looping: true, released: false,
    loopPlan: { plan: {}, lastTime: 0, elapsedFrames: 0, rate: 1 } }
  sample.voices.add(voice)
  sample.updateParameters({ ...sample.params, pitch: 12, volume: -6, envelope: { ...sample.params.envelope, release: 2 } })
  assert.equal(sample.voices.size, 1)
  assert.equal(player.playbackRate, 2)
  assert.deepEqual(volumeChanges, [-6])
  assert.equal(envelope.release, 2)
  assert.equal(voice.loopPlan.elapsedFrames, 200)
  time = 3
  sample.release()
  assert.equal(releasePosition, 400)
  assert.deepEqual(stops, [5])
})

test('sample hit limits voices, bends and releases each note independently, and cancels pending notes', async () => {
  const source = await readFile(new URL('../src/instruments/SamplePlayer.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
  let finishLoad
  const load = new Promise((resolve) => { finishLoad = resolve })
  const players = []
  class Buffer {
    loaded = false
    duration = 1
    async load() { await load; this.loaded = true }
    dispose() {}
  }
  class Player {
    constructor(options) { Object.assign(this, options); this.volume = { rampTo() {} }; players.push(this) }
    connect() { return this }
    start() {}
    stop() { this.stopped = true }
    dispose() { this.disposed = true }
  }
  class Envelope {
    constructor(params) { Object.assign(this, params) }
    toDestination() { return this }
    triggerAttack() {}
    triggerAttackRelease() {}
    triggerRelease() { this.released = true }
    dispose() { this.disposed = true }
  }
  const tone = { now: () => 0, ToneAudioBuffer: Buffer, Player, AmplitudeEnvelope: Envelope }
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports, require: (name) =>
    name === 'tone' ? tone : name === './sampleRegion' ? { oneShotGateDuration: () => 1 } : {} })
  class Sample extends module.exports.SamplePlayer {
    type = 'sample-hit'
    params = { sample: 'data:audio/wav;base64,AA==', start: 0, end: 1, cuts: [], playback: 'order',
      loopMode: 'once', reverse: false, polyphony: 2, pitch: 0, volume: -12,
      envelope: { attack: 0.1, decay: 0.2, sustain: 1, release: 1 } }
  }
  const sample = new Sample()
  const cancelled = sample.trigger(100, 60, 'cancelled')
  sample.release('cancelled')
  const first = sample.trigger(100, 60, 'first')
  const second = sample.trigger(100, 64, 'second')
  finishLoad()
  await Promise.all([cancelled, first, second])
  assert.equal(players.length, 2)
  sample.setVoicePitchBend('first', 12)
  assert.equal(players[0].playbackRate, 2)
  assert.equal(players[1].playbackRate, 2 ** (4 / 12))
  await sample.trigger(100, 67, 'third')
  assert.equal(players[0].disposed, true)
  assert.equal(players[1].disposed, undefined)
  assert.equal(sample.voices.size, 2)
  sample.updateParameters({ ...sample.params, polyphony: 1 })
  assert.equal(players[1].disposed, true)
  assert.equal(sample.voices.size, 1)
  sample.dispose()

  const looping = new Sample()
  const voices = ['first', 'second'].map((id) => ({
    id, note: 60, looping: true, released: false,
    player: { stop() { this.stopped = true }, dispose() {} },
    envelope: { triggerRelease() { this.released = true }, dispose() {} },
  }))
  for (const voice of voices) looping.voices.add(voice)
  looping.release('first')
  assert.equal(voices[0].envelope.released, true)
  assert.equal(voices[0].player.stopped, true)
  assert.equal(voices[1].envelope.released, undefined)
  looping.dispose()
})

test('808 tonality changes the noise level on subsequent hits', async () => {
  const source = await readFile(new URL('../src/instruments/Drum808.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports, require: () => ({ now: () => 0 }) })
  const drum = Object.create(module.exports.Drum808.prototype)
  let noise = -1
  const parameter = { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }
  drum.params = { drum: 'snare', pitch: 150, volume: -12, tonality: 0.5, tone: 0.7 }
  drum.synth = { triggerAttackRelease: () => {} }
  drum.filter = { frequency: parameter }
  drum.noiseOsc = {}
  drum.noiseGain = { gain: { ...parameter, setValueAtTime: (value) => { noise = value } } }
  drum.noiseFilter = { frequency: parameter }
  drum.trigger(127)
  assert.equal(noise, 0.7 * 0.6)
  drum.params.tonality = 1
  drum.trigger(127)
  assert.equal(noise, 0)
})

test('recorded chunks produce a valid 16-bit mono WAV', async () => {
  const { encodeWav } = await loadTypeScript('../src/audio/wav.ts')
  const blob = encodeWav([Float32Array.of(-1, 0), Float32Array.of(1)], 48000)
  const bytes = await blob.arrayBuffer()
  const header = new DataView(bytes)
  assert.equal(blob.type, 'audio/wav')
  assert.equal(Buffer.from(bytes, 0, 4).toString(), 'RIFF')
  assert.equal(Buffer.from(bytes, 8, 4).toString(), 'WAVE')
  assert.equal(header.getUint32(4, true), bytes.byteLength - 8)
  assert.equal(header.getUint16(22, true), 1)
  assert.equal(header.getUint32(24, true), 48000)
  assert.equal(header.getUint16(34, true), 16)
  assert.equal(header.getUint32(40, true), 6)
  assert.deepEqual([44, 46, 48].map((offset) => header.getInt16(offset, true)), [-32768, 0, 32767])
  assert.throws(() => encodeWav([], 48000), /empty/)
})

test('recording processor flushes the last partial chunk on stop', async () => {
  const source = await readFile(new URL('../src/audio/recording-processor.js', import.meta.url), 'utf8')
  const messages = []
  let Processor
  class Worklet {
    port = { postMessage: (message) => messages.push(message) }
  }
  vm.runInNewContext(source, {
    AudioWorkletProcessor: Worklet,
    Float32Array,
    registerProcessor: (_, implementation) => { Processor = implementation },
  })
  const processor = new Processor()
  processor.process([[Float32Array.of(0.25, -0.5)]])
  processor.port.onmessage({ data: 'stop' })
  assert.equal(messages[0].type, 'samples')
  assert.deepEqual([...messages[0].samples], [0.25, -0.5])
  assert.equal(messages[1].type, 'stopped')
  assert.equal(processor.process([]), false)
})

test('sample hit loop playback migrates and validates without changing sample loops', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { isSavedProject, migrateSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const hit = createControl('hit', 0, 0, 'instrument-pad', 'sample-hit')
    hit.settings.instrumentParams.cuts = [0.5]
    hit.settings.instrumentParams.playback = 'cut:1'
    hit.settings.instrumentParams.loopMode = 'back-and-forth'
    const project = {
      version: 1, bpm: 120, selectedBankId: 'A',
      banks: [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff',
        layout: { columns: 4, rows: 4, items: [hit], connections: [] } }],
    }
    migrateSavedProject(project)
    assert.equal(hit.settings.instrumentParams.playback, 'loop')
    assert.equal(hit.settings.instrumentParams.loopMode, 'back-and-forth')
    assert.equal(isSavedProject(project), true)
    hit.settings.instrumentParams.loopMode = 'once'
    assert.equal(isSavedProject(project), false)
    hit.settings.instrumentParams.playback = 'order'
    hit.settings.instrumentParams.envelope.release = 10
    assert.equal(isSavedProject(project), true)
    hit.settings.instrumentParams.envelope.release = 10.01
    assert.equal(isSavedProject(project), false)
    hit.settings.instrumentParams.envelope.release = 10
    const loop = createControl('loop', 1, 0, 'instrument-pad', 'sample-loop')
    loop.settings.instrumentParams.playback = 'loop'
    project.banks[0].layout.items.push(loop)
    assert.equal(isSavedProject(project), false)
  } finally {
    await server.close()
  }
})

test('project assets discover legacy samples and update all matching pads without removing them', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { samplesInBanks, replaceSampleInBanks } = await server.ssrLoadModule('/src/sampleAssets.ts')
    const hit = createControl('hit', 0, 0, 'instrument-pad', 'sample-hit')
    const loop = createControl('loop', 1, 0, 'instrument-pad', 'sample-loop')
    const other = createControl('other', 2, 0, 'instrument-pad', 'sample-hit')
    const old = 'data:audio/wav;base64,YQ=='
    const replacement = { name: 'new.wav', source: 'data:audio/wav;base64,Yg==' }
    Object.assign(hit.settings.instrumentParams, { sample: old, sampleName: 'old.wav', start: 0.1, end: 0.9, cuts: [0.5], playback: 'loop', loopMode: 'loop' })
    Object.assign(loop.settings.instrumentParams, { sample: old, sampleName: 'old.wav', loopStart: 0.2, loopEnd: 0.8, cuts: [0.5], playback: 'cut:1' })
    Object.assign(other.settings.instrumentParams, { sample: replacement.source, sampleName: replacement.name })
    const banks = [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff',
      layout: { columns: 4, rows: 4, items: [hit, loop, other], connections: [] } }]
    assert.deepEqual(samplesInBanks(banks), [{ name: 'old.wav', source: old }, replacement])
    replaceSampleInBanks(banks, old, replacement)
    assert.equal(hit.settings.instrumentParams.sample, replacement.source)
    assert.equal(hit.settings.instrumentParams.playback, 'loop')
    assert.deepEqual([hit.settings.instrumentParams.start, hit.settings.instrumentParams.end, hit.settings.instrumentParams.cuts], [0, 1, []])
    assert.deepEqual([loop.settings.instrumentParams.loopStart, loop.settings.instrumentParams.loopEnd, loop.settings.instrumentParams.cuts, loop.settings.instrumentParams.playback], [0, 1, [], 'order'])
    replaceSampleInBanks(banks, replacement.source)
    assert.equal(banks[0].layout.items.length, 3)
    for (const item of banks[0].layout.items) {
      assert.equal(item.settings.instrumentParams.sample, '')
      assert.equal(item.settings.instrumentParams.sampleName, '')
    }
  } finally {
    await server.close()
  }
})

test('project archives preserve unused assets and reject invalid asset lists', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { saveProjectToFile, loadProjectFromFile } = await server.ssrLoadModule('/src/saveManager.ts')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const asset = { name: 'unused.wav', source: 'data:audio/wav;base64,YQ==' }
    const hit = createControl('hit', 0, 0, 'instrument-pad', 'sample-hit')
    Object.assign(hit.settings.instrumentParams, { sample: asset.source, sampleName: asset.name })
    const project = { version: 1, bpm: 120, selectedBankId: 'A', assets: [asset, { name: 'unused.wav', source: 'data:audio/webm;codecs=opus;base64,Yg==' }],
      banks: [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff',
        layout: { columns: 4, rows: 4, items: [hit], connections: [] } }] }
    const archive = await saveProjectToFile(project)
    const reader = new ZipReader(new BlobReader(archive))
    try {
      const entries = await reader.getEntries()
      assert.ok(entries.some((entry) => entry.filename === 'samples/unused.wav'))
      assert.ok(entries.some((entry) => entry.filename === 'samples/unused-2.wav'))
      for (const entry of entries.filter((entry) => entry.filename.endsWith('.json'))) {
        assert.doesNotMatch(await entry.getData(new TextWriter()), /data:audio/)
      }
    } finally {
      await reader.close()
    }
    const loaded = await loadProjectFromFile(archive)
    assert.deepEqual(loaded.assets, project.assets)
    assert.equal(loaded.banks[0].layout.items[0].settings.instrumentParams.sample, asset.source)
    assert.equal(isSavedProject({ ...project, assets: undefined }), true)
    project.assets.push(asset)
    assert.equal(isSavedProject(project), false)
    project.assets = [{ name: 'invalid', source: 'https://example.com/audio.wav' }]
    assert.equal(isSavedProject(project), false)
  } finally {
    await server.close()
  }
})

test('older ZIP projects with embedded pad samples still load', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { loadProjectFromFile } = await server.ssrLoadModule('/src/saveManager.ts')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { samplesInBanks } = await server.ssrLoadModule('/src/sampleAssets.ts')
    const hit = createControl('hit', 0, 0, 'instrument-pad', 'sample-hit')
    Object.assign(hit.settings.instrumentParams, { sample: 'data:audio/wav;base64,YQ==', sampleName: 'legacy.wav' })
    const bank = { id: 'A', title: 'A', icon: 'A', color: '#ffffff',
      layout: { columns: 4, rows: 4, items: [hit], connections: [] } }
    const writer = new ZipWriter(new BlobWriter())
    await writer.add('manifest.json', new TextReader(JSON.stringify({ version: 1, bpm: 120, selectedBankId: 'A', bankFiles: ['banks/bank-1.json'] })))
    await writer.add('banks/bank-1.json', new TextReader(JSON.stringify(bank)))
    const project = await loadProjectFromFile(await writer.close())
    assert.deepEqual(samplesInBanks(project.banks), [{ name: 'legacy.wav', source: 'data:audio/wav;base64,YQ==' }])
  } finally {
    await server.close()
  }
})
