import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createServer } from 'vite'

test('LFO modulation preserves nested grids and still updates its targets', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { effectiveControls } = await server.ssrLoadModule('/src/modulation.ts')
    const lfo = createControl('lfo', 0, 0, 'lfo')
    const target = createControl('target', 1, 0, 'lfo')
    const subgrid = createControl('sub', 2, 0, 'sub-grid')
    subgrid.settings.layout.items.push(createControl('child', 0, 0, 'knob'))
    const layout = { columns: 3, rows: 1, items: [lfo, target, subgrid], connections: [
      { id: 'wire', sourceId: 'lfo', sourceParameter: 'value', targetId: 'target', targetParameter: 'depth' },
    ] }
    for (const [signal, depth] of [[-1, 0], [1, 1]]) {
      const controls = effectiveControls(layout, new Map([['lfo:value', signal]]))
      assert.equal(controls[1].settings.depth, depth)
      assert.equal(controls[2].settings.layout, subgrid.settings.layout)
      assert.equal(controls[2].settings.layout.items[0].id, 'child')
    }
    assert.equal(target.settings.depth, 1)
  } finally { await server.close() }
})

test('audio graph refreshes only for relevant signal changes', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  const scope = vue.effectScope()
  try {
    const modules = {}
    for (const [key, path] of [
      ['../grid', '/src/grid.ts'], ['../parameters', '/src/parameters.ts'],
      ['../modulation', '/src/modulation.ts'], ['../sequencedLoop', '/src/sequencedLoop.ts'],
      ['../audio/audioRoutes', '/src/audio/audioRoutes.ts'], ['../audio/toneOscillator', '/src/audio/toneOscillator.ts'],
      ['../music', '/src/music.ts'],
    ]) modules[key] = await server.ssrLoadModule(path)
    const { createControl } = modules['../grid']
    const { effectiveControls } = modules['../modulation']
    const lfo = createControl('lfo', 0, 0, 'lfo')
    const tone = createControl('tone', 1, 0, 'tone-element')
    tone.settings.elementType = 'filter'
    const props = vue.reactive({ layout: { columns: 2, rows: 1, items: [lfo, tone], connections: [] },
      editing: false, wiring: false, settingsOpen: false, bpm: 120 })
    const updates = []
    let beforeMount
    const vueMock = { ...vue, onBeforeMount: (callback) => { beforeMount = callback },
      onMounted: () => {}, onBeforeUnmount: () => {}, onUnmounted: () => {} }
    modules['../audio/bankAudio'] = { BankAudio: class {
      update(layout, boundary, options) { updates.push(options); return false }
      isModulationDriven() { return false }
      dispose() {}
    } }
    modules['./useGridInteraction'] = { useGridInteraction: () => ({
      interaction: vue.ref(null), dropAction: vue.ref(null),
    }) }
    modules['./useGridPlayback'] = { useGridPlayback: (options) => {
      const effectiveSignals = vue.computed(() => new Map(options.signals))
      const displayItems = vue.computed(() => effectiveControls(options.modulationLayout(), effectiveSignals.value))
      const automationItems = vue.computed(() => options.layout().items)
      return { effectiveSignals, automationItems, displayItems, displayedAutomation: () => undefined,
        liveControls: new Set(), loopPlayheads: vue.ref(new Map()),
        loopEditorPlayheads: vue.ref(new Map()) }
    } }
    const source = await readFile(new URL('../src/components/GrooveGrid.vue', import.meta.url), 'utf8')
    const script = compileScript(parse(source).descriptor, { id: 'grid' }).content
    const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const module = { exports: {} }
    vm.runInNewContext(code, { module, exports: module.exports, console, clearTimeout, setTimeout,
      require: (path) => path === 'vue' ? vueMock : modules[path] ?? { default: {} } })
    const api = scope.run(() => module.exports.default.setup(props, { emit() {}, expose() {} }))
    beforeMount()
    assert.equal(updates.length, 1)

    api.handleOutput(props.layout.items[0], { parameter: 'value', value: 0.25 })
    await vue.nextTick()
    assert.equal(updates.length, 1)
    props.bpm = 90
    await vue.nextTick()
    assert.equal(updates.length, 2)
    assert.equal(updates.at(-1).bpm, 90)

    props.layout.connections.push({ id: 'wire', sourceId: 'lfo', sourceParameter: 'value', targetId: 'tone', targetParameter: 'cutoff' })
    await vue.nextTick()
    const previous = updates.length
    api.handleOutput(props.layout.items[0], { parameter: 'value', value: 0.75 })
    await vue.nextTick()
    assert.ok(updates.length > previous)
    assert.ok(updates.at(-1).toneSettings.get('tone').cutoff > tone.settings.cutoff)
  } finally {
    scope.stop()
    await server.close()
  }
})
