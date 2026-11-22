import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { createServer } from 'vite'

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
