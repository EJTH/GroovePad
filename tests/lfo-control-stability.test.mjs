import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'
import { computed, reactive } from 'vue'

test('LFO modulation preserves unrelated control identity and updates wired controls', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { effectiveControls } = await server.ssrLoadModule('/src/modulation.ts')
    const lfo = createControl('lfo', 0, 0, 'lfo')
    const target = createControl('target', 1, 0, 'lfo')
    const pad = createControl('pad', 2, 0, 'instrument-pad', '303')
    const loop = createControl('loop', 3, 0, 'sequenced-loop')
    const wire = { id: 'wire', sourceId: 'lfo', sourceParameter: 'value', targetId: 'target', targetParameter: 'depth' }
    const layout = reactive({ columns: 4, rows: 1, items: [lfo, target, pad, loop], connections: [wire] })
    const signals = reactive(new Map([['lfo:value', -1]]))
    const controls = computed(() => effectiveControls(layout, signals, [], new Map(), true))
    const resolve = (value) => { signals.set('lfo:value', value); return controls.value }

    const first = resolve(-1)
    const second = resolve(1)
    assert.equal(first[1].settings.depth, 0)
    assert.equal(second[1].settings.depth, 1)
    assert.equal(target.settings.depth, 1)
    for (const index of [0, 2, 3]) assert.equal(first[index], second[index])
    assert.equal(first[2].settings, second[2].settings)

    layout.items[2].label = 'Changed'
    assert.equal(resolve(0)[2].label, 'Changed')
    layout.connections[0].targetId = 'pad'
    layout.connections[0].targetParameter = 'volume'
    const wired = resolve(-1)
    assert.notEqual(wired[2], layout.items[2])
    assert.equal(wired[2].settings.instrumentParams.volume, -48)
    assert.notEqual(pad.settings.instrumentParams.volume, -48)
    layout.connections.length = 0
    assert.equal(resolve(0)[2], layout.items[2])

    const knob = createControl('knob', 4, 0, 'knob')
    const filter = createControl('filter', 5, 0, 'tone-element')
    filter.settings.elementType = 'filter'
    layout.items.push(knob, filter)
    layout.connections.push(
      { id: 'to-knob', sourceId: 'lfo', sourceParameter: 'value', targetId: 'knob', targetParameter: 'value' },
      { id: 'to-filter', sourceId: 'knob', sourceParameter: 'value', targetId: 'filter', targetParameter: 'cutoff' },
    )
    const low = resolve(-1)
    const high = resolve(1)
    assert.ok(low[4].settings.value < high[4].settings.value)
    assert.ok(low[5].settings.cutoff < high[5].settings.cutoff)
    assert.equal(knob.settings.value, 64)
    assert.equal(filter.settings.cutoff, 1000)
  } finally {
    await server.close()
  }
})

test('legacy random LFO settings and automation migrate in projects and presets', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { migrateSavedProject, isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const { importPresetCollection } = await server.ssrLoadModule('/src/presets.ts')
    const lfo = createControl('lfo', 0, 0, 'lfo')
    lfo.settings.waveform = 'random'
    const sub = createControl('sub', 0, 0, 'sub-grid')
    sub.settings.layout.items.push(lfo)
    const loop = createControl('loop', 1, 0, 'sequenced-loop')
    loop.settings.automation[0].push({ sourceId: 'lfo', parameter: 'setting:lfo:waveform', value: 3, position: 0 })
    const layout = { columns: 2, rows: 1, items: [sub, loop], connections: [] }
    const preset = { id: 'preset', name: 'Preset', schemaVersion: 1, layout: structuredClone(layout), assets: [] }
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [
      { id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout },
    ], subGridPresets: [structuredClone(preset)] }
    migrateSavedProject(project)
    assert.equal(isSavedProject(project), true)
    assert.equal(lfo.settings.waveform, 'sine')
    assert.equal(loop.settings.automation[0][0].value, 0)
    assert.equal(project.subGridPresets[0].layout.items[0].settings.layout.items[0].settings.waveform, 'sine')
    const imported = importPresetCollection({ schemaVersion: 1, presets: [preset] })
    assert.equal(imported[0].layout.items[0].settings.layout.items[0].settings.waveform, 'sine')
    assert.equal(imported[0].layout.items[1].settings.automation[0][0].value, 0)
  } finally {
    await server.close()
  }
})
