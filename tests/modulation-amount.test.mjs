import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

test('connection amounts scale signed and unipolar signals against the destination range', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { effectiveControls } = await server.ssrLoadModule('/src/modulation.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const lfo = createControl('lfo', 0, 0, 'lfo')
    const knob = createControl('knob', 1, 0, 'knob')
    knob.settings.max = 100
    knob.settings.value = 50
    const wire = { id: 'wire', sourceId: 'lfo', sourceParameter: 'value', targetId: 'knob', targetParameter: 'value' }
    const layout = { columns: 4, rows: 1, items: [lfo, knob], connections: [wire] }
    const signals = new Map([['lfo:value', 1]])
    const value = () => effectiveControls(layout, signals).find((item) => item.id === 'knob').settings.value

    assert.equal(value(), 100)
    wire.modulationAmount = 25
    assert.equal(value(), 75)
    signals.set('lfo:value', -1)
    assert.equal(value(), 25)
    wire.modulationAmount = -25
    assert.equal(value(), 75)
    wire.modulationAmount = 0
    assert.equal(value(), 50)
    wire.modulationAmount = 100
    assert.equal(value(), 0)
    assert.equal(knob.settings.value, 50)

    const wheel = createControl('wheel', 2, 0, 'mod-wheel')
    layout.items.push(wheel)
    wire.sourceId = wheel.id
    wire.modulationAmount = -50
    signals.set('wheel:value', 0.5)
    assert.equal(value(), 25)
    wheel.settings.autoCenter = true
    signals.set('wheel:value', -0.5)
    assert.equal(value(), 75)

    const selector = createControl('selector', 3, 0, 'output-selector')
    layout.items.push(selector)
    layout.connections.unshift({ id: 'incoming', sourceId: wheel.id, sourceParameter: 'value', targetId: selector.id, targetParameter: 'value' })
    wire.sourceId = selector.id
    assert.equal(value(), 75)

    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout }] }
    assert.equal(isSavedProject(JSON.parse(JSON.stringify(project))), true)
    wire.modulationAmount = 101
    assert.equal(isSavedProject(project), false)
    wire.modulationAmount = NaN
    assert.equal(isSavedProject(project), false)
    delete wire.modulationAmount
    assert.equal(isSavedProject(project), true)
  } finally {
    await server.close()
  }
})

test('endpoint mappings interpolate offsets, reverse ranges and preserve legacy mappings', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { effectiveControls } = await server.ssrLoadModule('/src/modulation.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const lfo = createControl('lfo', 0, 0, 'lfo')
    const target = createControl('target', 1, 0, 'lfo')
    target.settings.offset = 0
    const wire = { id: 'wire', sourceId: 'lfo', sourceParameter: 'value', targetId: 'target', targetParameter: 'offset',
      modulationMin: -25, modulationMax: 50 }
    const layout = { columns: 2, rows: 1, items: [lfo, target], connections: [wire] }
    const signals = new Map([['lfo:value', -1]])
    const value = () => effectiveControls(layout, signals)[1].settings.offset
    assert.equal(value(), -0.5)
    signals.set('lfo:value', 0)
    assert.equal(value(), 0.25)
    signals.set('lfo:value', 1)
    assert.equal(value(), 1)
    wire.modulationMin = 50
    wire.modulationMax = -50
    assert.equal(value(), -1)
    signals.set('lfo:value', -1)
    assert.equal(value(), 1)
    wire.modulationMin = -20
    wire.modulationMax = -20
    assert.equal(value(), -0.4)
    delete wire.modulationMin
    wire.modulationMax = 50
    signals.set('lfo:value', -1)
    assert.equal(value(), -1)
    delete wire.modulationMin
    delete wire.modulationMax
    wire.modulationAmount = 25
    signals.set('lfo:value', -1)
    assert.equal(value(), -0.5)
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout }] }
    assert.equal(isSavedProject(project), true)
    delete wire.modulationAmount
    wire.modulationMin = -100
    wire.modulationMax = 100
    assert.equal(isSavedProject(project), true)
    wire.modulationMin = -101
    assert.equal(isSavedProject(project), false)
    wire.modulationMin = 0
    wire.modulationAmount = 10
    assert.equal(isSavedProject(project), false)
  } finally {
    await server.close()
  }
})

test('numeric mappings work through output selector inputs, outputs and selection inputs', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { effectiveControls, modulationOffset, numericSignal, numericSourceRange } = await server.ssrLoadModule('/src/modulation.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const pad = createControl('pad', 0, 0, 'pad')
    const selector = createControl('selector', 1, 0, 'output-selector')
    const target = createControl('target', 2, 0, 'lfo')
    const incoming = { id: 'in', sourceId: 'pad', sourceParameter: 'pressure', targetId: 'selector', targetParameter: 'value',
      modulationMin: 25, modulationMax: 75 }
    const outgoing = { id: 'out', sourceId: 'selector', sourceParameter: 'value', targetId: 'target', targetParameter: 'depth',
      modulationMin: -50, modulationMax: 50 }
    const layout = { columns: 3, rows: 1, items: [pad, selector, target], connections: [incoming, outgoing] }
    const signals = new Map([['pad:pressure', 0]])
    assert.deepEqual(numericSourceRange(layout, outgoing), { min: 0, max: 127 })
    target.settings.depth = 0.5
    assert.equal(effectiveControls(layout, signals)[2].settings.depth, 0.25)
    signals.set('pad:pressure', 127)
    assert.equal(effectiveControls(layout, signals)[2].settings.depth, 0.75)
    delete outgoing.modulationMax
    delete outgoing.modulationMin
    assert.equal(effectiveControls(layout, signals)[2].settings.depth, 0.75)
    const selection = { id: 'selection', sourceId: 'pad', sourceParameter: 'velocity', targetId: 'selector', targetParameter: 'selection',
      modulationMin: 25, modulationMax: 75 }
    layout.connections.push(selection)
    signals.set('pad:velocity', 127)
    assert.equal(modulationOffset(selection, numericSignal(layout, selection, signals)), 0.75)
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout }] }
    assert.equal(isSavedProject(project), true)
  } finally {
    await server.close()
  }
})
