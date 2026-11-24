import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createServer } from 'vite'

test('control settings open after the tap click, not on pointer release or drag', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  const previousHTMLElement = globalThis.HTMLElement
  const previousWindow = globalThis.window
  try {
    const { ref } = await import('vue')
    const { useGridInteraction } = await server.ssrLoadModule('/src/components/useGridInteraction.ts')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    class Element {
      setPointerCapture() {}
      getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 } }
    }
    globalThis.HTMLElement = Element
    globalThis.window = { getComputedStyle: () => ({ columnGap: '0', rowGap: '0' }) }
    const item = createControl('control', 0, 0, 'instrument-pad')
    const layout = { columns: 1, rows: 1, items: [item], connections: [] }
    const opened = []
    const handlers = useGridInteraction({
      getLayout: () => layout, isEditing: () => true, grid: ref(new Element()), message: ref(''),
      openSettings: (selected) => opened.push(selected.id), nextControlId: () => 'copy',
    })
    const pointer = (x = 10) => ({
      pointerId: 1, button: 0, clientX: x, clientY: 10, currentTarget: new Element(), preventDefault() {},
    })
    handlers.startInteraction(pointer(), item, 'move')
    handlers.endInteraction(pointer())
    assert.deepEqual(opened, [])
    handlers.clickInteraction({ detail: 1 }, item)
    assert.deepEqual(opened, ['control'])

    handlers.startInteraction(pointer(), item, 'move')
    handlers.endInteraction(pointer(20))
    handlers.clickInteraction({ detail: 1 }, item)
    assert.deepEqual(opened, ['control'])

    handlers.startInteraction(pointer(), item, 'resize')
    handlers.endInteraction(pointer(), true)
    handlers.clickInteraction({ detail: 1 }, item)
    assert.deepEqual(opened, ['control'])

    handlers.clickInteraction({ detail: 0 }, item)
    assert.deepEqual(opened, ['control', 'control'])
  } finally {
    globalThis.HTMLElement = previousHTMLElement
    globalThis.window = previousWindow
    await server.close()
  }
})

test('control summaries start collapsed and show each control name, size and color', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: ControlIdentitySettings } = await server.ssrLoadModule('/src/components/ControlIdentitySettings.vue')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    for (const type of ['pad', 'instrument-pad', 'knob', 'lfo', 'mod-wheel', 'piano-roll', 'arpeggiator', 'output-selector', 'sequenced-loop']) {
      const draft = createControl(type, 0, 0, type)
      draft.label = 'My control'
      draft.width = 2
      draft.height = 3
      const html = await renderToString(createSSRApp({ render: () => h(ControlIdentitySettings, {
        draft, columns: 4, rows: 4, controlTypes: [{ type, label: type }],
      }) }))
      assert.match(html, /<details(?![^>]*\sopen(?:[=>\s]))/)
      assert.match(html, /<summary[^>]*>[\s\S]*My control[\s\S]*2 × 3[\s\S]*<\/summary>/)
      assert.match(html, 'color' in draft.settings
        ? new RegExp(`value="${draft.settings.color}"`)
        : /no-color/)
      assert.match(html, /<button[^>]*class="control-name"[^>]*>[\s\S]*My control[\s\S]*<\/button>/)
      assert.match(html, 'color' in draft.settings
        ? /<label class="color-picker"[^>]*>[\s\S]*<input[^>]*type="color"[^>]*aria-label="Choose control color"/
        : /class="color-swatch no-color"/)
      assert.match(html, /Control orientation/)
    }
  } finally {
    await server.close()
  }
})

test('control and grid settings dialogs do not render save buttons', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: Dialog } = await server.ssrLoadModule('/src/components/GridControlSettingsDialog.vue')
    const { default: GrooveGrid } = await server.ssrLoadModule('/src/components/GrooveGrid.vue')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const item = createControl('bass', 0, 0, 'instrument-pad', '303')
    const layout = { columns: 1, rows: 1, items: [item], connections: [] }
    const dialog = await renderToString(createSSRApp({ render: () => h(Dialog, {
      draft: item, selectedId: item.id, newControl: false, layout, bpm: 120, message: '',
    }) }))
    const grid = await renderToString(createSSRApp({ render: () => h(GrooveGrid, {
      layout, editing: true, wiring: false, settingsOpen: true, bpm: 120,
    }) }))
    for (const html of [dialog, grid]) {
      assert.match(html, /aria-label="Close"/)
      assert.doesNotMatch(html, />Save<\/button>/)
    }
  } finally { await server.close() }
})

test('instrument settings display effective playback values rather than saved base values', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: Dialog } = await server.ssrLoadModule('/src/components/GridControlSettingsDialog.vue')
    const { createControl, copyControl } = await server.ssrLoadModule('/src/grid.ts')
    const item = createControl('bass', 0, 0, 'instrument-pad', '303')
    const display = copyControl(item, item.id)
    display.settings.instrumentParams.resonance = 8.25
    display.settings.instrumentParams.envelope.attack = 0.123
    const layout = { columns: 1, rows: 1, items: [item], connections: [] }
    const html = await renderToString(createSSRApp({ render: () => h(Dialog, {
      draft: item, displayItem: display, selectedId: item.id, newControl: false, layout, bpm: 120, message: '',
    }) }))
    assert.match(html, /aria-label="Resonance adjustment"[^>]*aria-valuenow="8\.25"/)
    assert.match(html, /aria-label="Attack \(s\) adjustment"[^>]*aria-valuenow="0\.123"/)
    assert.equal(item.settings.instrumentParams.resonance, 6)
  } finally { await server.close() }
})

test('LFOs, arpeggiators and sequenced loops migrate and display their configurable colors', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: GrooveGrid } = await server.ssrLoadModule('/src/components/GrooveGrid.vue')
    const { default: ControlIdentitySettings } = await server.ssrLoadModule('/src/components/ControlIdentitySettings.vue')
    const { createControl, copyControl } = await server.ssrLoadModule('/src/grid.ts')
    const { controlTypes } = await server.ssrLoadModule('/src/components/gridControlTypes.ts')
    const { migrateSavedProject, isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const items = ['lfo', 'arpeggiator', 'sequenced-loop'].map((type, x) => createControl(type, x, 0, type))
    assert.equal(controlTypes.find(({ type }) => type === 'sequenced-loop').label, 'Loop sequencer')
    assert.equal(items[2].label, 'Loop sequencer')
    items[2].label = 'Sequenced Loop'
    const customLoop = createControl('custom-loop', 3, 0, 'sequenced-loop')
    customLoop.label = 'My loop'
    const layout = { columns: 4, rows: 1, items: [...items, customLoop], connections: [] }
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{
      id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout,
    }] }
    for (const item of items) delete item.settings.color
    migrateSavedProject(project)
    assert.equal(items[2].label, 'Loop sequencer')
    assert.equal(customLoop.label, 'My loop')
    assert.ok(items.every((item) => /^#[0-9a-f]{6}$/i.test(item.settings.color)))
    assert.equal(isSavedProject(project), true)
    for (const [index, item] of items.entries()) {
      item.settings.color = ['#ff1234', '#12ff34', '#1234ff'][index]
      const html = await renderToString(createSSRApp({ render: () => h(ControlIdentitySettings, {
        draft: item, columns: 3, rows: 1, controlTypes: [{ type: item.type, label: item.label }],
      }) }))
      assert.match(html, new RegExp(`<input[^>]*value="${item.settings.color}"[^>]*type="color"`))
      assert.equal(copyControl(item, 'copy').settings.color, item.settings.color)
      item.settings.color = 'invalid'
      assert.equal(isSavedProject(project), false)
      item.settings.color = ['#ff1234', '#12ff34', '#1234ff'][index]
    }
    migrateSavedProject(project)
    assert.equal(isSavedProject(project), true)
    const restored = JSON.parse(JSON.stringify(project))
    assert.deepEqual(restored.banks[0].layout.items.slice(0, 3).map((item) => item.settings.color), ['#ff1234', '#12ff34', '#1234ff'])
    const html = await renderToString(createSSRApp({ render: () => h(GrooveGrid,
      { layout, editing: false, wiring: false, settingsOpen: false, bpm: 120, playing: false }) }))
    assert.match(html, /--lfo-color:#ff1234/)
    assert.match(html, /--wave-color:#ff1234/)
    assert.match(html, /--arp-color:#12ff34/)
    assert.match(html, /--loop-color:#1234ff/)
    const editHtml = await renderToString(createSSRApp({ render: () => h(GrooveGrid,
      { layout, editing: true, wiring: false, settingsOpen: false, bpm: 120, playing: false }) }))
    for (const item of items) assert.ok(editHtml.includes(`--item-color:${item.settings.color}`))
  } finally {
    await server.close()
  }
})

test('control rotation and hit polyphony migrate, validate, and survive project copies', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl, copyControl } = await server.ssrLoadModule('/src/grid.ts')
    const { migrateSavedProject, isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const hit = createControl('hit', 0, 0, 'instrument-pad')
    assert.equal(hit.settings.mode, 'trigger')
    delete hit.orientation
    delete hit.settings.mode
    delete hit.settings.instrumentParams.polyphony
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{
      id: 'A', title: 'A', icon: 'A', color: '#ffffff',
      layout: { columns: 1, rows: 1, items: [hit], connections: [] },
    }] }
    migrateSavedProject(project)
    assert.equal(hit.orientation, 'horizontal')
    assert.equal(hit.settings.mode, 'trigger')
    assert.equal(hit.settings.instrumentParams.polyphony, 1)
    hit.orientation = 'vertical'
    hit.settings.instrumentParams.polyphony = 16
    assert.equal(isSavedProject(project), true)
    hit.settings.mode = 'toggle'
    assert.equal(isSavedProject(project), true)
    hit.settings.mode = 'invalid'
    assert.equal(isSavedProject(project), false)
    hit.settings.mode = 'trigger'
    assert.equal(copyControl(hit, 'copy').orientation, 'vertical')
    const restored = JSON.parse(JSON.stringify(project))
    assert.equal(restored.banks[0].layout.items[0].settings.instrumentParams.polyphony, 16)
    hit.settings.instrumentParams.polyphony = 16.5
    assert.equal(isSavedProject(project), false)
    hit.settings.instrumentParams.polyphony = 1
    hit.orientation = 'sideways'
    assert.equal(isSavedProject(project), false)
  } finally {
    await server.close()
  }
})

test('knob and mod wheel automation recording settings default on and migrate without overwriting choices', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { migrateSavedProject, isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const items = ['knob', 'mod-wheel'].map((type, x) => createControl(type, x, 0, type))
    for (const item of items) {
      assert.equal(item.settings.recordAutomation, true)
      const { default: Panel } = await server.ssrLoadModule(`/src/components/${item.type === 'knob' ? 'Knob' : 'ModWheel'}SettingsPanel.vue`)
      const html = await renderToString(createSSRApp({ render: () => h(Panel, { draft: item }) }))
      assert.match(html, /<input(?=[^>]*\bchecked\b)(?=[^>]*type="checkbox")[^>]*> Record automation for this control/)
      delete item.settings.recordAutomation
    }
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{
      id: 'A', title: 'A', icon: 'A', color: '#ffffff',
      layout: { columns: 2, rows: 1, items, connections: [] },
    }] }
    migrateSavedProject(project)
    assert.ok(items.every((item) => item.settings.recordAutomation === true))
    items[0].settings.recordAutomation = false
    items[1].settings.recordAutomation = false
    migrateSavedProject(project)
    assert.ok(items.every((item) => item.settings.recordAutomation === false))
    assert.equal(isSavedProject(project), true)
    const restored = JSON.parse(JSON.stringify(project))
    assert.ok(restored.banks[0].layout.items.every((item) => item.settings.recordAutomation === false))
  } finally {
    await server.close()
  }
})

test('edit and wiring labels reflect the control orientation', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: GrooveGrid } = await server.ssrLoadModule('/src/components/GrooveGrid.vue')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const item = createControl('pad', 0, 0, 'pad')
    item.label = 'Rotated pad'
    item.orientation = 'vertical'
    const layout = { columns: 1, rows: 1, items: [item], connections: [] }
    for (const wiring of [false, true]) {
      const html = await renderToString(createSSRApp({ render: () => h(GrooveGrid,
        { layout, editing: true, wiring, settingsOpen: false, bpm: 120 }) }))
      assert.match(html, /class="vertical-edit-label">Rotated pad<\/span>/)
    }
  } finally {
    await server.close()
  }
})

test('instrument choices render icon buttons and mark the active type', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: Panel } = await server.ssrLoadModule('/src/components/instruments/InstrumentPadSettingsPanel.vue')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const draft = createControl('bass', 0, 0, 'instrument-pad', '303')
    const html = await renderToString(createSSRApp({ render: () => h(Panel, { draft }) }))
    const choices = html.match(/<div class="instrument-types"[\s\S]*?<\/div>/)?.[0]
    assert.ok(choices)
    assert.equal((choices.match(/<button/g) ?? []).length, 5)
    assert.equal((choices.match(/<svg/g) ?? []).length, 5)
    assert.equal((choices.match(/aria-pressed="true"/g) ?? []).length, 1)
    assert.match(choices, /aria-pressed="true"[^>]*>[\s\S]*?303 Bass Synth/)
    assert.match(choices, /909 Drum Kit/)
    assert.doesNotMatch(choices, /<select/)
    const drumDraft = createControl('drum', 0, 0, 'instrument-pad', '909')
    const drumHtml = await renderToString(createSSRApp({ render: () => h(Panel, { draft: drumDraft }) }))
    assert.match(drumHtml, /909 Drum Kit Parameters/)
  } finally {
    await server.close()
  }
})

test('piano roll migrates old settings and renders each style in the requested rows', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: PianoRoll } = await server.ssrLoadModule('/src/components/PianoRoll.vue')
    const { default: PianoRollSettingsPanel } = await server.ssrLoadModule('/src/components/PianoRollSettingsPanel.vue')
    const { createControl, validPianoRollSettings } = await server.ssrLoadModule('/src/grid.ts')
    const { migrateSavedProject, isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const piano = createControl('piano', 0, 0, 'piano-roll')
    assert.equal(piano.settings.pressureMode, 'position')
    delete piano.settings.numRows
    delete piano.settings.style
    delete piano.settings.rootNote
    delete piano.settings.octaveTranspose
    delete piano.settings.pressureMode
    piano.settings.transpose = -13
    piano.settings.scale = 'pentatonic'
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{
      id: 'A', title: 'A', icon: 'A', color: '#ffffff',
      layout: { columns: 1, rows: 1, items: [piano], connections: [] },
    }] }
    migrateSavedProject(project)
    assert.equal(isSavedProject(project), true)
    assert.equal(piano.settings.numRows, 1)
    assert.equal(piano.settings.style, 'pads')
    assert.equal(piano.settings.rootNote, 'B')
    assert.equal(piano.settings.octaveTranspose, -2)
    assert.equal(piano.settings.transpose, undefined)
    assert.equal(piano.settings.scale, 'major-pentatonic')
    assert.equal(piano.settings.pressureMode, 'position')
    piano.settings.scale = 'chromatic'
    const settingsHtml = await renderToString(createSSRApp({ render: () => h(PianoRollSettingsPanel, { draft: piano }) }))
    const rootScaleControls = settingsHtml.match(/<div class="piano-root-scale"[\s\S]*?<\/div>/)?.[0] ?? ''
    assert.match(rootScaleControls, /Root note/)
    assert.match(rootScaleControls, /Scale/)
    assert.equal((rootScaleControls.match(/<select/g) ?? []).length, 2)
    for (const scale of ['Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Locrian', 'Major Pentatonic', 'Minor Pentatonic', 'Blues']) {
      assert.match(rootScaleControls, new RegExp(scale))
    }
    const render = () => renderToString(createSSRApp({ render: () => h(PianoRoll, { label: 'Piano', settings: piano.settings }) }))
    let html = await render()
    assert.equal((html.match(/class="key-row"/g) ?? []).length, 1)
    assert.equal((html.match(/data-note="/g) ?? []).length, 12)
    for (const style of ['pads', 'whites-blacks', 'glide-strip']) {
      piano.settings.numRows = 3
      piano.settings.style = style
      html = await render()
      assert.match(html, new RegExp(style))
      assert.equal((html.match(/class="key-row"/g) ?? []).length, 3)
      assert.equal((html.match(/data-note="/g) ?? []).length, 36)
      const keyRows = html.match(/<div class="key-row"[\s\S]*?<\/div>/g) ?? []
      assert.deepEqual(keyRows.map((row) => (row.match(/data-note="/g) ?? []).length), [12, 12, 12])
      if (style === 'pads') assert.match(html, /class="(?:key black|black key)"/)
      if (style === 'whites-blacks') {
        assert.match(html, /class="white key"/)
        assert.match(html, /class="black key"/)
      }
    }
    piano.settings.scale = 'major'
    piano.settings.style = 'whites-blacks'
    html = await render()
    const outOfScaleKeys = html.match(/<button[^>]*class="[^"]*out-of-scale[^"]*"[^>]*>/g) ?? []
    assert.equal(outOfScaleKeys.length, 15)
    assert.ok(outOfScaleKeys.every((key) => /\sdisabled(?:\s|>)/.test(key)))
    piano.settings.rootNote = 'B'
    piano.settings.octaveTranspose = 0
    html = await render()
    const firstRow = html.match(/<div class="key-row"[\s\S]*?<\/div>/)?.[0] ?? ''
    assert.match(firstRow, /aria-label="Piano note C3" data-note="48"/)
    assert.match(firstRow, /aria-label="Piano note B3" data-note="59"/)
    const cKey = firstRow.match(/<button[^>]*aria-label="Piano note C3"[^>]*>/)?.[0] ?? ''
    const cSharpKey = firstRow.match(/<button[^>]*aria-label="Piano note C#3"[^>]*>/)?.[0] ?? ''
    assert.match(cKey, /out-of-scale/)
    assert.doesNotMatch(cSharpKey, /out-of-scale/)
    piano.settings.rootNote = 'C#'
    piano.settings.octaveTranspose = 1
    html = await render()
    const octaveShiftedRow = html.match(/<div class="key-row"[\s\S]*?<\/div>/)?.[0] ?? ''
    assert.match(octaveShiftedRow, /aria-label="Piano note C3" data-note="60"/)
    assert.match(octaveShiftedRow, /aria-label="Piano note B3" data-note="71"/)
    assert.equal(validPianoRollSettings({ ...piano.settings, octaves: 3, numRows: 2, octaveTranspose: 0 }), true)
    assert.equal(validPianoRollSettings({ ...piano.settings, octaves: 3, numRows: 8, octaveTranspose: 0 }), false)
    piano.settings.rootNote = 'D'
    piano.settings.octaveTranspose = 0
    piano.settings.numRows = 1
    for (const style of ['pads', 'glide-strip']) {
      piano.settings.style = style
      html = await render()
      assert.equal((html.match(/data-note="/g) ?? []).length, 7)
      assert.match(html, /aria-label="Piano note D3"/)
      assert.match(html, /aria-label="Piano note C#4"/)
      assert.doesNotMatch(html, /aria-label="Piano note D#3"/)
    }
    piano.settings.numRows = 1.5
    assert.equal(isSavedProject(project), false)
    piano.settings.numRows = 1
    piano.settings.style = 'invalid'
    assert.equal(isSavedProject(project), false)
    piano.settings.style = 'pads'
    piano.settings.pressureMode = 'position'
    assert.equal(isSavedProject(project), true)
    piano.settings.pressureMode = 'invalid'
    assert.equal(isSavedProject(project), false)
  } finally {
    await server.close()
  }
})

test('piano roll renders the added scale intervals', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: PianoRoll } = await server.ssrLoadModule('/src/components/PianoRoll.vue')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const piano = createControl('piano', 0, 0, 'piano-roll')
    const expected = {
      dorian: [0, 2, 3, 5, 7, 9, 10],
      phrygian: [0, 1, 3, 5, 7, 8, 10],
      lydian: [0, 2, 4, 6, 7, 9, 11],
      mixolydian: [0, 2, 4, 5, 7, 9, 10],
      locrian: [0, 1, 3, 5, 6, 8, 10],
      'major-pentatonic': [0, 2, 4, 7, 9],
      'minor-pentatonic': [0, 3, 5, 7, 10],
      blues: [0, 3, 5, 6, 7, 10],
    }
    for (const [scale, intervals] of Object.entries(expected)) {
      piano.settings.scale = scale
      const html = await renderToString(createSSRApp({ render: () => h(PianoRoll, {
        label: 'Piano', settings: piano.settings,
      }) }))
      const notes = Array.from(html.matchAll(/data-note="(\d+)"/g), (match) => Number(match[1]) - 48)
      assert.deepEqual(notes, intervals, scale)
    }
  } finally {
    await server.close()
  }
})
