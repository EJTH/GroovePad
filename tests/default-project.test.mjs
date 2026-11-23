import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

test('default project places both drum kits and wires the bassline bank', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createDefaultProject } = await server.ssrLoadModule('/src/defaultProject.ts')
    const { effectiveControls } = await server.ssrLoadModule('/src/modulation.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const banks = createDefaultProject()
    const [beat, bassline] = banks

    assert.deepEqual(banks.map((bank) => bank.title), ['Beat', 'Bassline'])
    assert.equal(isSavedProject({
      version: 1, bpm: 120, selectedBankId: 'B', banks,
    }), true)

    const drums = beat.layout.items.filter((item) => item.type === 'instrument-pad')
    assert.equal(drums.filter((item) => item.settings.instrumentType === '808').length, 6)
    assert.equal(drums.filter((item) => item.settings.instrumentType === '909').length, 6)
    assert.ok(drums.filter((item) => item.settings.instrumentType === '909').every((item) => item.y >= 2))
    assert.ok(!beat.layout.items.some((item) => item.label === 'Bass 303'))
    assert.ok(beat.layout.items.some((item) => item.type === 'sequenced-loop' && item.settings.clips[1]))

    const piano = bassline.layout.items.find((item) => item.type === 'piano-roll')
    assert.deepEqual(
      [piano.x, piano.y, piano.width, piano.height, piano.settings.numRows, piano.settings.style, piano.settings.orientation],
      [0, 2, 4, 2, 2, 'pads', 'horizontal'],
    )
    const connections = bassline.layout.connections
    assert.ok(connections.some((wire) => wire.sourceId === piano.id && wire.targetId === 'control-3' && wire.targetParameter === 'note'))
    assert.ok(connections.some((wire) => wire.sourceId === 'control-3' && wire.targetId === 'bass-303' && wire.targetParameter === 'note'))
    assert.ok(connections.some((wire) => wire.sourceId === 'control-2' && wire.targetId === 'control-1' && wire.targetParameter === 'value'))
    assert.ok(connections.some((wire) => wire.sourceId === 'control-1' && wire.targetId === 'bass-303' && wire.targetParameter === 'filterFrequency'))
    assert.ok(connections.some((wire) => wire.sourceId === 'resonance-knob' && wire.targetId === 'bass-303' && wire.targetParameter === 'resonance'))

    const resolved = effectiveControls(bassline.layout, new Map([
      ['control-1:value', 500],
      ['control-2:value', 1],
      ['resonance-knob:value', 11.8],
    ]))
    const bass = resolved.find((item) => item.id === 'bass-303')
    assert.ok(bass.settings.instrumentParams.filterFrequency > 2500)
    assert.ok(Math.abs(bass.settings.instrumentParams.resonance - 11.8) < 0.001)
  } finally {
    await server.close()
  }
})
