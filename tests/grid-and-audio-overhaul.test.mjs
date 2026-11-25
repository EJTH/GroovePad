import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import 'fake-indexeddb/auto'
import { createServer } from 'vite'

test('SubGrid copies isolate nested controls and presets merge explicitly', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl, copyControl } = await server.ssrLoadModule('/src/grid.ts')
    const nested = createControl('nested-knob', 0, 0, 'knob')
    nested.settings.value = 12
    const subgrid = createControl('subgrid', 0, 0, 'sub-grid')
    subgrid.settings.layout.items.push(nested)

    const copy = copyControl(subgrid, 'subgrid-copy')
    assert.notEqual(copy.settings.layout.items[0].id, nested.id)
    subgrid.settings.surfaceItemIds = [nested.id]
    const surfacedCopy = copyControl(subgrid, 'surfaced-copy')
    assert.deepEqual(surfacedCopy.settings.surfaceItemIds, [surfacedCopy.settings.layout.items[0].id])
    copy.settings.layout.items[0].settings.value = 90
    assert.equal(nested.settings.value, 12)

    const { createSubGridPreset, mergePresets } = await server.ssrLoadModule('/src/presets.ts')
    const preset = createSubGridPreset('Lead', subgrid.settings.layout)
    const replacement = { ...preset, name: 'Lead updated', layout: copy.settings.layout }
    const keepBoth = mergePresets([preset], [replacement], () => 'keep-both')
    assert.equal(keepBoth.length, 2)
    assert.notEqual(keepBoth[0].id, keepBoth[1].id)
  } finally {
    await server.close()
  }
})

test('copying a SubGrid remaps local loop references along with surfaced controls', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl, copyControl } = await server.ssrLoadModule('/src/grid.ts')
    const subgrid = createControl('sub', 0, 0, 'sub-grid')
    const piano = createControl('piano', 0, 0, 'piano-roll')
    const loop = createControl('loop', 1, 0, 'sequenced-loop')
    loop.settings.clips[0].push({ instrumentId: 'piano', note: 60, velocity: 100, position: 0, duration: 1 })
    loop.settings.automation[0].push({ sourceId: 'piano', parameter: 'pressure', value: 1, position: 0 })
    loop.settings.mutedRows = { 0: [{ kind: 'note', instrumentId: 'piano', note: 60 }] }
    subgrid.settings.layout.items.push(piano, loop)
    subgrid.settings.surfaceItemIds.push('piano')
    const copied = copyControl(subgrid, 'copy')
    const copiedId = copied.settings.layout.items[0].id
    const copiedLoop = copied.settings.layout.items[1].settings
    assert.equal(copied.settings.surfaceItemIds[0], copiedId)
    assert.equal(copiedLoop.clips[0][0].instrumentId, copiedId)
    assert.equal(copiedLoop.automation[0][0].sourceId, copiedId)
    assert.equal(copiedLoop.mutedRows[0][0].instrumentId, copiedId)
  } finally {
    await server.close()
  }
})

test('exposed note and numeric bindings validate, copy and survive a project round-trip', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl, copyControl } = await server.ssrLoadModule('/src/grid.ts')
    const { inputs, outputs, isCompatible } = await server.ssrLoadModule('/src/parameters.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const { saveProjectToFile, loadProjectFromFile } = await server.ssrLoadModule('/src/saveManager.ts')
    const sub = createControl('sub', 1, 0, 'sub-grid')
    const tone = createControl('tone', 0, 0, 'tone-element')
    sub.settings.layout.items.push(tone)
    sub.settings.exposedPorts.push({ id: 'port-1', name: 'Pitch', kind: 'note', direction: 'input', itemId: 'tone', parameterId: 'note' })
    sub.settings.exposedPorts.push({ id: 'port-2', name: 'Frequency', kind: 'numeric', direction: 'input', itemId: 'tone', parameterId: 'frequency' })
    sub.settings.exposedPorts.push({ id: 'port-3', name: 'Pitch output', kind: 'numeric', direction: 'output', itemId: 'tone', parameterId: 'frequency' })
    const piano = createControl('piano', 0, 0, 'piano-roll')
    assert.ok(isCompatible(piano, 'note', sub, 'port-1'))
    assert.equal(inputs(sub).find((port) => port.id === 'port-1').label, 'Pitch')
    assert.equal(inputs(sub).find((port) => port.id === 'port-2').max, 20000)
    assert.equal(outputs(sub).find((port) => port.id === 'port-3').min, 20)
    const copied = copyControl(sub, 'copy')
    assert.equal(copied.settings.exposedPorts[0].itemId, copied.settings.layout.items[0].id)
    assert.equal(copied.settings.exposedPorts[2].itemId, copied.settings.layout.items[0].id)
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff',
      layout: { columns: 2, rows: 1, items: [piano, sub],
        connections: [{ id: 'wire', sourceId: 'piano', sourceParameter: 'note', targetId: 'sub', targetParameter: 'port-1' }] } }] }
    assert.ok(isSavedProject(project))
    const restored = await loadProjectFromFile(await saveProjectToFile(project))
    assert.equal(restored.banks[0].layout.items[1].settings.exposedPorts[0].itemId, 'tone')
    assert.equal(restored.banks[0].layout.items[1].settings.exposedPorts[2].parameterId, 'frequency')
    tone.settings.elementType = 'noise'
    assert.equal(isSavedProject(project), false)
    tone.settings.elementType = 'oscillator'
    sub.settings.exposedPorts[0].parameterId = 'missing'
    assert.equal(isSavedProject(project), false)
  } finally { await server.close() }
})

test('instrument audio uses the bank by default and can be wired to an effect', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { isCompatible } = await server.ssrLoadModule('/src/parameters.ts')
    const { planAudioRoutes, audioInput, audioOutput } = await server.ssrLoadModule('/src/audio/audioRoutes.ts')
    const instrument = createControl('instrument', 0, 0, 'instrument-pad')
    const effect = createControl('effect', 1, 0, 'tone-element')
    effect.settings.elementType = 'gain'
    const layout = { columns: 2, rows: 1, items: [instrument, effect], connections: [] }
    const edges = () => planAudioRoutes(layout).map(({ from, to }) => `${from}>${to}`)
    assert.ok(isCompatible(instrument, 'audio', effect, 'audio'))
    assert.ok(edges().includes(`${audioOutput('instrument')}>bank-pre`))
    layout.connections.push({ id: 'wire', sourceId: 'instrument', sourceParameter: 'audio', targetId: 'effect', targetParameter: 'audio' })
    assert.ok(edges().includes(`${audioOutput('instrument')}>${audioInput('effect')}`))
    assert.ok(!edges().includes(`${audioOutput('instrument')}>bank-pre`))
  } finally {
    await server.close()
  }
})

test('bank clipboard snapshots nested grids, wires and loop references for independent pastes', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { copyBankAsSubGrid, pasteSubGridLayout } = await server.ssrLoadModule('/src/subGridClipboard.ts')
    const piano = createControl('piano', 0, 0, 'piano-roll')
    const tone = createControl('tone', 1, 0, 'tone-element')
    tone.settings.audioTo = 'main-out'
    const loop = createControl('loop', 2, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.clips[0].push({ bankId: 'A', instrumentId: 'piano', note: 60, velocity: 100, position: 0, duration: 1 })
    loop.settings.automation[0].push({ bankId: 'A/nested', sourceId: 'knob', parameter: 'value', value: 1, position: 0 })
    loop.settings.mutedRows = { 0: [{ kind: 'note', bankId: 'external', instrumentId: 'other', note: 60 }] }
    const nested = createControl('nested', 3, 0, 'sub-grid')
    nested.settings.layout.items.push(createControl('knob', 0, 0, 'knob'))
    nested.settings.surfaceItemIds = ['knob']
    const bank = { id: 'A', title: 'Source', icon: 'A', color: '#ffffff',
      layout: { columns: 4, rows: 1, items: [piano, tone, loop, nested],
        connections: [{ id: 'note', sourceId: 'piano', sourceParameter: 'note', targetId: 'tone', targetParameter: 'note' }] } }
    const clipboard = copyBankAsSubGrid(bank)
    assert.equal(clipboard.adjustedAudioRoutes, true)
    assert.equal(clipboard.externalReferences, true)
    piano.label = 'Changed later'
    const first = pasteSubGridLayout(clipboard, 'B/first')
    const second = pasteSubGridLayout(clipboard, 'B/second')
    assert.equal(first.items[0].label, 'Piano')
    assert.equal(first.items[1].settings.audioTo, 'bank-out')
    assert.equal(first.items[2].settings.armed, false)
    assert.equal(first.items[2].settings.clips[0][0].bankId, undefined)
    assert.equal(first.items[2].settings.automation[0][0].bankId, 'B/first/nested')
    assert.equal(second.items[2].settings.automation[0][0].bankId, 'B/second/nested')
    assert.equal(first.items[2].settings.mutedRows[0][0].bankId, 'external')
    assert.deepEqual(first.connections, bank.layout.connections)
    assert.deepEqual(first.items[3].settings.surfaceItemIds, ['knob'])
    first.items[3].settings.layout.items[0].label = 'Changed copy'
    assert.equal(second.items[3].settings.layout.items[0].label, 'Knob')
    assert.equal(nested.settings.layout.items[0].label, 'Knob')
    const placed = createControl('first', 0, 0, 'sub-grid')
    placed.settings.layout = first
    const project = { version: 1, bpm: 120, selectedBankId: 'B',
      banks: [{ id: 'B', title: 'Destination', icon: 'B', color: '#ffffff',
        layout: { columns: 1, rows: 1, items: [placed], connections: [] } }] }
    const { saveProjectToFile, loadProjectFromFile } = await server.ssrLoadModule('/src/saveManager.ts')
    const restored = await loadProjectFromFile(await saveProjectToFile(project))
    const restoredLayout = restored.banks[0].layout.items[0].settings.layout
    assert.equal(restoredLayout.items[3].settings.layout.items[0].label, 'Changed copy')
    assert.equal(restoredLayout.items[2].settings.automation[0][0].bankId, 'B/first/nested')
    assert.equal(restoredLayout.connections[0].targetId, 'tone')
  } finally {
    await server.close()
  }
})

test('Tone.js controls and nested SubGrids validate in projects', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { isSavedProject, migrateSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const tone = createControl('tone', 0, 0, 'tone-element')
    const subgrid = createControl('subgrid', 1, 0, 'sub-grid')
    subgrid.settings.layout.items.push(tone)
    const project = {
      version: 1, bpm: 120, selectedBankId: 'A',
      banks: [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff',
        layout: { columns: 4, rows: 4, items: [subgrid], connections: [] } }],
    }
    migrateSavedProject(project)
    assert.equal(isSavedProject(project), true)
    delete tone.settings.sustain
    delete tone.settings.polyphony
    const presetTone = createControl('preset-tone', 0, 0, 'tone-element')
    delete presetTone.settings.sustain
    project.subGridPresets = [{ id: 'preset', name: 'Preset', schemaVersion: 1,
      layout: { columns: 1, rows: 1, items: [presetTone], connections: [] }, assets: [] }]
    migrateSavedProject(project)
    assert.equal(tone.settings.sustain, 1)
    assert.equal(tone.settings.polyphony, 1)
    assert.equal(presetTone.settings.sustain, 1)
    assert.equal(isSavedProject(project), true)
    tone.settings.alwaysOn = true
    migrateSavedProject(project)
    assert.equal(tone.settings.noteMode, 'always-on')
    assert.equal('alwaysOn' in tone.settings, false)
    tone.settings.noteMode = 'gated'
    tone.settings.sustain = 0.3
    assert.equal(isSavedProject(project), true)
    tone.settings.sustain = 1.1
    assert.equal(isSavedProject(project), false)
    tone.settings.sustain = 1
    tone.settings.noteMode = 'gated'
    tone.settings.frequency = 220
    tone.settings.noteMode = 'always-on'
    tone.settings.polyphony = 3
    assert.equal(isSavedProject(project), true)
    const { saveProjectToFile, loadProjectFromFile } = await server.ssrLoadModule('/src/saveManager.ts')
    const restored = await loadProjectFromFile(await saveProjectToFile(project))
    assert.equal(restored.banks[0].layout.items[0].settings.layout.items[0].settings.noteMode, 'always-on')
    assert.equal(restored.banks[0].layout.items[0].settings.layout.items[0].settings.polyphony, 3)
    tone.settings.polyphony = 0
    assert.equal(isSavedProject(project), false)
    tone.settings.polyphony = 3
    tone.settings.noteMode = 'invalid'
    assert.equal(isSavedProject(project), false)
  } finally {
    await server.close()
  }
})

test('mixer channels follow connected audio inputs and are copied and validated independently', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl, copyControl, copyGridLayout } = await server.ssrLoadModule('/src/grid.ts')
    const { audioOutput, mixerAudioInputs } = await server.ssrLoadModule('/src/audio/audioRoutes.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const sourceA = createControl('source-a', 0, 0, 'tone-element')
    const sourceB = createControl('source-b', 1, 0, 'tone-element')
    const mixer = createControl('mixer', 2, 0, 'tone-element')
    mixer.settings.elementType = 'mixer'
    const layout = { columns: 3, rows: 1, items: [sourceA, sourceB, mixer], connections: [
      { id: 'a-to-mixer', sourceId: sourceA.id, sourceParameter: 'audio', targetId: mixer.id, targetParameter: 'audio' },
      { id: 'b-to-mixer', sourceId: sourceB.id, sourceParameter: 'audio', targetId: mixer.id, targetParameter: 'audio' },
    ] }
    assert.deepEqual(mixerAudioInputs(layout, mixer.id), [audioOutput(sourceA.id), audioOutput(sourceB.id)])

    const key = audioOutput(sourceA.id)
    mixer.settings.mixerChannels = { [key]: { volume: -4, pan: 0.25, solo: true } }
    const copied = copyControl(mixer, 'mixer-copy')
    copied.settings.mixerChannels[key].volume = -12
    assert.equal(mixer.settings.mixerChannels[key].volume, -4)
    const copiedLayout = copyGridLayout(layout)
    const copiedMixer = copiedLayout.items.find((item) => item.id === 'mixer-copy')
    assert.equal(copiedMixer.settings.mixerChannels[audioOutput('source-a-copy')].volume, -4)

    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout }] }
    assert.equal(isSavedProject(project), true)
    const { saveProjectToFile, loadProjectFromFile } = await server.ssrLoadModule('/src/saveManager.ts')
    const restored = await loadProjectFromFile(await saveProjectToFile(project))
    const restoredMixer = restored.banks[0].layout.items.find((item) => item.id === mixer.id)
    assert.deepEqual(restoredMixer.settings.mixerChannels[key], { volume: -4, pan: 0.25, solo: true })
    mixer.settings.mixerChannels[key].pan = 2
    assert.equal(isSavedProject(project), false)
  } finally {
    await server.close()
  }
})

test('mixer widget renders a fader, pan control and solo action for every input', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createSSRApp, h } = await import('vue')
    const { renderToString } = await import('@vue/server-renderer')
    const { default: ChannelMixer } = await server.ssrLoadModule('/src/components/widgets/tone/ChannelMixer.vue')
    const html = await renderToString(createSSRApp({
      render: () => h(ChannelMixer, {
        label: 'Sub Mixer',
        color: '#83c9bb',
        channels: [
          { id: 'kick', label: 'Kick', volume: 0, pan: 0, solo: true },
          { id: 'snare', label: 'Snare', volume: -6, pan: -0.25, solo: false },
        ],
      }),
    }))
    assert.equal((html.match(/aria-label="Channel level"/g) ?? []).length, 2)
    assert.equal((html.match(/aria-label="Pan"/g) ?? []).length, 2)
    assert.match(html, /aria-label="Unsolo Kick" aria-pressed="true"/)
    assert.match(html, /aria-label="Solo Snare" aria-pressed="false"/)
  } finally {
    await server.close()
  }
})

test('Piano roll and knob can wire compatible signals to Tone.js inputs', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { inputs, isCompatible, outputs } = await server.ssrLoadModule('/src/parameters.ts')
    const piano = createControl('piano', 0, 0, 'piano-roll')
    const knob = createControl('knob', 1, 0, 'knob')
    const tone = createControl('tone', 2, 0, 'tone-element')

    assert.ok(inputs(tone).some((input) => input.id === 'note'))
    assert.ok(inputs(tone).some((input) => input.id === 'frequency'))
    assert.ok(isCompatible(piano, 'note', tone, 'note'))
    assert.ok(isCompatible(knob, 'value', tone, 'frequency'))
    assert.ok(outputs(tone).some((output) => output.id === 'audio'))
  } finally {
    await server.close()
  }
})

test('Tone.js dropdown renders element-specific settings', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  const previousHTMLElement = globalThis.HTMLElement
  const previousWindow = globalThis.window
  try {
    const { createSSRApp, h } = await import('vue')
    const { renderToString } = await import('@vue/server-renderer')
    const { default: Dialog } = await server.ssrLoadModule('/src/components/GridControlSettingsDialog.vue')
    const { createControl, copyControl } = await server.ssrLoadModule('/src/grid.ts')
    globalThis.HTMLElement = class {}
    globalThis.window = {}

    for (const [type, label] of [
      ['oscillator', 'Frequency \\(Hz\\)'],
      ['filter', 'Filter cutoff \\(Hz\\)'],
      ['delay', 'Delay time \\(s\\)'],
      ['reverb', 'Decay \\(s\\)'],
      ['envelope', 'Attack \\(s\\)'],
      ['mixer', 'Master level'],
    ]) {
      const tone = createControl(`tone-${type}`, 0, 0, 'tone-element')
      tone.settings.elementType = type
      const layout = { columns: 1, rows: 1, items: [tone], connections: [] }
      const html = await renderToString(createSSRApp({
        render: () => h(Dialog, {
          draft: tone,
          selectedId: tone.id,
          newControl: false,
          layout,
          bpm: 120,
          message: '',
        }),
      }))
      assert.match(html, new RegExp(label))
      if (['filter', 'delay', 'reverb'].includes(type)) {
        assert.match(html, /Tap action/)
        assert.match(html, /Bypass effect/)
      }
      if (type === 'oscillator') {
        assert.match(html, /Always on/)
        assert.match(html, /Polyphony/)
        const always = copyControl(tone, tone.id)
        always.settings.noteMode = 'always-on'
        const alwaysHtml = await renderToString(createSSRApp({
          render: () => h(Dialog, { draft: always, selectedId: always.id,
            newControl: false, layout, bpm: 120, message: '' }),
        }))
        assert.doesNotMatch(alwaysHtml, /Attack \(s\)/)
        assert.doesNotMatch(alwaysHtml, /Release \(s\)/)
      }
      if (type === 'envelope') {
        assert.match(html, /Show bypass button/)
        assert.match(html, /adsr-visualizer/)
        assert.match(html, /Sustain/)
        assert.match(html, /max="5"/)
        assert.match(html, /max="10"/)
        const display = copyControl(tone, tone.id)
        display.settings.sustain = 0.3
        const effectiveHtml = await renderToString(createSSRApp({
          render: () => h(Dialog, { draft: tone, displayItem: display, selectedId: tone.id,
            newControl: false, layout, bpm: 120, message: '' }),
        }))
        assert.match(effectiveHtml, /aria-label="Sustain adjustment"[^>]*aria-valuenow="0\.3"/)
        assert.equal(tone.settings.sustain, 1)
      }
      if (type === 'mixer') assert.match(html, /Show bypass button/)
    }
  } finally {
    globalThis.HTMLElement = previousHTMLElement
    globalThis.window = previousWindow
    await server.close()
  }
})

test('automatic audio routing inserts unwired effects in order and replaces defaults with wires', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { planAudioRoutes, audioInput, audioOutput } = await server.ssrLoadModule('/src/audio/audioRoutes.ts')
    const oscillator = createControl('oscillator', 0, 0, 'tone-element')
    const gain = createControl('gain', 1, 0, 'tone-element')
    const filter = createControl('filter', 2, 0, 'tone-element')
    gain.settings.elementType = 'gain'
    filter.settings.elementType = 'filter'
    const layout = { columns: 3, rows: 1, items: [oscillator, gain, filter], connections: [] }
    const edges = () => planAudioRoutes(layout).map(({ from, to }) => `${from}>${to}`)
    assert.ok(edges().includes(`${audioOutput('oscillator')}>bank-pre`))
    assert.ok(edges().includes(`bank-pre>${audioInput('gain')}`))
    assert.ok(edges().includes(`${audioOutput('gain')}>${audioInput('filter')}`))
    assert.ok(edges().includes(`${audioOutput('filter')}>bank-post`))
    assert.ok(!edges().includes('bank-pre>bank-post'))

    layout.connections.push({ id: 'audio', sourceId: 'oscillator', sourceParameter: 'audio', targetId: 'gain', targetParameter: 'audio' })
    assert.ok(edges().includes(`${audioOutput('oscillator')}>${audioInput('gain')}`))
    assert.ok(!edges().includes(`${audioOutput('oscillator')}>bank-pre`))
    assert.ok(!edges().includes(`bank-pre>${audioInput('gain')}`))
    assert.ok(edges().includes(`${audioOutput('gain')}>bank-post`))
  } finally {
    await server.close()
  }
})

test('audio routes reject feedback and SubGrids participate through their component I/O', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { planAudioRoutes, audioInput, audioOutput } = await server.ssrLoadModule('/src/audio/audioRoutes.ts')
    const effect = createControl('effect', 0, 0, 'tone-element')
    effect.settings.elementType = 'delay'
    const subgrid = createControl('subgrid', 1, 0, 'sub-grid')
    const layout = { columns: 2, rows: 1, items: [effect, subgrid], connections: [] }
    const edges = planAudioRoutes(layout).map(({ from, to }) => `${from}>${to}`)
    assert.ok(edges.includes(`${audioOutput('effect')}>${audioInput('subgrid')}`))
    assert.ok(edges.includes(`${audioOutput('subgrid')}>bank-post`))
    effect.settings.audioFrom = 'bank-post-fx'
    effect.settings.audioTo = 'bank-out'
    assert.throws(() => planAudioRoutes(layout), /feedback/i)
  } finally {
    await server.close()
  }
})

test('exposed audio routes validate across nested boundaries and reject feedback', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { validateAudioRoutes, planAudioRoutes, audioInput, audioOutput } = await server.ssrLoadModule('/src/audio/audioRoutes.ts')
    const sub = createControl('sub', 1, 0, 'sub-grid')
    const inner = createControl('inner', 0, 0, 'sub-grid')
    const gain = createControl('gain', 0, 0, 'tone-element')
    gain.settings.elementType = 'gain'
    inner.settings.layout.items.push(gain)
    inner.settings.exposedPorts.push(
      { id: 'in', name: 'Input', kind: 'audio', direction: 'input', itemId: 'gain', parameterId: 'audio' },
      { id: 'out', name: 'Output', kind: 'audio', direction: 'output', itemId: 'gain', parameterId: 'audio' },
    )
    sub.settings.layout.items.push(inner)
    sub.settings.exposedPorts.push(
      { id: 'in', name: 'Input', kind: 'audio', direction: 'input', itemId: 'inner', parameterId: 'in' },
      { id: 'out', name: 'Output', kind: 'audio', direction: 'output', itemId: 'inner', parameterId: 'out' },
    )
    const oscillator = createControl('source', 0, 0, 'tone-element')
    const effect = createControl('effect', 2, 0, 'tone-element')
    effect.settings.elementType = 'gain'
    const layout = { columns: 3, rows: 1, items: [oscillator, sub, effect], connections: [
      { id: 'input', sourceId: 'source', sourceParameter: 'audio', targetId: 'sub', targetParameter: 'in' },
      { id: 'output', sourceId: 'sub', sourceParameter: 'out', targetId: 'effect', targetParameter: 'audio' },
    ] }
    assert.doesNotThrow(() => validateAudioRoutes(layout))
    const edges = planAudioRoutes(layout)
    assert.ok(edges.some((edge) => edge.from === audioOutput('source') && edge.to === audioInput('sub', 'in')))
    assert.ok(edges.some((edge) => edge.from === audioOutput('sub', 'out') && edge.to === audioInput('effect')))
    const childEdges = planAudioRoutes(inner.settings.layout, inner.settings.exposedPorts)
    assert.ok(!childEdges.some((edge) => edge.to === audioInput('gain') && edge.from === 'bank-pre'))
    assert.ok(!childEdges.some((edge) => edge.from === audioOutput('gain') && edge.to === 'bank-post'))
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const { saveProjectToFile, loadProjectFromFile } = await server.ssrLoadModule('/src/saveManager.ts')
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [
      { id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout },
    ] }
    assert.ok(isSavedProject(project))
    const restored = await loadProjectFromFile(await saveProjectToFile(project))
    assert.equal(restored.banks[0].layout.items[1].settings.exposedPorts[0].parameterId, 'in')
    const feedback = { ...layout, connections: [layout.connections[1],
      { id: 'feedback', sourceId: 'effect', sourceParameter: 'audio', targetId: 'sub', targetParameter: 'in' }] }
    assert.throws(() => validateAudioRoutes(feedback), /feedback/i)
    effect.settings.audioFrom = 'bank-post-fx'
    effect.settings.audioTo = 'wires'
    const busFeedback = { ...layout, connections: [
      { id: 'feedback', sourceId: 'effect', sourceParameter: 'audio', targetId: 'sub', targetParameter: 'in' },
    ] }
    assert.throws(() => validateAudioRoutes(busFeedback), /feedback/i)
  } finally { await server.close() }
})

test('selector signal constraints include wires on both sides of a SubGrid', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { selectorRoutingCompatible } = await server.ssrLoadModule('/src/parameters.ts')
    const sub = createControl('sub', 1, 0, 'sub-grid')
    const selector = createControl('selector', 0, 0, 'output-selector')
    const piano = createControl('inner-piano', 1, 0, 'piano-roll')
    sub.settings.layout.items.push(selector, piano)
    sub.settings.exposedPorts.push(
      { id: 'note', name: 'Note', kind: 'note', direction: 'input', itemId: 'selector', parameterId: 'note' },
      { id: 'value', name: 'Value', kind: 'numeric', direction: 'input', itemId: 'selector', parameterId: 'value' },
    )
    const parentPiano = createControl('parent-piano', 0, 0, 'piano-roll')
    const knob = createControl('knob', 2, 0, 'knob')
    const layout = { columns: 3, rows: 1, items: [parentPiano, sub, knob], connections: [
      { id: 'parent-note', sourceId: 'parent-piano', sourceParameter: 'note', targetId: 'sub', targetParameter: 'note' },
    ] }
    assert.equal(selectorRoutingCompatible(layout), true)
    const internal = { id: 'inner-note', sourceId: 'inner-piano', sourceParameter: 'note', targetId: 'selector', targetParameter: 'note' }
    assert.equal(selectorRoutingCompatible(layout, { layout: sub.settings.layout, connections: [internal] }), false)
    const number = { id: 'parent-number', sourceId: 'knob', sourceParameter: 'value', targetId: 'sub', targetParameter: 'value' }
    assert.equal(selectorRoutingCompatible(layout, { layout, connections: [...layout.connections, number] }), false)
    const tone = createControl('inner-tone', 2, 0, 'tone-element')
    sub.settings.layout.items.push(tone)
    sub.settings.exposedPorts.push({ id: 'out', name: 'Output', kind: 'numeric', direction: 'output', itemId: 'selector', parameterId: 'value' })
    sub.settings.layout.connections.push({ id: 'local-out', sourceId: 'selector', sourceParameter: 'note', targetId: 'inner-tone', targetParameter: 'note' })
    const output = { id: 'parent-out', sourceId: 'sub', sourceParameter: 'out', targetId: 'knob', targetParameter: 'value' }
    assert.equal(selectorRoutingCompatible(layout, { layout, connections: [output] }), false)
  } finally { await server.close() }
})

test('control-free Tone element toggles its accessible mute button', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const vue = await import('vue')
    const { createRenderer, h, nextTick, reactive } = vue
    const { parse, compileScript } = await import('@vue/compiler-sfc')
    async function component(name) {
      const source = await readFile(new URL(`../src/components/widgets/tone/${name}.vue`, import.meta.url), 'utf8')
      const { descriptor } = parse(source)
      const compiled = compileScript(descriptor, { id: `${name}-test`, inlineTemplate: true })
      const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
      const module = { exports: {} }
      vm.runInNewContext(code, { module, exports: module.exports, require: (id) => id === 'vue' ? vue : {} })
      return module.exports.default
    }
    const ToneElement = await component('ToneElement')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const settings = reactive(createControl('effect', 0, 0, 'tone-element').settings)
    settings.elementType = 'filter'
    const renderer = createRenderer({
      createElement: (type) => ({ type, props: {}, children: [] }),
      createText: (text) => ({ text }),
      createComment: (text) => ({ text }),
      setText: (node, text) => { node.text = text },
      setElementText: (node, text) => { node.text = text },
      patchProp: (node, key, _old, value) => { node.props[key] = value },
      insert: (node, parent, anchor) => {
        node.parent = parent
        const index = anchor ? parent.children.indexOf(anchor) : -1
        parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
      },
      remove: (node) => {
        const index = node.parent.children.indexOf(node)
        if (index >= 0) node.parent.children.splice(index, 1)
      },
      parentNode: (node) => node.parent,
      nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
    })
    const root = { children: [] }
    const app = renderer.createApp({ render: () => h(ToneElement, {
      label: 'Filter', settings, available: true, onToggleMute: () => { settings.muted = !settings.muted },
    }) })
    app.mount(root)
    const button = root.children[0]
    assert.equal(button.type, 'button')
    assert.equal(button.props['aria-pressed'], false)
    button.props.onClick()
    await nextTick()
    assert.equal(settings.muted, true)
    assert.equal(button.props['aria-pressed'], true)
    assert.equal(button.props['aria-label'], 'Unmute Filter')
    button.props.onClick()
    await nextTick()
    assert.equal(settings.muted, false)
    assert.equal(button.props['aria-pressed'], false)
    settings.tapMode = 'bypass'
    await nextTick()
    assert.equal(button.props['aria-label'], 'Bypass Filter')
    app.unmount()
    const bypassRoot = { children: [] }
    renderer.createApp({ render: () => h(ToneElement, {
      label: 'Filter', settings, available: true, onToggleMute: () => { settings.bypassed = !settings.bypassed },
    }) }).mount(bypassRoot)
    const bypassButton = bypassRoot.children[0]
    bypassButton.props.onClick()
    await nextTick()
    assert.equal(settings.bypassed, true)
    assert.equal(bypassButton.props['aria-pressed'], true)
    assert.equal(bypassButton.props['aria-label'], 'Enable Filter')
    bypassButton.props.onClick()
    await nextTick()
    assert.equal(settings.bypassed, false)

    const panelSource = await readFile(new URL('../src/components/widgets/tone/ToneElementSettingsPanel.vue', import.meta.url), 'utf8')
    const panelScript = compileScript(parse(panelSource).descriptor, { id: 'tone-settings-test' })
    const panelCode = ts.transpileModule(panelScript.content, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const panelModule = { exports: {} }
    vm.runInNewContext(panelCode, { module: panelModule, exports: panelModule.exports, require: (id) => id === 'vue' ? vue : {} })
    const panel = panelModule.exports.default.setup({}, { emit() {}, expose() {} })
    settings.tapMode = 'mute'
    settings.muted = true
    panel.changeTapMode(settings, { target: { value: 'bypass' } })
    assert.equal(settings.muted, false)
    assert.equal(settings.bypassed, true)
    panel.changeTapMode(settings, { target: { value: 'mute' } })
    assert.equal(settings.bypassed, false)
    assert.equal(settings.muted, true)
    settings.bypassed = true
    panel.changeShowBypass(settings, { target: { checked: false } })
    assert.equal(settings.showBypass, false)
    assert.equal(settings.bypassed, false)

    for (const [name, type] of [['ToneOscillator', 'oscillator'], ['ToneNoise', 'noise']]) {
      const sourceSettings = reactive(createControl(type, 0, 0, 'tone-element').settings)
      sourceSettings.elementType = type
      const sourceRoot = { children: [] }
      const Source = await component(name)
      const sourceApp = renderer.createApp({ render: () => h(Source, {
        label: type, settings: sourceSettings, baseFrequency: 440, notes: [], muted: !!sourceSettings.muted,
        onToggleMute: () => { sourceSettings.muted = !sourceSettings.muted },
      }) })
      sourceApp.mount(sourceRoot)
      assert.equal(sourceRoot.children[0].type, 'button')
      sourceRoot.children[0].props.onClick()
      await nextTick()
      assert.equal(sourceSettings.muted, true)
      sourceSettings.noteMode = 'continuous'
      await nextTick()
      assert.equal(sourceRoot.children[0].type, 'div')
      sourceRoot.children[0].props.onClick()
      assert.equal(sourceSettings.muted, true)
      const unmute = sourceRoot.children[0].children.find((child) => child.text === 'Unmute')
      assert.ok(unmute)
      unmute.props.onClick({ stopPropagation() {} })
      await nextTick()
      assert.equal(sourceSettings.muted, false)
      sourceApp.unmount()
    }

    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const item = createControl('saved', 0, 0, 'tone-element')
    item.settings.elementType = 'filter'
    item.settings.muted = true
    item.settings.tapMode = 'bypass'
    item.settings.bypassed = true
    item.settings.showBypass = true
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [
      { id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout: { columns: 1, rows: 1, items: [item], connections: [] } },
    ] }
    assert.equal(isSavedProject(project), true)
    const { saveProjectToFile, loadProjectFromFile } = await server.ssrLoadModule('/src/saveManager.ts')
    const restored = await loadProjectFromFile(await saveProjectToFile(project))
    assert.equal(restored.banks[0].layout.items[0].settings.muted, true)
    assert.equal(restored.banks[0].layout.items[0].settings.tapMode, 'bypass')
    assert.equal(restored.banks[0].layout.items[0].settings.bypassed, true)
    assert.equal(restored.banks[0].layout.items[0].settings.showBypass, true)
    item.settings.tapMode = 'invalid'
    assert.equal(isSavedProject(project), false)
    item.settings.tapMode = 'bypass'
    item.settings.showBypass = 'invalid'
    assert.equal(isSavedProject(project), false)
    item.settings.showBypass = true
    item.settings.bypassed = 'invalid'
    assert.equal(isSavedProject(project), false)
    item.settings.bypassed = true
    item.settings.muted = 'invalid'
    assert.equal(isSavedProject(project), false)
  } finally { await server.close() }
})

test('envelope and mixer bypass buttons are optional', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createSSRApp, h } = await import('vue')
    const { renderToString } = await import('@vue/server-renderer')
    const { default: GrooveGrid } = await server.ssrLoadModule('/src/components/GrooveGrid.vue')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    for (const type of ['envelope', 'mixer']) {
      const item = createControl(type, 0, 0, 'tone-element')
      item.settings.elementType = type
      item.label = type
      if (type === 'envelope') {
        item.settings.showVisualizer = false
        item.settings.showKnobs = false
      }
      const layout = { columns: 1, rows: 1, items: [item], connections: [] }
      const render = () => renderToString(createSSRApp({ render: () => h(GrooveGrid,
        { layout, editing: false, wiring: false, settingsOpen: false, bpm: 120 }) }))
      assert.doesNotMatch(await render(), /tone-bypass-button/)
      item.settings.showBypass = true
      let html = await render()
      assert.match(html, new RegExp(`aria-label="Bypass ${type}"`))
      if (type === 'envelope') assert.match(html, /Open envelope control settings/)
      item.settings.bypassed = true
      html = await render()
      assert.match(html, new RegExp(`aria-label="Enable ${type}"`))
      assert.match(html, /aria-pressed="true"/)
    }
  } finally { await server.close() }
})

test('bank audio updates processors and gates an envelope without restarting the graph', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const routes = await server.ssrLoadModule('/src/audio/audioRoutes.ts')
    const modulation = await server.ssrLoadModule('/src/modulation.ts')
    const parameters = await server.ssrLoadModule('/src/parameters.ts')
    const source = await readFile(new URL('../src/audio/bankAudio.ts', import.meta.url), 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const calls = []
    class Node {
      disposed = false
      connect(target) { calls.push(['connect', this, target]); return this }
      disconnect(target) { calls.push(['disconnect', this, target]); return this }
      toDestination() { return this }
      dispose() { this.disposed = true; return this }
    }
    const signal = () => ({ rampTo(value) { this.value = value } })
    class Gain extends Node { constructor(value) { super(); this.gain = signal(); this.gain.value = value } }
    const channels = []
    class Channel extends Node {
      constructor(options) {
        super()
        this.volume = signal()
        this.pan = signal()
        this.volume.value = options.volume
        this.pan.value = options.pan
        this.mute = false
        channels.push(this)
      }
    }
    class Filter extends Node { constructor() { super(); this.frequency = signal(); this.Q = signal() } }
    class FeedbackDelay extends Node { constructor() { super(); this.delayTime = signal(); this.feedback = signal(); this.wet = signal() } }
    class Reverb extends Node {
      constructor(options) { super(); this._decay = options.decay; this.wet = signal(); this.ready = Promise.resolve(); this.generations = [] }
      get decay() { return this._decay }
      set decay(value) {
        this._decay = value
        this.generations.push(value)
        if (this.deferred) this.ready = new Promise((resolve, reject) => { this.finish = resolve; this.fail = reject })
        else this.ready = Promise.resolve()
      }
    }
    class Scale extends Node {}
    class Envelope extends Node {
      constructor(options) { super(); Object.assign(this, options); this.context = { immediate: () => 3 }; this.value = 0 }
      getValueAtTime(time) { calls.push(['sample', time]); return this.value }
      triggerAttack(_, velocity) { calls.push(['attack', velocity]) }
      triggerRelease() { calls.push(['release']) }
    }
    const tone = { ToneAudioNode: Node, Gain, Channel, Filter, FeedbackDelay, Reverb, Envelope, Scale }
    const module = { exports: {} }
    vm.runInNewContext(code, { module, exports: module.exports,
      require: (name) => name === 'tone' ? tone : name === '../modulation' ? modulation : name === '../parameters' ? parameters : routes })
    const errors = []
    const graph = new module.exports.BankAudio((error) => errors.push(error))
    const effect = createControl('effect', 0, 0, 'tone-element')
    effect.settings.elementType = 'gain'
    const envelope = createControl('envelope', 1, 0, 'tone-element')
    envelope.settings.elementType = 'envelope'
    const layout = { columns: 2, rows: 1, items: [effect, envelope], connections: [] }
    graph.update(layout)
    const envelopeNode = graph.getEnvelopeSignal('envelope')
    const envelopeGain = graph.getInput('envelope')
    assert.ok(calls.some(([action, from, to]) => action === 'connect' && from === envelopeNode && to === envelopeGain.gain))
    assert.equal(envelopeNode.sustain, 1)
    envelope.settings.sustain = 0.4
    graph.update(layout)
    assert.equal(envelopeNode.sustain, 0.4)
    envelopeNode.value = 0.25
    assert.equal(graph.getEnvelopeValue('envelope'), 0.25)
    assert.deepEqual(calls.filter(([action]) => action === 'sample'), [['sample', 3]])
    const gainNode = graph.getInput('effect')
    const effectOutput = graph.getOutput('effect')
    assert.notEqual(effectOutput, gainNode)
    const effectWet = calls.find(([action, from, to]) => action === 'connect' && from === gainNode && to instanceof Gain)?.[2]
    assert.ok(effectWet)
    assert.ok(calls.some(([action, from, to]) => action === 'connect' && from === effectWet && to === effectOutput))
    assert.equal(effectOutput.gain.value, 1)
    effect.settings.muted = true
    graph.update(layout)
    assert.equal(effectOutput.gain.value, 0)
    assert.equal(gainNode.gain.value, effect.settings.gain)
    const extra = createControl('extra', 2, 0, 'instrument-pad')
    graph.update({ columns: 3, rows: 1, items: [...layout.items, extra], connections: [] })
    assert.equal(effectOutput.gain.value, 0)
    effect.settings.muted = false
    graph.update(layout)
    assert.equal(effectOutput.gain.value, 1)
    const connectionCount = calls.filter(([action]) => action === 'connect').length
    effect.settings.gain = 0.3
    graph.update(layout)
    assert.equal(gainNode.gain.value, 0.3)
    assert.equal(calls.filter(([action]) => action === 'connect').length, connectionCount)
    graph.setNotes('envelope', [{ note: 60, count: 1, velocity: 64 }])
    graph.setNotes('envelope', [{ note: 60, count: 1, velocity: 64 }])
    graph.setNotes('envelope', [])
    assert.deepEqual(calls.filter(([action]) => action === 'attack' || action === 'release'),
      [['attack', 64 / 127], ['release']])

    const filter = createControl('filter', 2, 0, 'tone-element')
    filter.settings.elementType = 'filter'
    const delay = createControl('delay', 3, 0, 'tone-element')
    delay.settings.elementType = 'delay'
    const mixerControl = createControl('master', 4, 0, 'tone-element')
    mixerControl.settings.elementType = 'mixer'
    const envelopeTarget = createControl('envelope-target', 5, 0, 'tone-element')
    envelopeTarget.settings.elementType = 'envelope'
    const processorLayout = { columns: 6, rows: 1, items: [effect, envelope, filter, delay, mixerControl, envelopeTarget],
      connections: [{ id: 'adsr', sourceId: 'envelope', sourceParameter: 'value',
        targetId: 'envelope-target', targetParameter: 'attack', mappingMode: 'abs' }] }
    const toneSettings = new Map([
      ['effect', { ...effect.settings, gain: 1.2 }],
      ['filter', { ...filter.settings, cutoff: 2500, gain: 1.5 }],
      ['delay', { ...delay.settings, delayTime: 1.5, feedback: 1, gain: 0.3 }],
      ['master', { ...mixerControl.settings, gain: 1.4 }],
      ['envelope-target', { ...envelopeTarget.settings, attack: 0.4, decay: 2, sustain: 0.6, release: 3 }],
    ])
    graph.update(processorLayout, [], { toneSettings })
    for (const id of ['filter', 'delay']) {
      const input = graph.getInput(id)
      const output = graph.getOutput(id)
      assert.notEqual(output, input)
      const wet = calls.find(([action, from, to]) => action === 'connect' && from === input && to instanceof Gain)?.[2]
      assert.ok(calls.some(([action, from, to]) => action === 'connect' && from === wet && to === output))
    }
    assert.equal(gainNode.gain.value, 1.2)
    assert.equal(graph.getInput('filter').frequency.value, 2500)
    assert.equal(graph.getInput('filter').Q.value, 1.5)
    assert.equal(graph.getInput('delay').delayTime.value, 1.5)
    assert.equal(graph.getInput('delay').feedback.value, 0.99)
    assert.equal(graph.getInput('delay').wet.value, 0.3)
    assert.equal(graph.getInput('master').gain.value, 1.4)
    const targetEnvelope = graph.getEnvelopeSignal('envelope-target')
    assert.deepEqual([targetEnvelope.attack, targetEnvelope.decay, targetEnvelope.sustain, targetEnvelope.release], [0.4, 2, 0.6, 3])
    assert.equal(envelopeTarget.settings.attack, 0.01)
    processorLayout.connections.push({ id: 'delay-wet', sourceId: 'envelope', sourceParameter: 'value',
      targetId: 'delay', targetParameter: 'gain', mappingMode: 'abs' })
    toneSettings.get('delay').gain = 0.9
    graph.update(processorLayout, [], { toneSettings })
    assert.equal(graph.getInput('delay').wet.value, 0.3)
    assert.ok(calls.some(([action, from, to]) => action === 'connect' && from instanceof Scale && to === graph.getInput('delay').wet))

    const reverb = createControl('reverb', 2, 0, 'tone-element')
    reverb.settings.elementType = 'reverb'
    const reverbLayout = { columns: 3, rows: 1, items: [effect, envelope, reverb], connections: [] }
    const reverbValues = (wet, decay) => ({ toneSettings: new Map([['reverb', { ...reverb.settings, gain: wet, decay }]]) })
    graph.update(reverbLayout, [], reverbValues(0.25, 0.5))
    const reverbNode = graph.getInput('reverb')
    const reverbOutput = graph.getOutput('reverb')
    const reverbWet = calls.find(([action, from, to]) => action === 'connect' && from === reverbNode && to instanceof Gain)?.[2]
    assert.ok(calls.some(([action, from, to]) => action === 'connect' && from === reverbWet && to === reverbOutput))
    reverb.settings.muted = true
    graph.update(reverbLayout, [], reverbValues(0.25, 0.5))
    assert.equal(reverbOutput.gain.value, 0)
    assert.equal(reverbNode.wet.value, 0.25)
    assert.equal(reverbNode.wet.value, 0.25)
    graph.update(reverbLayout, [], reverbValues(0.75, 0.5))
    assert.equal(reverbNode.wet.value, 0.75)
    assert.equal(reverb.settings.gain, 0.8)
    reverbNode.deferred = true
    graph.update(reverbLayout, [], reverbValues(0.75, 2))
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(reverbNode.generations, [2])
    graph.update(reverbLayout, [], reverbValues(0.75, 3))
    graph.update(reverbLayout, [], reverbValues(0.75, 4))
    assert.deepEqual(reverbNode.generations, [2])
    reverbNode.finish()
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(reverbNode.generations, [2, 4])
    reverbNode.finish()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(reverb.settings.decay, 0.5)
    graph.update(reverbLayout, [], reverbValues(0.75, 5))
    await new Promise((resolve) => setImmediate(resolve))
    reverbNode.fail(new Error('offline render failed'))
    await new Promise((resolve) => setImmediate(resolve))
    assert.match(errors.pop(), /offline render failed/)
    reverbNode.deferred = false
    reverbLayout.connections.push({ id: 'envelope-wet', sourceId: 'envelope', sourceParameter: 'value',
      targetId: 'reverb', targetParameter: 'gain', mappingMode: 'abs' })
    graph.update(reverbLayout, [], reverbValues(0.25, 5))
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(reverbNode.generations, [2, 4, 5, 5])
    assert.equal(reverbNode.wet.value, 0.75)
    assert.ok(calls.some(([action, from, to]) => action === 'connect' && from instanceof Scale && to === reverbNode.wet))

    for (const type of ['oscillator', 'noise']) {
      const source = createControl(type, 0, 0, 'tone-element')
      source.settings.elementType = type
      source.settings.muted = true
      graph.update({ columns: 1, rows: 1, items: [source], connections: [] })
      const input = graph.getInput(type)
      const output = graph.getOutput(type)
      assert.notEqual(input, output)
      assert.ok(calls.some(([action, from, to]) => action === 'connect' && from === input && to === output))
      assert.equal(output.gain.value, 0)
      source.settings.muted = false
      graph.update({ columns: 1, rows: 1, items: [source], connections: [] })
      assert.equal(output.gain.value, 1)
    }

    channels.length = 0
    const sourceA = createControl('source-a', 0, 0, 'instrument-pad')
    const sourceB = createControl('source-b', 1, 0, 'instrument-pad')
    const mixer = createControl('mixer', 2, 0, 'tone-element')
    mixer.settings.elementType = 'mixer'
    const mixerLayout = { columns: 3, rows: 1, items: [sourceA, sourceB, mixer], connections: [
      { id: 'a-to-mixer', sourceId: sourceA.id, sourceParameter: 'audio', targetId: mixer.id, targetParameter: 'audio' },
      { id: 'b-to-mixer', sourceId: sourceB.id, sourceParameter: 'audio', targetId: mixer.id, targetParameter: 'audio' },
    ] }
    graph.update(mixerLayout)
    assert.deepEqual([...graph.getMixerInputs(mixer.id)], ['item:source-a:out', 'item:source-b:out'])
    assert.equal(channels.length, 2)
    const channelA = channels.find((channel) => calls.some(([action, from, to]) =>
      action === 'connect' && from === graph.getOutput(sourceA.id) && to === channel))
    const channelB = channels.find((channel) => calls.some(([action, from, to]) =>
      action === 'connect' && from === graph.getOutput(sourceB.id) && to === channel))
    assert.ok(channelA)
    assert.ok(channelB)
    mixer.settings.mixerChannels = {
      [routes.audioOutput(sourceA.id)]: { volume: -8, pan: -0.5, solo: true },
      [routes.audioOutput(sourceB.id)]: { volume: 2, pan: 0.75, solo: false },
    }
    const mixerConnectionCount = calls.filter(([action]) => action === 'connect').length
    graph.update(mixerLayout)
    assert.equal(channelA.volume.value, -8)
    assert.equal(channelA.pan.value, -0.5)
    assert.equal(channelA.mute, false)
    assert.equal(channelB.volume.value, 2)
    assert.equal(channelB.pan.value, 0.75)
    assert.equal(channelB.mute, true)
    assert.equal(calls.filter(([action]) => action === 'connect').length, mixerConnectionCount)

    const subgridInput = new Gain(1)
    const subgridOutput = new Gain(1)
    const child = new module.exports.BankAudio((error) => errors.push(error), subgridInput, subgridOutput)
    child.update({ columns: 1, rows: 1, items: [], connections: [] })
    assert.ok(calls.some(([action, from, to]) => action === 'connect' && from === subgridInput && to === child.input))
    assert.ok(calls.some(([action, from, to]) => action === 'connect' && from === child.output && to === subgridOutput))
    assert.equal(calls.filter(([action, from]) => action === 'connect' && from === child.output).length, 1)
    child.dispose()
    assert.ok(calls.some(([action, from, to]) => action === 'disconnect' && from === subgridInput && to === child.input))
    const sub = createControl('sub', 0, 0, 'sub-grid')
    const innerEffect = createControl('inner', 0, 0, 'tone-element')
    innerEffect.settings.elementType = 'mixer'
    sub.settings.layout.items.push(innerEffect)
    sub.settings.exposedPorts.push(
      { id: 'in', name: 'In', kind: 'audio', direction: 'input', itemId: 'inner', parameterId: 'audio' },
      { id: 'out', name: 'Out', kind: 'audio', direction: 'output', itemId: 'inner', parameterId: 'audio' },
    )
    graph.update({ columns: 1, rows: 1, items: [sub], connections: [] })
    assert.equal(envelopeNode.disposed, true)
    assert.equal(envelopeGain.disposed, true)
    const inputNode = graph.getPort('sub', sub.settings.exposedPorts[0])
    const outputNode = graph.getPort('sub', sub.settings.exposedPorts[1])
    const routedChild = new module.exports.BankAudio((error) => errors.push(error), graph.getInput('sub'), graph.getOutput('sub'))
    routedChild.update(sub.settings.layout, [
      { port: sub.settings.exposedPorts[0], node: inputNode },
      { port: sub.settings.exposedPorts[1], node: outputNode },
    ])
    const boundaryChannel = channels[2]
    assert.ok(calls.some(([action, from, to]) => action === 'connect' && from === inputNode && to === boundaryChannel))
    assert.ok(calls.some(([action, from, to]) => action === 'connect' && from === boundaryChannel && to === routedChild.getInput('inner')))
    assert.ok(calls.some(([action, from, to]) => action === 'connect' && from === routedChild.getOutput('inner') && to === outputNode))
    const boundaryDry = calls.find(([action, from, to]) => action === 'connect' && from === inputNode && to instanceof Gain &&
      calls.some(([a, f, t]) => a === 'connect' && f === to && t === routedChild.getOutput('inner')))?.[2]
    assert.ok(boundaryDry)
    innerEffect.settings.bypassed = true
    routedChild.update(sub.settings.layout, [
      { port: sub.settings.exposedPorts[0], node: inputNode },
      { port: sub.settings.exposedPorts[1], node: outputNode },
    ])
    assert.equal(boundaryDry.gain.value, 1)
    routedChild.update(sub.settings.layout, [{ port: sub.settings.exposedPorts[1], node: outputNode }])
    assert.ok(calls.some(([action, from, to]) => action === 'disconnect' && from === inputNode && to === boundaryChannel))
    assert.ok(calls.some(([action, from, to]) => action === 'disconnect' && from === inputNode && to === boundaryDry))
    routedChild.dispose()
    graph.dispose()
    assert.equal(gainNode.disposed, true)
    assert.equal(effectOutput.disposed, true)

    for (const type of ['filter', 'gain', 'delay', 'reverb', 'envelope', 'mixer']) {
      const bypassGraph = new module.exports.BankAudio((error) => errors.push(error))
      const source = createControl(`input-${type}`, 0, 0, 'instrument-pad')
      const target = createControl(`target-${type}`, 1, 0, 'tone-element')
      target.settings.elementType = type
      target.settings.bypassed = true
      const wire = { id: `wire-${type}`, sourceId: source.id, sourceParameter: 'audio', targetId: target.id, targetParameter: 'audio' }
      const bypassLayout = { columns: 2, rows: 1, items: [source, target], connections: [wire] }
      bypassGraph.update(bypassLayout)
      const input = bypassGraph.getInput(target.id)
      const output = bypassGraph.getOutput(target.id)
      const wet = calls.find(([action, from, to]) => action === 'connect' && from === input && to instanceof Gain &&
        calls.some(([a, f, t]) => a === 'connect' && f === to && t === output))?.[2]
      const dry = calls.find(([action, from, to]) => action === 'connect' && from === bypassGraph.getOutput(source.id) &&
        to instanceof Gain && calls.some(([a, f, t]) => a === 'connect' && f === to && t === output))?.[2]
      assert.ok(wet, `${type} processed path`)
      assert.ok(dry, `${type} direct path`)
      assert.equal(wet.gain.value, 0)
      assert.equal(dry.gain.value, 1)
      assert.equal(output.gain.value, 1)
      target.settings.bypassed = false
      bypassGraph.update(bypassLayout)
      assert.equal(wet.gain.value, 1)
      assert.equal(dry.gain.value, 0)
      bypassGraph.dispose()
      assert.equal(wet.disposed, true)
      assert.equal(dry.disposed, true)
    }
    assert.deepEqual(errors, [])
  } finally {
    await server.close()
  }
})
