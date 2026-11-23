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

test('ABS sets the destination range while MOD adjusts the base and switching clamps negatives', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { connectionMappingMode, effectiveControls, mappingEndpoint, setConnectionMappingMode, setMappingEndpoint } = await server.ssrLoadModule('/src/modulation.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const pad = createControl('pad', 0, 0, 'pad')
    const target = createControl('target', 1, 0, 'lfo')
    target.settings.offset = 0.4
    const wire = { id: 'wire', sourceId: 'pad', sourceParameter: 'pressure', targetId: 'target', targetParameter: 'offset' }
    const layout = { columns: 2, rows: 1, items: [pad, target], connections: [wire] }
    const signals = new Map([['pad:pressure', 0]])
    const value = () => effectiveControls(layout, signals)[1].settings.offset
    assert.equal(connectionMappingMode(layout, wire), 'abs')
    setConnectionMappingMode(layout, wire, 'mod')
    wire.modulationMin = -20
    wire.modulationMax = 20
    assert.ok(Math.abs(value()) < 1e-10)
    signals.set('pad:pressure', 127)
    assert.equal(value(), 0.8)
    setConnectionMappingMode(layout, wire, 'abs')
    assert.equal(wire.absoluteMin, -1)
    assert.equal(wire.absoluteMax, -0.6)
    assert.equal(value(), -0.6)
    signals.set('pad:pressure', 0)
    assert.equal(value(), -1)
    wire.absoluteMin = 0.6
    wire.absoluteMax = -0.6
    assert.ok(Math.abs(value() - 0.6) < 1e-10)
    signals.set('pad:pressure', 127)
    assert.equal(value(), -0.6)
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout }] }
    assert.equal(isSavedProject(JSON.parse(JSON.stringify(project))), true)
    wire.absoluteMin = NaN
    assert.equal(isSavedProject(project), false)
    wire.absoluteMin = 0.6
    wire.modulationMin = 10
    assert.equal(isSavedProject(project), false)
    delete wire.absoluteMin
    delete wire.absoluteMax
    delete wire.mappingMode
    delete wire.modulationMin
    delete wire.modulationMax
    wire.modulationAmount = -30
    assert.equal(mappingEndpoint(layout, wire, 'max'), -30)
    setConnectionMappingMode(layout, wire, 'abs')
    assert.equal(wire.absoluteMax, -1)
    assert.equal(wire.modulationAmount, undefined)
    assert.equal(isSavedProject(project), true)

    setMappingEndpoint(layout, wire, 'min', -0.75)
    setMappingEndpoint(layout, wire, 'max', -0.75)
    signals.set('pad:pressure', 63.5)
    assert.equal(value(), -0.75)
    setMappingEndpoint(layout, wire, 'min', undefined)
    signals.set('pad:pressure', 0)
    assert.equal(value(), -1)
    target.settings.offset = 0.4
    wire.absoluteMax = 2
    signals.set('pad:pressure', 127)
    assert.equal(value(), 1)

    delete wire.absoluteMin
    delete wire.absoluteMax
    wire.modulationMin = 25
    wire.modulationMax = 75
    assert.equal(isSavedProject(project), true)
    assert.equal(mappingEndpoint(layout, wire, 'min'), -0.5)
    assert.equal(value(), 0.5)
    setMappingEndpoint(layout, wire, 'max', 0.25)
    assert.equal(wire.absoluteMin, -0.5)
    assert.equal(wire.absoluteMax, 0.25)
    assert.equal(wire.modulationMin, undefined)
    assert.equal(wire.modulationMax, undefined)
    assert.equal(value(), 0.25)
    setConnectionMappingMode(layout, wire, 'mod')
    assert.equal(wire.modulationMin, 25)
    assert.equal(wire.modulationMax, 62.5)
    assert.equal(isSavedProject(project), true)
  } finally {
    await server.close()
  }
})

test('selector MOD adds to its incoming signal while ABS replaces it', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { effectiveControls, selectorNumericValue, numericSignal } = await server.ssrLoadModule('/src/modulation.ts')
    const pad = createControl('pad', 0, 0, 'pad')
    const selector = createControl('selector', 1, 0, 'output-selector')
    const target = createControl('target', 2, 0, 'lfo')
    const incoming = { id: 'in', sourceId: 'pad', sourceParameter: 'pressure', targetId: 'selector', targetParameter: 'value',
      mappingMode: 'mod', modulationMin: 10, modulationMax: 10 }
    const outgoing = { id: 'out', sourceId: 'selector', sourceParameter: 'value', targetId: 'target', targetParameter: 'depth' }
    const layout = { columns: 3, rows: 1, items: [pad, selector, target], connections: [incoming, outgoing] }
    const signals = new Map([['pad:pressure', 63.5]])
    assert.ok(Math.abs(effectiveControls(layout, signals)[2].settings.depth - 0.6) < 1e-10)
    incoming.mappingMode = 'abs'
    assert.ok(Math.abs(effectiveControls(layout, signals)[2].settings.depth - 0.1) < 1e-10)
    delete incoming.modulationMin
    delete incoming.modulationMax
    incoming.absoluteMin = 20
    incoming.absoluteMax = 80
    assert.ok(Math.abs(effectiveControls(layout, signals)[2].settings.depth - 50 / 127) < 1e-10)
    signals.set('pad:pressure', 127)
    assert.ok(Math.abs(effectiveControls(layout, signals)[2].settings.depth - 80 / 127) < 1e-10)
    incoming.modulationMin = 10
    incoming.modulationMax = 10
    delete incoming.absoluteMin
    delete incoming.absoluteMax
    signals.set('pad:pressure', 63.5)
    const selection = { ...incoming, targetParameter: 'selection', mappingMode: 'mod' }
    const signal = numericSignal(layout, selection, signals)
    assert.ok(Math.abs(selectorNumericValue(selection, signal, 32) - 44.7) < 1e-10)
    selection.mappingMode = 'abs'
    assert.ok(Math.abs(selectorNumericValue(selection, signal, 32) - 12.7) < 1e-10)
  } finally {
    await server.close()
  }
})

test('ABS saved values survive destination range changes and legacy mappings convert when switched', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { effectiveControls, mappingEndpoint, setConnectionMappingMode } = await server.ssrLoadModule('/src/modulation.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const pad = createControl('pad', 0, 0, 'pad')
    const knob = createControl('knob', 1, 0, 'knob')
    knob.settings.max = 100
    knob.settings.defaultValue = 40
    knob.settings.value = 40
    const wire = { id: 'wire', sourceId: 'pad', sourceParameter: 'pressure', targetId: 'knob',
      targetParameter: 'value', mappingMode: 'abs', absoluteMin: 25, absoluteMax: 80 }
    const layout = { columns: 2, rows: 1, items: [pad, knob], connections: [wire] }
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout }] }
    const signals = new Map([['pad:pressure', 127]])
    const value = () => effectiveControls(layout, signals)[1].settings.value
    assert.equal(value(), 80)
    knob.settings.max = 50
    assert.equal(isSavedProject(project), true)
    assert.equal(value(), 50)
    signals.set('pad:pressure', 0)
    assert.equal(value(), 25)

    delete wire.absoluteMin
    delete wire.absoluteMax
    wire.modulationMin = 20
    wire.modulationMax = 80
    assert.equal(isSavedProject(JSON.parse(JSON.stringify(project))), true)
    assert.equal(mappingEndpoint(layout, wire, 'min'), 10)
    assert.equal(value(), 10)
    setConnectionMappingMode(layout, wire, 'mod')
    assert.equal(wire.modulationMin, 20)
    assert.equal(wire.modulationMax, 80)
    assert.equal(isSavedProject(project), true)
  } finally {
    await server.close()
  }
})
