import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

test('output selectors validate and route the original numeric signal through chained selectors', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { effectiveControls } = await server.ssrLoadModule('/src/modulation.ts')
    const { selectorConnectionsCompatible } = await server.ssrLoadModule('/src/parameters.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const knob = createControl('knob', 0, 0, 'knob')
    knob.settings.value = -10
    knob.settings.min = -127
    const selector = createControl('selector', 1, 0, 'output-selector')
    const chain = createControl('chain', 2, 0, 'output-selector')
    const first = createControl('first', 3, 0, 'lfo')
    const second = createControl('second', 4, 0, 'lfo')
    const piano = createControl('piano', 5, 0, 'piano-roll')
    const wire = (id, sourceId, sourceParameter, targetId, targetParameter) =>
      ({ id, sourceId, sourceParameter, targetId, targetParameter })
    const incoming = wire('in', 'knob', 'value', 'selector', 'value')
    const toFirst = wire('first', 'selector', 'value', 'first', 'offset')
    const toChain = wire('chain', 'selector', 'value', 'chain', 'value')
    const toSecond = wire('second', 'chain', 'value', 'second', 'offset')
    const layout = { columns: 6, rows: 1, items: [knob, selector, chain, first, second, piano],
      connections: [incoming, toFirst, toChain, toSecond] }
    const project = { version: 1, bpm: 120, selectedBankId: 'A',
      banks: [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout }] }
    assert.equal(isSavedProject(project), true)
    const values = () => effectiveControls(layout, new Map()).filter((item) => item.type === 'lfo').map((item) => item.settings.offset)
    assert.deepEqual(values(), [-1, 0])
    selector.settings.index = 1
    assert.deepEqual(values(), [0, -1])
    selector.settings.index = 2
    assert.deepEqual(values(), [-1, 0])
    assert.equal(selectorConnectionsCompatible(layout.items, layout.connections,
      wire('extra', 'piano', 'note', 'selector', 'note')), false)
    assert.equal(selectorConnectionsCompatible(layout.items, layout.connections,
      wire('mixed', 'selector', 'note', 'piano', 'scale')), false)
    layout.connections.push(wire('extra', 'knob', 'value', 'selector', 'value'))
    assert.equal(isSavedProject(project), false)
  } finally {
    await server.close()
  }
})
