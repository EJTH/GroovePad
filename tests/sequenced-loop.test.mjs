import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'

test('sequenced loops overdub live notes, play original instruments and release at boundaries', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { SequencedLoopEngine } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.syncMode = 'immediate'
    let beat = 0
    const events = []
    const engine = new SequencedLoopEngine(() => [loop], () => beat, (id, note, on) => events.push({ id, note, on }))
    engine.toggle(loop)
    engine.tick()
    beat = 0.5
    engine.record('bass', 60, 110, 0.25, true)
    engine.record('drums', 36, 90, undefined, true)
    beat = 1.5
    engine.record('bass', 60, 110, 0.25, false)
    engine.record('drums', 36, 90, undefined, false)
    assert.deepEqual(loop.settings.clips[0].map(({ instrumentId, position, duration }) => [instrumentId, position, duration]),
      [['bass', 0.5, 1], ['drums', 0.5, 1]])
    beat = 4.5
    engine.tick()
    assert.deepEqual(events.filter((event) => event.on).map((event) => event.note.instrumentId), ['bass', 'drums'])
    beat = 5.5
    engine.tick()
    assert.equal(events.filter((event) => !event.on).length, 2)
    engine.record('bass', 64, 80, undefined, true)
    beat = 6
    engine.stop()
    assert.equal(loop.settings.clips[0].length, 3)
    assert.equal(loop.settings.clips[0][2].duration, 0.5)
  } finally { await server.close() }
})

test('sync waits for clip-length boundaries and switches without playing the old boundary twice', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { SequencedLoopEngine } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.clips[0].push({ instrumentId: 'pad', note: 60, velocity: 100, position: 0, duration: 1 })
    loop.settings.clips[1] = [{ instrumentId: 'pad', note: 62, velocity: 100, position: 0, duration: 1 }]
    let beat = 1
    const events = []
    const engine = new SequencedLoopEngine(() => [loop], () => beat, (_id, note, on) => events.push([note.note, on]))
    engine.toggle(loop)
    engine.tick()
    assert.equal(engine.isPending('loop'), true)
    beat = 4
    engine.tick()
    assert.deepEqual(events, [[60, true]])
    loop.settings.clipIndex = 1
    beat = 5
    engine.tick()
    beat = 8
    engine.tick()
    assert.deepEqual(events, [[60, true], [60, false], [62, true]])
    engine.toggle(loop)
    assert.deepEqual(events.at(-1), [62, false])
  } finally { await server.close() }
})

test('loop data is copied independently and validates through project save/load', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl, copyControl } = await server.ssrLoadModule('/src/grid.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const { saveProjectToFile, loadProjectFromFile } = await server.ssrLoadModule('/src/saveManager.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.clips[0].push({ instrumentId: 'pad', note: 60, velocity: 100, position: 3.5, duration: 1 })
    const copy = copyControl(loop, 'copy')
    copy.settings.clips[0][0].note = 61
    assert.equal(loop.settings.clips[0][0].note, 60)
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{
      id: 'A', title: 'A', icon: 'A', color: '#ffffff',
      layout: { columns: 1, rows: 1, items: [loop], connections: [] },
    }] }
    assert.equal(isSavedProject(project), true)
    const loaded = await loadProjectFromFile(await saveProjectToFile(project))
    assert.deepEqual(loaded.banks[0].layout.items[0].settings.clips, loop.settings.clips)
    loop.settings.clips[0][0].position = 4
    assert.equal(isSavedProject(project), false)
  } finally { await server.close() }
})

test('transport beat position remains continuous across tempo changes', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { TransportClock } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    let now = 0
    const clock = new TransportClock(() => now)
    clock.start(120)
    now = 1000
    clock.setTempo(60)
    now = 2000
    assert.equal(clock.position(), 3)
    clock.stop()
    now = 4000
    assert.equal(clock.position(), 3)
    clock.start(60)
    assert.equal(clock.position(), 0)
  } finally { await server.close() }
})

test('one-bar count-in clicks before armed playback and recording, including clip changes', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { SequencedLoopEngine } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    Object.assign(loop.settings, { armed: true, countIn: true, syncMode: 'immediate' })
    loop.settings.clips[0].push({ instrumentId: 'pad', note: 60, velocity: 100, position: 0, duration: 1 })
    loop.settings.clips[1] = [{ instrumentId: 'pad', note: 62, velocity: 100, position: 0, duration: 1 }]
    let beat = 0
    const clicks = []
    const played = []
    const engine = new SequencedLoopEngine(() => [loop], () => beat, (_id, note, on) => played.push([note.note, on]),
      () => {}, '', (item) => item.settings.clipIndex, (value) => clicks.push(value))
    engine.toggle(loop)
    engine.tick()
    assert.equal(engine.isCounting('loop'), true)
    beat = 0.5
    engine.record('pad', 65, 100, undefined, true)
    engine.recordAutomation('knob', 'value', 80)
    loop.settings.clipIndex = 1
    for (beat of [1, 2, 3]) { engine.tick(); engine.tick() }
    assert.deepEqual(clicks, [0, 1, 2, 3])
    assert.deepEqual(played, [])
    assert.equal(loop.settings.automation[1]?.length ?? 0, 0)
    beat = 4
    engine.tick()
    assert.equal(engine.isCounting('loop'), false)
    assert.deepEqual(played, [[62, true]])
    engine.record('pad', 65, 100, undefined, false)
    assert.equal(loop.settings.clips[1].length, 1)
    engine.record('pad', 67, 100, undefined, true)
    beat = 4.5
    engine.record('pad', 67, 100, undefined, false)
    assert.equal(loop.settings.clips[1][1].position, 0)
    assert.equal(loop.settings.clips[1][1].duration, 0.5)
    engine.stop()
  } finally { await server.close() }
})

test('count-in respects sync boundaries and cancels on stop or disarm', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { SequencedLoopEngine } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    Object.assign(loop.settings, { armed: true, countIn: true, barLength: 2 })
    let beat = 1.5
    const clicks = []
    const engine = new SequencedLoopEngine(() => [loop], () => beat, () => {}, () => {}, '',
      (item) => item.settings.clipIndex, (value) => clicks.push(value))
    engine.toggle(loop)
    for (beat of [2, 3, 4, 5, 6, 7]) engine.tick()
    assert.deepEqual(clicks, [4, 5, 6, 7])
    assert.equal(engine.isCounting('loop'), true)
    beat = 8
    engine.tick()
    assert.equal(engine.isCounting('loop'), false)
    engine.stop()
    beat = 9
    engine.toggle(loop)
    engine.stop()
    beat = 16
    engine.tick()
    assert.deepEqual(clicks, [4, 5, 6, 7])
    beat = 17
    engine.toggle(loop)
    loop.settings.armed = false
    engine.tick()
    assert.equal(engine.isCounting('loop'), false)
  } finally { await server.close() }
})

test('metronome deduplicates simultaneous requests and skips missed beats', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { Metronome } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const clicks = []
    const metronome = new Metronome((beat) => clicks.push(beat))
    metronome.tick(0, true)
    metronome.click(0)
    metronome.tick(0.5, true)
    metronome.click(1)
    metronome.tick(1.1, true)
    metronome.tick(2, false)
    metronome.tick(2.5, true)
    metronome.tick(5.2, true)
    assert.deepEqual(clicks, [0, 1, 5])
    metronome.reset()
    metronome.tick(0, true)
    assert.deepEqual(clicks, [0, 1, 5, 0])
  } finally { await server.close() }
})

test('automation overdubs only armed clips, plays in time and clears on stop', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { SequencedLoopEngine } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.syncMode = 'immediate'
    let beat = 0
    const played = []
    const engine = new SequencedLoopEngine(() => [loop], () => beat, () => {},
      (id, event) => played.push([id, event?.value, event?.active]))
    engine.toggle(loop)
    beat = 0.5
    engine.recordAutomation('knob', 'value', 75)
    beat = 1
    engine.recordAutomation('piano', 'pressure', 0, false)
    loop.settings.armed = false
    engine.recordAutomation('knob', 'value', 80)
    assert.equal(loop.settings.automation[0].length, 2)
    beat = 4.5
    engine.tick()
    beat = 5
    engine.tick()
    assert.deepEqual(played, [['loop', 75, undefined], ['loop', 0, false]])
    engine.stop()
    assert.deepEqual(played.at(-1), ['loop', undefined, undefined])
  } finally { await server.close() }
})

test('legacy loops migrate automation and copied or saved events remain independent', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl, copyControl } = await server.ssrLoadModule('/src/grid.ts')
    const { isSavedProject, migrateSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    delete loop.settings.automation
    delete loop.settings.quantize
    delete loop.settings.recordScope
    delete loop.settings.countIn
    delete loop.settings.metronome
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{
      id: 'A', title: 'A', icon: 'A', color: '#ffffff',
      layout: { columns: 1, rows: 1, items: [loop], connections: [] },
    }] }
    migrateSavedProject(project)
    assert.equal(loop.settings.quantize, 'off')
    assert.equal(loop.settings.recordScope, 'bank')
    assert.equal(loop.settings.countIn, false)
    assert.equal(loop.settings.metronome, false)
    assert.equal(isSavedProject(project), true)
    loop.settings.automation[0] = [{ sourceId: 'knob', parameter: 'value', value: 42, position: 0.25 }]
    const copy = copyControl(loop, 'copy')
    copy.settings.automation[0][0].value = 99
    assert.equal(loop.settings.automation[0][0].value, 42)
    assert.equal(isSavedProject(JSON.parse(JSON.stringify(project))), true)
    loop.settings.automation[0][0].position = 4
    assert.equal(isSavedProject(project), false)
  } finally { await server.close() }
})

test('cross-bank note and automation references survive project export', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const { saveProjectToFile, loadProjectFromFile } = await server.ssrLoadModule('/src/saveManager.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.recordScope = 'all'
    loop.settings.clips[0].push({ bankId: 'B', instrumentId: 'pad', note: 60, velocity: 100, position: 0.5, duration: 1 })
    loop.settings.automation[0].push({ bankId: 'B', sourceId: 'knob', parameter: 'value', position: 0.25, value: 10 })
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [
      { id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout: { columns: 1, rows: 1, items: [loop], connections: [] } },
      { id: 'B', title: 'B', icon: 'B', color: '#ffffff', layout: { columns: 1, rows: 1, items: [createControl('pad', 0, 0, 'instrument-pad', '808')], connections: [] } },
    ] }
    assert.equal(isSavedProject(project), true)
    const loaded = await loadProjectFromFile(await saveProjectToFile(project))
    assert.deepEqual(loaded.banks[0].layout.items[0].settings, loop.settings)
  } finally { await server.close() }
})

test('record quantize snaps only new note starts, wraps at the loop boundary and preserves durations', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { SequencedLoopEngine } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.armed = true
    let beat = 0
    const engine = new SequencedLoopEngine(() => [loop], () => beat, () => {})
    for (const [mode, start, expected] of [['off', 0.18, 0.18], ['1/4', 0.6, 1],
      ['1/8', 0.3, 0.5], ['1/16', 0.18, 0.25], ['1/32', 0.18, 0.125], ['1/4', 3.8, 0]]) {
      loop.settings.quantize = mode
      beat = start
      engine.record('pad', 60, 100, undefined, true)
      beat = start + 0.4
      engine.record('pad', 60, 100, undefined, false)
      const note = loop.settings.clips[0].at(-1)
      assert.ok(Math.abs(note.position - expected) < 1e-10, `${mode}: ${note.position}`)
      assert.ok(Math.abs(note.duration - 0.4) < 1e-10)
    }
    assert.ok(Math.abs(loop.settings.clips[0][0].position - 0.18) < 1e-10)
    beat = 0.18
    engine.recordAutomation('knob', 'value', 50)
    assert.ok(Math.abs(loop.settings.automation[0][0].position - 0.18) < 1e-10)
  } finally { await server.close() }
})

test('clip selection permits indices 0 to 15 and the settings input exposes the same limit', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const { default: Panel } = await server.ssrLoadModule('/src/components/SequencedLoopSettingsPanel.vue')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    const layout = { columns: 1, rows: 1, items: [loop], connections: [] }
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{
      id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout,
    }] }
    assert.equal(isSavedProject(project), true)
    loop.settings.clipIndex = 15
    loop.settings.clips[15] = []
    assert.equal(isSavedProject(project), true)
    const html = await renderToString(createSSRApp({ render: () => h(Panel, { draft: loop, layout }) }))
    assert.match(html, /type="number"[^>]*max="15"/)
    assert.match(html, /Record quantize/)
    loop.settings.clipIndex = 16
    loop.settings.clips[16] = []
    assert.equal(isSavedProject(project), false)
    loop.settings.clipIndex = -1
    assert.equal(isSavedProject(project), false)
  } finally { await server.close() }
})
