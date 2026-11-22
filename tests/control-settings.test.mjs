import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createServer } from 'vite'

test('control summaries start collapsed and show each control name, size and color', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: ControlIdentitySettings } = await server.ssrLoadModule('/src/components/ControlIdentitySettings.vue')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    for (const type of ['pad', 'instrument-pad', 'knob', 'lfo', 'mod-wheel', 'piano-roll', 'arpeggiator', 'output-selector']) {
      const draft = createControl(type, 0, 0, type)
      draft.label = 'My control'
      draft.width = 2
      draft.height = 3
      const html = await renderToString(createSSRApp({ render: () => h(ControlIdentitySettings, {
        draft, columns: 4, rows: 4, controlTypes: [{ type, label: type }],
      }) }))
      assert.match(html, /<details(?![^>]*\sopen(?:[=>\s]))/)
      assert.match(html, /<summary[^>]*>[\s\S]*My control[\s\S]*2 × 3[\s\S]*<\/summary>/)
      assert.match(html, 'color' in draft.settings ? /background-color:#[\da-f]{6}/i : /no-color/)
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
    assert.equal((choices.match(/<button/g) ?? []).length, 4)
    assert.equal((choices.match(/<svg/g) ?? []).length, 4)
    assert.equal((choices.match(/aria-pressed="true"/g) ?? []).length, 1)
    assert.match(choices, /aria-pressed="true"[^>]*>[\s\S]*?303 Bass Synth/)
    assert.doesNotMatch(choices, /<select/)
  } finally {
    await server.close()
  }
})
