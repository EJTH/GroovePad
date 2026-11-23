import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createServer } from 'vite'

test('default project loads the bundled ZIP template', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  const originalFetch = globalThis.fetch
  try {
    const { loadDefaultProject } = await server.ssrLoadModule('/src/defaultProject.ts')
    const { effectiveControls } = await server.ssrLoadModule('/src/modulation.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    globalThis.fetch = async () => new Response(await readFile(new URL('../templates/default.zip', import.meta.url)))
    const project = await loadDefaultProject()
    const banks = project.banks
    const [beat, bassline] = banks

    assert.deepEqual(banks.map((bank) => bank.title), ['Beat', 'Bassline'])
    assert.equal(isSavedProject({
      version: project.version, bpm: project.bpm, selectedBankId: project.selectedBankId, banks,
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
    globalThis.fetch = originalFetch
    await server.close()
  }
})
