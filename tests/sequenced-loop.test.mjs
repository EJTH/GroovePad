import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createServer } from 'vite'
import { createRenderer, createSSRApp, h, reactive, ref } from 'vue'
import { renderToString } from '@vue/server-renderer'

function testRenderer() {
  return createRenderer({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null,
    insert() {}, remove() {}, patchProp() {},
  })
}

test('extracted loop widget forwards gestures and button actions', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const grid = await server.ssrLoadModule('/src/grid.ts')
    const loopRows = await server.ssrLoadModule('/src/loopRows.ts')
    const source = await readFile(new URL('../src/components/widgets/SequencedLoop.vue', import.meta.url), 'utf8')
    const script = compileScript(parse(source).descriptor, { id: 'loop-widget', inlineTemplate: true }).content
    const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const module = { exports: {} }
    vm.runInNewContext(code, { module, exports: module.exports,
      require: (path) => path === 'vue' ? vue : path === '../../grid' ? grid : loopRows })
    const item = grid.createControl('loop', 0, 0, 'sequenced-loop')
    item.settings.widgetButtons = { ...grid.defaultLoopWidgetButtons(), next: true, editor: true }
    const node = (type) => ({ type, children: [], props: {} })
    const renderer = createRenderer({
      createElement: node, createText: node, createComment: node,
      setText() {}, setElementText() {}, parentNode: (el) => el.parent, nextSibling: () => null,
      insert: (el, parent) => { el.parent = parent; parent.children.push(el) },
      remove() {}, patchProp: (el, key, _old, value) => { el.props[key] = value },
    })
    const calls = []
    const gesture = { down: () => calls.push('down'), move() {}, up() {}, cancel() {}, click() {} }
    const root = node('root')
    const app = renderer.createApp(module.exports.default, {
      item, original: item, wantsPlayback: false, gesture, curves: [], notes: [],
      previewX: () => 0, previewY: () => 0, previewColor: () => '',
      onKeydown: (event) => calls.push(event.key), onArm: () => calls.push('arm'),
      onChangeIndex: (delta) => calls.push(delta), onOpenEditor: () => calls.push('editor'),
    })
    app.mount(root)
    const control = root.children[0]
    control.props.onPointerdown({})
    control.props.onKeydown({ key: 'ArrowUp' })
    const actions = control.children.find((child) => child.props.class === 'loop-actions')
    const buttons = actions.children.filter((child) => child.type === 'button')
    const click = (label) => buttons.find((button) => button.props['aria-label'].startsWith(label))
      .props.onClick({ stopPropagation() {} })
    click('Arm ')
    click('Next clip')
    click('Open ')
    assert.deepEqual(calls, ['down', 'ArrowUp', 'arm', 1, 'editor'])
    app.unmount()
  } finally {
    await server.close()
  }
})

test('held repeats follow the transport and division changes and record separate notes', async (t) => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { useNoteRepeat } = await server.ssrLoadModule('/src/components/useNoteRepeat.ts')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { SequencedLoopEngine } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.syncMode = 'immediate'
    let beat = 0
    const engine = new SequencedLoopEngine(() => [loop], () => beat, () => {})
    engine.toggle(loop, 0, true)
    const division = ref('1/16')
    const sent = []
    let repeat
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
    const app = testRenderer().createApp({
      setup() {
        repeat = useNoteRepeat({
          division: () => division.value, bpm: () => 120, playing: () => true,
          clock: () => ({ repeatPosition: () => beat }),
          send: (note, on) => { sent.push([beat, on]); engine.record('piano', note, 100, undefined, on) },
        })

        return () => h('div')
      },
    })
    app.mount({})
    repeat.change(60, 60, true)
    const tick = (position) => { beat = position; t.mock.timers.tick(8) }
    tick(0.1)
    repeat.change(60, 60, false)
    assert.deepEqual(sent, [])
    repeat.change(60, 60, true)
    tick(0.21)
    assert.deepEqual(sent, [])
    tick(0.25)
    assert.deepEqual(sent, [[0.25, true]])
    tick(0.46); tick(0.5)
    division.value = '1/8'
    tick(0.91); tick(1)
    beat = 1.1
    repeat.change(60, 60, false)
    const notes = loop.settings.clips[0]
    assert.equal(notes.length, 3)
    for (const [index, position] of [0.25, 0.5, 1].entries()) {
      assert.ok(Math.abs(notes[index].position - position) < 1e-8)
      assert.ok(Math.abs(notes[index].duration - [0.21, 0.41, 0.1][index]) < 1e-8)
    }
    app.unmount()
  } finally { t.mock.timers.reset(); await server.close() }
})

test('loop volume scales notes, mute releases them, and automation remains active', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { useGridPlayback } = await server.ssrLoadModule('/src/components/useGridPlayback.ts')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { BankEventBus } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.syncMode = 'immediate'
    loop.settings.volume = 0.5
    loop.settings.clips[0].push({ instrumentId: 'piano', note: 60, velocity: 100, position: 0, duration: 2 })
    loop.settings.automation[0].push({ sourceId: 'knob', parameter: 'value', value: 30, position: 1 })
    const layout = reactive({ columns: 1, rows: 1, items: [loop], connections: [] })
    const bus = new BankEventBus()
    const events = []
    bus.subscribe((event) => events.push(event))
    const playing = ref(false)
    let beat = 0
    let playback
    const app = testRenderer().createApp({
      setup() {
        playback = useGridPlayback({
          layout: () => layout, banks: () => undefined, bankId: 'A', bankEvents: bus,
          clock: { position: () => beat }, playing: () => playing.value, editing: () => false,
          transportStartImmediate: () => true, triggeredByInput: () => false,
          startOnInput: () => undefined, signals: new Map(), routeNote() {},
        })
        return () => h('div')
      },
    })
    app.mount({})
    playback.toggleLoopPlayback('loop')
    playing.value = true
    assert.equal(events.find((event) => event.kind === 'loop-note' && event.on)?.note.velocity, 50)
    layout.items[0].settings.muted = true
    assert.ok(events.some((event) => event.kind === 'loop-note' && !event.on))
    beat = 1
    playback.loopEngine.tick()
    assert.ok(events.some((event) => event.kind === 'loop-automation' && event.event?.value === 30))
    beat = 4
    playback.loopEngine.tick()
    assert.equal(events.filter((event) => event.kind === 'loop-note' && event.on).length, 1)
    app.unmount()
  } finally { await server.close() }
})

test('current-bank loops record and replay surfaced controls in nested grids', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  const apps = []
  try {
    const { useGridPlayback } = await server.ssrLoadModule('/src/components/useGridPlayback.ts')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { BankEventBus } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    Object.assign(loop.settings, { armed: true, syncMode: 'immediate' })
    const sub = createControl('sub', 1, 0, 'sub-grid')
    const inner = createControl('inner', 0, 0, 'sub-grid')
    const knob = createControl('knob', 0, 0, 'knob')
    const piano = createControl('piano', 1, 0, 'piano-roll')
    inner.settings.layout.items.push(knob, piano)
    inner.settings.surfaceItemIds.push(knob.id, piano.id)
    sub.settings.layout.items.push(inner)
    const layout = reactive({ columns: 2, rows: 1, items: [loop, sub], connections: [] })
    const other = reactive({ columns: 1, rows: 1, items: [createControl('knob', 0, 0, 'knob')], connections: [] })
    const banks = [{ id: 'A', title: 'A', layout }, { id: 'B', title: 'B', layout: other }]
    const bus = new BankEventBus()
    const routed = []
    let beat = 0
    const createPlayback = (id, grid) => {
      let playback
      const app = testRenderer().createApp({
        setup() {
          playback = useGridPlayback({
            layout: () => grid, banks: () => banks, bankId: id, bankEvents: bus,
            clock: { position: () => beat }, playing: () => true, editing: () => false,
            transportStartImmediate: () => true, triggeredByInput: () => false,
            startOnInput: () => undefined, signals: new Map(), routeNote: (id, output) => routed.push([id, output.on]),
          })
          return () => h('div')
        },
      })
      app.mount({})
      apps.push(app)
      return playback
    }
    const root = createPlayback('A', layout)
    const nested = createPlayback('A/sub/inner', layout.items[1].settings.layout.items[0].settings.layout)
    const unrelated = createPlayback('B', other)
    root.toggleLoop('loop')
    beat = 0.5
    nested.controlActivity('knob', true)
    bus.emit({ kind: 'live-automation', bankId: 'A/sub/inner', sourceId: 'knob', parameter: 'value', value: 30, motion: true })
    nested.controlActivity('knob', false)
    bus.emit({ kind: 'live-automation', bankId: 'B', sourceId: 'knob', parameter: 'value', value: 90 })
    assert.deepEqual(loop.settings.automation[0].map((event) => [event.bankId, event.value]), [['A/sub/inner', 30]])
    nested.captureNote('piano', 60, true, 100)
    beat = 0.75
    nested.captureNote('piano', 60, false, 100)
    assert.equal(loop.settings.clips[0][0].bankId, 'A/sub/inner')
    loop.settings.armed = false
    beat = 4.5
    root.loopEngine.tick()
    assert.equal(nested.displayItems.value[0].settings.value, 30)
    assert.equal(unrelated.displayItems.value[0].settings.value, 64)
    assert.deepEqual(routed, [['piano', true]])
    beat = 4.75
    root.loopEngine.tick()
    assert.deepEqual(routed, [['piano', true], ['piano', false]])
  } finally {
    for (const app of apps.reverse()) app.unmount()
    await server.close()
  }
})

test('volume mode presents sliders and mute buttons only for controls with volume', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: GrooveGrid } = await server.ssrLoadModule('/src/components/GrooveGrid.vue')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.volume = 0.4
    loop.settings.muted = true
    const instrument = createControl('instrument', 1, 0, 'instrument-pad', '303')
    const piano = createControl('piano', 2, 0, 'piano-roll')
    const html = await renderToString(createSSRApp({ render: () => h(GrooveGrid, {
      layout: { columns: 3, rows: 1, items: [loop, instrument, piano], connections: [] },
      editing: false, wiring: false, volumeMode: true, settingsOpen: false, bpm: 120,
    }) }))
    assert.match(html, /aria-label="Loop sequencer volume"[^>]*aria-valuenow="40"/)
    assert.match(html, /aria-label="Unmute Loop sequencer"/)
    assert.match(html, /aria-label="303 Pad volume"/)
    assert.doesNotMatch(html, /aria-label="Piano volume"/)
  } finally { await server.close() }
})

test('loop tiles preview the selected clip and expose separate arm and play controls', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: GrooveGrid } = await server.ssrLoadModule('/src/components/GrooveGrid.vue')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.clips['0'] = [{ instrumentId: 'pad', note: 60, velocity: 100, position: 0, duration: 0.5 }]
    loop.settings.automation['0'] = [
      { sourceId: 'knob', parameter: 'value', value: 20, position: 0 },
      { sourceId: 'knob', parameter: 'value', value: 80, position: 2 },
    ]
    const layout = { columns: 1, rows: 1, items: [loop], connections: [] }
    const render = () => renderToString(createSSRApp({ render: () => h(GrooveGrid, {
      layout, editing: false, wiring: false, settingsOpen: false, bpm: 120, playing: false,
    }) }))
    const firstClip = await render()
    assert.match(firstClip, /aria-label="Arm Loop sequencer for recording"/)
    assert.match(firstClip, /aria-label="Play Loop sequencer when playback starts"/)
    assert.match(firstClip, /aria-label="Clear clip 0 in Loop sequencer"/)
    assert.match(firstClip, /class="loop-preview-note"[^>]*cx="0"/)
    assert.match(firstClip, /class="loop-preview-curve"[^>]*d="M0,44 Q25,44 50,8"/)

    loop.settings.clips['1'] = [{ instrumentId: 'pad', note: 80, velocity: 100, position: 3, duration: 0.5 }]
    loop.settings.automation['1'] = [{ sourceId: 'knob', parameter: 'value', value: 45, position: 3 }]
    loop.settings.clipIndex = 1
    const secondClip = await render()
    assert.match(secondClip, /class="loop-preview-note"[^>]*cx="75"/)
    assert.match(secondClip, /class="loop-preview-curve"[^>]*d="M73\.5,24 Q75,22 76\.5,24"/)
  } finally { await server.close() }
})

test('loop widget button settings persist, copy independently and control the visible actions', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: GrooveGrid } = await server.ssrLoadModule('/src/components/GrooveGrid.vue')
    const { default: Panel } = await server.ssrLoadModule('/src/components/widgets/SequencedLoopSettingsPanel.vue')
    const { createControl, copyControl, defaultLoopWidgetButtons, nextLoopQuantize } = await server.ssrLoadModule('/src/grid.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    const layout = { columns: 1, rows: 1, items: [loop], connections: [] }
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout }] }
    const render = () => renderToString(createSSRApp({ render: () => h(GrooveGrid, {
      layout, editing: false, wiring: false, settingsOpen: false, bpm: 120, playing: false,
    }) }))
    const initial = await render()
    assert.match(initial, /aria-label="Arm Loop sequencer for recording"/)
    assert.match(initial, /aria-label="Play Loop sequencer when playback starts"/)
    assert.match(initial, /aria-label="Clear clip 0 in Loop sequencer"/)
    assert.doesNotMatch(initial, /aria-label="Open Loop sequencer editor"/)
    const settings = await renderToString(createSSRApp({ render: () => h(Panel, { draft: loop, layout }) }))
    for (const label of ['Play/Pause', 'Arm Recording', 'Clear clip', 'Clone clip', 'Next clip', 'Previous clip', 'Open Editor', 'Quantization']) {
      assert.ok(settings.includes(label), label)
    }
    loop.settings.widgetButtons = { ...defaultLoopWidgetButtons(), play: false, arm: false, clear: false,
      clone: true, next: true, previous: true, editor: true, quantize: true }
    const enabled = await render()
    assert.doesNotMatch(enabled, /aria-label="Arm Loop sequencer for recording"/)
    assert.doesNotMatch(enabled, /aria-label="Play Loop sequencer when playback starts"/)
    assert.doesNotMatch(enabled, /aria-label="Clear clip 0 in Loop sequencer"/)
    for (const label of ['Clone clip 0 in Loop sequencer', 'Next clip in Loop sequencer',
      'Previous clip in Loop sequencer', 'Open Loop sequencer editor']) assert.ok(enabled.includes(`aria-label="${label}"`), label)
    assert.ok(enabled.indexOf('aria-label="Previous clip in Loop sequencer"') < enabled.indexOf('aria-label="Next clip in Loop sequencer"'))
    assert.match(enabled, /Q OFF/)
    assert.match(enabled, /disabled[^>]*aria-label="Previous clip in Loop sequencer"/)
    assert.equal(isSavedProject(JSON.parse(JSON.stringify(project))), true)
    const copy = copyControl(loop, 'copy')
    copy.settings.widgetButtons.editor = false
    assert.equal(loop.settings.widgetButtons.editor, true)
    loop.settings.widgetButtons.editor = 'yes'
    assert.equal(isSavedProject(project), false)
    let quantize = 'off'
    const cycle = []
    for (let i = 0; i < 5; i++) { quantize = nextLoopQuantize(quantize); cycle.push(quantize) }
    assert.deepEqual(cycle, ['1/4', '1/8', '1/16', '1/32', 'off'])
  } finally { await server.close() }
})

test('loop preview colors events by their source control and bank', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: GrooveGrid } = await server.ssrLoadModule('/src/components/GrooveGrid.vue')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    const knob = createControl('knob', 1, 0, 'knob')
    knob.settings.color = '#123456'
    const remote = createControl('pad', 0, 0, 'piano-roll')
    remote.settings.color = '#abcdef'
    loop.settings.clips[0].push({ bankId: 'B', instrumentId: 'pad', note: 60, velocity: 100, position: 0, duration: 1 })
    loop.settings.automation[0].push({ sourceId: 'knob', parameter: 'value', value: 10, position: 0 })
    const layout = { columns: 2, rows: 1, items: [loop, knob], connections: [] }
    const banks = [
      { id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout },
      { id: 'B', title: 'B', icon: 'B', color: '#ffffff', layout: { columns: 1, rows: 1, items: [remote], connections: [] } },
    ]
    const html = await renderToString(createSSRApp({ render: () => h(GrooveGrid, {
      layout, banks, bankId: 'A', editing: false, wiring: false, settingsOpen: false, bpm: 120, playing: false,
    }) }))
    assert.match(html, /class="loop-preview-curve"[^>]*style="stroke:#123456;"/)
    assert.match(html, /class="loop-preview-note"[^>]*style="fill:#abcdef;"/)
  } finally { await server.close() }
})

test('older projects with multiple armed loops retain only the first armed loop', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { migrateSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const loops = [createControl('one', 0, 0, 'sequenced-loop'), createControl('two', 0, 0, 'sequenced-loop')]
    loops.forEach((loop) => { loop.settings.armed = true })
    const project = { version: 1, banks: loops.map((loop) => ({ layout: { items: [loop] } })) }
    migrateSavedProject(project)
    assert.equal(loops[0].settings.armed, true)
    assert.equal(loops[1].settings.armed, false)
    migrateSavedProject(project)
    assert.equal(loops[0].settings.armed, true)
    assert.equal(loops[1].settings.armed, false)
  } finally { await server.close() }
})

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
    loop.settings.volume = 0.5
    loop.settings.muted = true
    loop.settings.countIn = true
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
    assert.equal(loaded.banks[0].layout.items[0].settings.volume, 0.5)
    assert.equal(loaded.banks[0].layout.items[0].settings.muted, true)
    assert.equal(loaded.banks[0].layout.items[0].settings.countIn, true)
    loop.settings.clips[0][0].position = 4
    assert.equal(isSavedProject(project), false)
  } finally { await server.close() }
})

test('loop play choices survive project export and restore playback on transport start', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  const apps = []
  try {
    const { useGridPlayback } = await server.ssrLoadModule('/src/components/useGridPlayback.ts')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { BankEventBus } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const { isSavedProject, migrateSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const { saveProjectToFile, loadProjectFromFile } = await server.ssrLoadModule('/src/saveManager.ts')
    const ready = createControl('ready', 0, 0, 'sequenced-loop')
    const paused = createControl('paused', 1, 0, 'sequenced-loop')
    const legacy = createControl('legacy', 2, 0, 'sequenced-loop')
    paused.settings.armed = true
    const project = reactive({ version: 1, bpm: 120, selectedBankId: 'A', banks: [{
      id: 'A', title: 'A', icon: 'A', color: '#ffffff',
      layout: { columns: 3, rows: 1, items: [ready, paused, legacy], connections: [] },
    }] })
    const playing = ref(false)
    function mount(layout) {
      let playback
      const app = testRenderer().createApp({
        setup() {
          playback = useGridPlayback({
            layout: () => layout, banks: () => undefined, bankId: 'A', bankEvents: new BankEventBus(),
            clock: { position: () => 0 }, playing: () => playing.value, editing: () => false,
            transportStartImmediate: () => true, triggeredByInput: () => false,
            startOnInput: () => undefined, signals: new Map(), routeNote() {},
          })
          return () => h('div')
        },
      })
      app.mount({})
      apps.push(app)
      return playback
    }
    const playback = mount(project.banks[0].layout)
    assert.equal(playback.loopWantsPlayback(legacy), false)
    assert.equal(playback.loopWantsPlayback(paused), true)
    playback.toggleLoopPlayback('ready')
    playback.toggleLoopPlayback('paused')
    assert.equal(ready.settings.playing, true)
    assert.equal(paused.settings.playing, false)
    const loaded = await loadProjectFromFile(await saveProjectToFile(project))
    migrateSavedProject(loaded)
    assert.equal(isSavedProject(loaded), true)
    const restored = mount(reactive(loaded.banks[0].layout))
    playing.value = true
    assert.equal(restored.loopEngine.isEnabled('ready'), true)
    assert.equal(restored.loopEngine.isEnabled('paused'), false)
    assert.equal(restored.loopEngine.isEnabled('legacy'), false)
    restored.toggleLoopPlayback('ready')
    assert.equal(loaded.banks[0].layout.items[0].settings.playing, false)
    playing.value = false
    playing.value = true
    assert.equal(restored.loopEngine.isEnabled('ready'), false)
    loaded.banks[0].layout.items[0].settings.playing = 'yes'
    assert.equal(isSavedProject(loaded), false)
  } finally {
    for (const app of apps) app.unmount()
    await server.close()
  }
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

test('stopped repeat timing shares a continuous tempo-aware clock', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { TransportClock } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    let now = 0
    const clock = new TransportClock(() => now)
    now = 1000
    assert.equal(clock.repeatPosition(), 2)
    clock.setTempo(60)
    now = 2000
    assert.equal(clock.repeatPosition(), 3)
    clock.start(60)
    now = 3000
    clock.stop()
    now = 4000
    assert.equal(clock.position(), 1)
    assert.equal(clock.repeatPosition(), 2)
  } finally { await server.close() }
})

test('legacy count-in settings do not delay playback or recording', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { SequencedLoopEngine } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    Object.assign(loop.settings, { armed: true, countIn: true, syncMode: 'immediate' })
    loop.settings.clips[0].push({ instrumentId: 'pad', note: 60, velocity: 100, position: 0, duration: 1 })
    let beat = 0
    const played = []
    const engine = new SequencedLoopEngine(() => [loop], () => beat, (_id, note, on) => played.push([note.note, on]))
    engine.toggle(loop)
    engine.tick()
    assert.deepEqual(played, [[60, true]])
    beat = 0.5
    engine.record('pad', 65, 100, undefined, true)
    engine.recordAutomation('knob', 'value', 80)
    assert.equal(loop.settings.automation[0].length, 1)
    beat = 0.75
    engine.record('pad', 65, 100, undefined, false)
    assert.equal(loop.settings.clips[0][1].position, 0.5)
    assert.equal(loop.settings.clips[0][1].duration, 0.25)
    engine.stop()
  } finally { await server.close() }
})

test('legacy count-in settings preserve normal sync boundaries', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { SequencedLoopEngine } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    Object.assign(loop.settings, { armed: true, countIn: true, barLength: 2 })
    let beat = 1.5
    const engine = new SequencedLoopEngine(() => [loop], () => beat, () => {})
    engine.toggle(loop)
    assert.equal(engine.isPending('loop'), true)
    beat = 7
    engine.tick()
    assert.equal(engine.isPending('loop'), true)
    beat = 8
    engine.tick()
    assert.equal(engine.isPending('loop'), false)
    assert.equal(engine.playhead('loop', 0), 0)
    engine.stop()
    engine.toggle(loop)
    engine.tick()
    assert.equal(engine.isPending('loop'), false)
    assert.equal(engine.playhead('loop', 0), 0)
    engine.stop()
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

test('motion records at 1/32 intervals and preserves final values and separate gestures', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { SequencedLoopEngine } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.recordScope = 'all'
    loop.settings.syncMode = 'immediate'
    loop.settings.automation[0] = [{ sourceId: 'knob', parameter: 'value', value: -1, position: 0 }]
    let beat = 0
    const engine = new SequencedLoopEngine(() => [loop], () => beat, () => {}, () => {}, 'A')
    engine.toggle(loop)
    for (let i = 0; i < 320; i++) {
      beat = i / 80
      engine.recordAutomation('knob', 'value', i, undefined, 'B', true)
    }
    const events = loop.settings.automation[0]
    assert.equal(events.length, 33)
    assert.equal(events[0].value, -1)
    assert.equal(events[1].value, 0)
    assert.equal(events.at(-1).value, 310)
    engine.endAutomation('knob', 'value', 'B')
    assert.equal(events.length, 34)
    assert.equal(events.at(-1).value, 319)
    assert.equal(events.at(-1).bankId, 'B')
    assert.ok(Math.abs(events.at(-1).position - 319 / 80) < 1e-10)

    beat = 4.01
    engine.recordAutomation('knob', 'value', 20, undefined, 'B', true)
    engine.endAutomation('knob', 'value', 'B')
    beat = 4.02
    engine.recordAutomation('knob', 'value', 21, undefined, 'B', true)
    assert.deepEqual(events.slice(-2).map((event) => event.value), [20, 21])
    engine.recordAutomation('piano', 'pressure', 50, true, 'B', true)
    engine.recordAutomation('piano', 'pressure', 60, true, 'B', true)
    engine.recordAutomation('piano', 'pressure', 0, false, 'B', true)
    assert.deepEqual(events.slice(-3).map((event) => [event.value, event.active]), [[50, true], [60, true], [0, false]])
    engine.recordAutomation('pad', 'gate', 1, undefined, 'B')
    engine.recordAutomation('pad', 'gate', 0, undefined, 'B')
    assert.deepEqual(events.slice(-2).map((event) => event.value), [1, 0])
    engine.recordAutomation('shared', 'value', 10, undefined, 'A', true)
    engine.recordAutomation('shared', 'value', 20, undefined, 'B', true)
    engine.recordAutomation('shared', 'value', 11, undefined, 'A', true)
    engine.recordAutomation('shared', 'value', 21, undefined, 'B', true)
    engine.endAutomation('shared', 'value', 'A')
    engine.endAutomation('shared', 'value', 'B')
    assert.deepEqual(events.slice(-4).map((event) => [event.bankId ?? 'A', event.value]),
      [['A', 10], ['B', 20], ['A', 11], ['B', 21]])
    engine.recordAutomation('wheel', 'value', 0.1, undefined, 'B', true)
    engine.recordAutomation('wheel', 'value', 0.9, undefined, 'B', true)
    engine.stop()
    assert.deepEqual(events.slice(-2).map((event) => event.value), [0.1, 0.9])
  } finally { await server.close() }
})

test('motion final values stay in their clip and clearing a clip does not restore them', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { SequencedLoopEngine } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.syncMode = 'immediate'
    let beat = 0
    const engine = new SequencedLoopEngine(() => [loop], () => beat, () => {})
    engine.toggle(loop)
    beat = 0.01
    engine.recordAutomation('knob', 'value', 10, undefined, '', true)
    beat = 0.02
    engine.recordAutomation('knob', 'value', 20, undefined, '', true)
    loop.settings.clipIndex = 1
    beat = 0.03
    engine.recordAutomation('knob', 'value', 30, undefined, '', true)
    assert.deepEqual(loop.settings.automation[0].map((event) => event.value), [10, 20])
    assert.deepEqual(loop.settings.automation[1].map((event) => event.value), [30])
    beat = 0.04
    engine.recordAutomation('knob', 'value', 40, undefined, '', true)
    loop.settings.automation[1] = []
    engine.endAutomation('knob', 'value')
    assert.deepEqual(loop.settings.automation[1], [])
    engine.stop()
  } finally { await server.close() }
})

test('motion punch-in replaces only the touched lane and interval across loop boundaries', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { SequencedLoopEngine } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = reactive(createControl('loop', 0, 0, 'sequenced-loop'))
    Object.assign(loop.settings, { armed: true, recordScope: 'all', syncMode: 'immediate' })
    loop.settings.clips[0].push({ instrumentId: 'pad', note: 60, velocity: 100, position: 0.2, duration: 1 })
    loop.settings.automation[0] = [
      ...[0.2, 1, 2, 3.8].map((position) => ({ sourceId: 'knob', parameter: 'value', value: -1, position })),
      { bankId: 'B', sourceId: 'knob', parameter: 'value', value: -2, position: 0.2 },
      { sourceId: 'other', parameter: 'value', value: -3, position: 0.2 },
    ]
    let beat = 0
    const engine = new SequencedLoopEngine(() => [loop], () => beat, () => {}, () => {}, 'A')
    engine.toggle(loop)
    beat = 3.5
    engine.recordAutomation('knob', 'value', 10, undefined, 'A', true)
    beat = 4.5
    engine.recordAutomation('knob', 'value', 20, undefined, 'A', true)
    beat = 5.2
    engine.endAutomation('knob', 'value', 'A')
    const events = loop.settings.automation[0]
    assert.deepEqual(events.filter((event) => event.value < 0).map((event) => [event.sourceId, event.bankId, event.position]),
      [['knob', undefined, 2], ['knob', 'B', 0.2], ['other', undefined, 0.2]])
    assert.deepEqual(events.filter((event) => event.value > 0).map((event) => event.value), [10, 20])
    assert.equal(loop.settings.clips[0].length, 1)

    beat = 5.5
    engine.recordAutomation('knob', 'value', 30, undefined, 'A', true)
    beat = 10
    engine.tick()
    engine.recordAutomation('knob', 'value', 40, undefined, 'A', true)
    engine.endAutomation('knob', 'value', 'A')
    assert.deepEqual(events.filter((event) => event.sourceId === 'knob' && !event.bankId).map((event) => event.value), [30, 40])
    assert.equal(events.filter((event) => event.bankId === 'B').length, 1)
  } finally { await server.close() }
})

test('loop playhead follows the active clip origin and hides before start or for another clip', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { SequencedLoopEngine } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    let beat = 1
    const engine = new SequencedLoopEngine(() => [loop], () => beat, () => {})
    engine.toggle(loop)
    assert.equal(engine.playhead('loop', 0), undefined)
    beat = 5
    engine.tick()
    assert.equal(engine.playhead('loop', 0), 0.25)
    assert.equal(engine.playhead('loop', 1), undefined)
    beat = 8.5
    assert.equal(engine.playhead('loop', 0), 0.125)
    engine.stop()
    assert.equal(engine.playhead('loop', 0), undefined)
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
    const { default: Panel } = await server.ssrLoadModule('/src/components/widgets/SequencedLoopSettingsPanel.vue')
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

test('row copy, paste, removal and cloning preserve identities and mute state independently', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl, copyControl } = await server.ssrLoadModule('/src/grid.ts')
    const { copyRow, pasteRow, removeRow, cloneClip } = await server.ssrLoadModule('/src/loopRows.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    const row = { kind: 'note', instrumentId: 'piano', note: 60 }
    loop.settings.clips[0] = [
      { instrumentId: 'piano', note: 60, velocity: 80, position: 0, duration: 1 },
      { instrumentId: 'piano', bankId: 'B', note: 60, velocity: 90, position: 1, duration: 1 },
    ]
    loop.settings.mutedRows = { 0: [row] }
    const copied = copyRow(loop.settings, 0, row, 'A')
    loop.settings.clips[1] = [{ instrumentId: 'piano', bankId: 'A', note: 60, velocity: 10, position: 2, duration: 1 }]
    pasteRow(loop.settings, 1, copied, 'A')
    assert.deepEqual(loop.settings.clips[1], [loop.settings.clips[0][0]])
    assert.notEqual(loop.settings.clips[1][0], loop.settings.clips[0][0])
    assert.deepEqual(loop.settings.mutedRows[1], [row])
    assert.equal(cloneClip(loop.settings, 1), 2)
    loop.settings.clips[2][0].velocity = 20
    loop.settings.mutedRows[2][0].note = 61
    assert.equal(loop.settings.clips[1][0].velocity, 80)
    assert.equal(loop.settings.mutedRows[1][0].note, 60)
    removeRow(loop.settings, 0, row, 'A')
    assert.equal(loop.settings.clips[0].length, 1)
    assert.equal(loop.settings.clips[0][0].bankId, 'B')
    const automationRow = { kind: 'automation', sourceId: 'knob', parameter: 'value' }
    loop.settings.automation[0] = [{ sourceId: 'knob', parameter: 'value', position: 0.5, value: 42, active: true }]
    pasteRow(loop.settings, 1, copyRow(loop.settings, 0, automationRow, 'A'), 'A')
    assert.deepEqual(loop.settings.automation[1], loop.settings.automation[0])
    removeRow(loop.settings, 1, automationRow, 'A')
    assert.deepEqual(loop.settings.automation[1], [])
    const clone = copyControl(loop, 'copy')
    clone.settings.mutedRows[1][0].note = 62
    assert.equal(loop.settings.mutedRows[1][0].note, 60)
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{
      id: 'A', title: 'A', icon: 'A', color: '#ffffff',
      layout: { columns: 1, rows: 1, items: [loop], connections: [] },
    }] }
    assert.equal(isSavedProject(JSON.parse(JSON.stringify(project))), true)
    loop.settings.mutedRows[1][0].note = 128
    assert.equal(isSavedProject(project), false)
    for (let i = 3; i <= 15; i++) loop.settings.clips[i] = []
    assert.equal(cloneClip(loop.settings, 0), undefined)
  } finally { await server.close() }
})

test('row mute releases only its own routed automation', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  let app
  try {
    const { useGridPlayback } = await server.ssrLoadModule('/src/components/useGridPlayback.ts')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { BankEventBus } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.syncMode = 'immediate'
    loop.settings.automation[0] = [
      { sourceId: 'one', parameter: 'value', position: 0, value: 1 },
      { sourceId: 'two', parameter: 'value', position: 0, value: 2 },
    ]
    const layout = reactive({ columns: 1, rows: 1, items: [loop], connections: [] })
    let playback
    app = testRenderer().createApp({
      setup() {
        playback = useGridPlayback({
          layout: () => layout, banks: () => undefined, bankId: 'A', bankEvents: new BankEventBus(),
          clock: { position: () => 0 }, playing: () => true, editing: () => false,
          transportStartImmediate: () => true, triggeredByInput: () => false,
          startOnInput: () => undefined, signals: new Map(), routeNote() {},
        })
        return () => h('div')
      },
    })
    app.mount({})
    playback.loopEngine.toggle(layout.items[0], 0, true)
    playback.loopEngine.tick()
    assert.equal(playback.playbackAutomation.value.size, 2)
    layout.items[0].settings.mutedRows = { 0: [{ kind: 'automation', sourceId: 'one', parameter: 'value' }] }
    playback.loopEngine.tick()
    assert.equal(playback.playbackAutomation.value.has('one:value'), false)
    assert.equal(playback.playbackAutomation.value.has('two:value'), true)
  } finally { app?.unmount(); await server.close() }
})

test('empty muted rows remain accessible in the sequence editor', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: Panel } = await server.ssrLoadModule('/src/components/widgets/SequencedLoopSettingsPanel.vue')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.mutedRows = { 0: [{ kind: 'note', instrumentId: 'piano', note: 60 }] }
    const html = await renderToString(createSSRApp({ render: () => h(Panel, {
      draft: loop, layout: { columns: 1, rows: 1, items: [loop], connections: [] }, bankId: 'A',
    }) }))
    assert.match(html, /muted, row actions/)
  } finally { await server.close() }
})

test('sequence editor shows the active playhead at the correct timeline position', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: Panel } = await server.ssrLoadModule('/src/components/widgets/SequencedLoopSettingsPanel.vue')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    const layout = { columns: 1, rows: 1, items: [loop], connections: [] }
    const render = (playhead) => renderToString(createSSRApp({ render: () => h(Panel, { draft: loop, layout, playhead }) }))
    assert.doesNotMatch(await render(), /class="sequence-playhead"/)
    assert.match(await render(0), /class="sequence-playhead"[^>]*left:calc\(130px \+ 0px\)/)
    assert.match(await render(0.5), /class="sequence-playhead"[^>]*left:calc\(130px \+ 224px\)/)
  } finally { await server.close() }
})

test('editor playhead tracks only the playing clip', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  let app
  try {
    const { useGridPlayback } = await server.ssrLoadModule('/src/components/useGridPlayback.ts')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { BankEventBus } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.syncMode = 'sync'
    const layout = reactive({ columns: 1, rows: 1, items: [loop], connections: [] })
    const playing = ref(false)
    let beat = 0
    let playback
    app = testRenderer().createApp({
      setup() {
        playback = useGridPlayback({
          layout: () => layout, banks: () => undefined, bankId: 'A', bankEvents: new BankEventBus(),
          clock: { position: () => beat }, playing: () => playing.value, editing: () => false,
          transportStartImmediate: () => true, triggeredByInput: () => false,
          startOnInput: () => undefined, signals: new Map(), routeNote() {},
        })
        return () => h('div')
      },
    })
    app.mount({})
    playback.toggleLoopPlayback('loop')
    playing.value = true
    beat = 1
    playback.loopEngine.tick()
    playback.updateLoopStatus()
    assert.deepEqual(playback.loopEditorPlayheads.value.get('loop'), { index: 0, position: 0.25 })
    layout.items[0].settings.clipIndex = 1
    playback.loopEngine.tick()
    playback.updateLoopStatus()
    assert.equal(playback.loopEditorPlayheads.value.has('loop'), false)
    beat = 4
    playback.loopEngine.tick()
    playback.updateLoopStatus()
    assert.deepEqual(playback.loopEditorPlayheads.value.get('loop'), { index: 1, position: 0 })
    playing.value = false
    assert.equal(playback.loopEditorPlayheads.value.has('loop'), false)
  } finally { app?.unmount(); await server.close() }
})

test('muted rows suppress playback, release active notes and automation, and remain clip-specific', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { SequencedLoopEngine } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.syncMode = 'immediate'
    loop.settings.clips[0] = [
      { instrumentId: 'piano', note: 60, velocity: 100, position: 0, duration: 3 },
      { instrumentId: 'piano', note: 61, velocity: 100, position: 0, duration: 3 },
    ]
    loop.settings.automation[0] = [
      { sourceId: 'knob', parameter: 'value', value: 10, position: 0 },
      { sourceId: 'other', parameter: 'value', value: 20, position: 0 },
    ]
    let beat = 0
    const notes = []
    const automation = []
    const engine = new SequencedLoopEngine(() => [loop], () => beat,
      (id, note, on) => notes.push([note.note, on]),
      (id, event, remove) => automation.push([event?.sourceId, remove]), 'A')
    engine.toggle(loop, 0, true)
    engine.tick()
    loop.settings.mutedRows = { 0: [
      { kind: 'note', instrumentId: 'piano', note: 60 },
      { kind: 'automation', sourceId: 'knob', parameter: 'value' },
    ] }
    beat = 0.1
    engine.tick()
    assert.deepEqual(notes.filter(([, on]) => !on), [[60, false]])
    assert.deepEqual(automation.filter(([, remove]) => remove), [['knob', true]])
    beat = 4
    engine.tick()
    assert.equal(notes.filter(([note, on]) => note === 60 && on).length, 1)
    assert.equal(notes.filter(([note, on]) => note === 61 && on).length, 2)
    assert.equal(automation.filter(([source, remove]) => source === 'knob' && !remove).length, 1)
    loop.settings.mutedRows[0] = []
    beat = 8
    engine.tick()
    assert.equal(notes.filter(([note, on]) => note === 60 && on).length, 2)
    assert.equal(automation.filter(([source, remove]) => source === 'knob' && !remove).length, 2)
  } finally { await server.close() }
})
