import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import { createServer } from 'vite'

test('selector MOD uses the user-selected baseline without accumulating on updates', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments', 'sequencedLoop']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    dependencies['./useGridInteraction'] = await server.ssrLoadModule('/src/components/useGridInteraction.ts')
    const { createControl } = dependencies['../grid']
    const pad = createControl('pad', 0, 0, 'pad')
    const selector = createControl('selector', 1, 0, 'output-selector')
    selector.settings.index = 1
    const targets = Array.from({ length: 4 }, (_, i) => createControl(`lfo-${i}`, i + 2, 0, 'lfo'))
    const input = { id: 'selection', sourceId: 'pad', sourceParameter: 'pressure', targetId: 'selector',
      targetParameter: 'selection', mappingMode: 'mod', modulationMin: 25, modulationMax: 25 }
    const outgoing = targets.map((target, i) => ({ id: `out-${i}`, sourceId: 'selector', sourceParameter: 'value',
      targetId: target.id, targetParameter: 'depth' }))
    const layout = vue.reactive({ columns: 6, rows: 1, items: [pad, selector, ...targets], connections: [input, ...outgoing] })
    const source = await readFile(new URL('../src/components/GrooveGrid.vue', import.meta.url), 'utf8')
    const script = compileScript(parse(source).descriptor, { id: 'grid' }).content
    const { outputText } = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
    const module = { exports: {} }
    class SelectElement { constructor(value) { this.value = value } }
    vm.runInNewContext(outputText, { module, exports: module.exports, setTimeout, clearTimeout,
      require: (path) => path === 'vue' ? { ...vue, onBeforeUnmount() {} } : path === 'tone' ? {} : dependencies[path] ?? { default: {} } })
    const scope = vue.effectScope()
    const api = scope.run(() => module.exports.default.setup({ layout, editing: false, wiring: false, settingsOpen: false, bpm: 120 },
      { expose() {}, emit() {} }))
    api.handleOutput(layout.items[0], { parameter: 'pressure', value: 0 })
    await vue.nextTick()
    assert.equal(layout.items[1].settings.baseIndex, 1)
    assert.equal(layout.items[1].settings.index, 2)
    api.handleOutput(layout.items[0], { parameter: 'pressure', value: 127 })
    await vue.nextTick()
    assert.equal(layout.items[1].settings.index, 2)
    api.advanceSelector(layout.items[1])
    await vue.nextTick()
    assert.equal(layout.items[1].settings.baseIndex, 3)
    assert.equal(layout.items[1].settings.index, 3)
    layout.connections[0].modulationMin = -25
    layout.connections[0].modulationMax = -25
    await vue.nextTick()
    assert.equal(layout.items[1].settings.index, 2)
    assert.equal(layout.items[1].settings.baseIndex, 3)
    api.handleOutput(layout.items[0], { parameter: 'pressure', value: 0, active: false })
    await vue.nextTick()
    assert.equal(layout.items[1].settings.index, 3)

    dependencies['../modulation'].setConnectionMappingMode(layout, layout.connections[0], 'abs')
    layout.connections[0].absoluteMin = 10
    layout.connections[0].absoluteMax = 120
    api.handleOutput(layout.items[0], { parameter: 'pressure', value: 0 })
    await vue.nextTick()
    assert.equal(layout.items[1].settings.index, 0)
    api.handleOutput(layout.items[0], { parameter: 'pressure', value: 127 })
    await vue.nextTick()
    assert.equal(layout.items[1].settings.index, 3)

    const arp = createControl('arp', 7, 0, 'arpeggiator')
    layout.items.push(arp)
    const choiceWire = { id: 'arp-choice', sourceId: 'pad', sourceParameter: 'pressure',
      targetId: 'arp', targetParameter: 'enabled', mappingMode: 'abs' }
    layout.connections.push(choiceWire)
    const mappingSource = await readFile(new URL('../src/components/ConnectionMapping.vue', import.meta.url), 'utf8')
    const mappingScript = compileScript(parse(mappingSource).descriptor, { id: 'mapping' }).content
    const mappingCode = ts.transpileModule(mappingScript, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const mappingModule = { exports: {} }
    vm.runInNewContext(mappingCode, { module: mappingModule, exports: mappingModule.exports, HTMLSelectElement: SelectElement,
      require: (path) => path === 'vue' ? vue : dependencies[path] })
    const mapping = scope.run(() => mappingModule.exports.default.setup({ layout, connection: choiceWire, label: 'choice' },
      { expose() {}, emit() {} }))
    mapping.setChoiceEndpoint('min', { target: new SelectElement('1') })
    mapping.setChoiceEndpoint('max', { target: new SelectElement('0') })
    assert.equal(mapping.choiceEndpoint('min'), '1')
    assert.equal(mapping.choiceEndpoint('max'), '0')
    api.handleOutput(layout.items[0], { parameter: 'pressure', value: 0 })
    assert.equal(api.displayItems.value.find((item) => item.id === 'arp').settings.enabled, true)
    api.handleOutput(layout.items[0], { parameter: 'pressure', value: 127 })
    assert.equal(api.displayItems.value.find((item) => item.id === 'arp').settings.enabled, false)
    mapping.setChoiceEndpoint('min', { target: new SelectElement('') })
    assert.equal(mapping.choiceEndpoint('min'), '')

    const knob = createControl('knob', 6, 0, 'knob')
    knob.settings.max = 100
    knob.settings.value = 60
    layout.items.push(knob)
    layout.connections.push({ id: 'pressure-knob', sourceId: 'pad', sourceParameter: 'pressure',
      targetId: 'knob', targetParameter: 'value', mappingMode: 'abs' })
    const displayedKnob = () => api.displayItems.value.find((item) => item.id === 'knob')
    api.handleOutput(layout.items[0], { parameter: 'pressure', value: 0, active: true })
    assert.equal(displayedKnob().settings.value, 0)
    api.handleOutput(layout.items[0], { parameter: 'pressure', value: 0, active: false })
    assert.equal(displayedKnob().settings.value, 60)
    api.handleOutput(displayedKnob(), { parameter: 'value', value: 75 })
    assert.equal(displayedKnob().settings.value, 75)
    scope.stop()
  } finally {
    await server.close()
  }
})

test('connection dialog drafts mappings until connect and resets them when ports change', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments', 'sequencedLoop']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    dependencies['./useGridInteraction'] = await server.ssrLoadModule('/src/components/useGridInteraction.ts')
    const { createControl } = dependencies['../grid']
    const knob = createControl('knob', 0, 0, 'knob')
    const lfo = createControl('lfo', 1, 0, 'lfo')
    const selector = createControl('selector', 2, 0, 'output-selector')
    selector.settings.index = 2
    const piano = createControl('piano', 3, 0, 'piano-roll')
    const pad = createControl('pad', 4, 0, 'pad')
    const layout = vue.reactive({ columns: 5, rows: 1, items: [knob, lfo, selector, piano, pad], connections: [] })
    const compile = async (filename) => {
      const source = await readFile(new URL(`../src/components/${filename}.vue`, import.meta.url), 'utf8')
      return ts.transpileModule(compileScript(parse(source).descriptor, { id: filename }).content,
        { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    }
    const gridModule = { exports: {} }
    vm.runInNewContext(await compile('GrooveGrid'), { module: gridModule, exports: gridModule.exports, setTimeout, clearTimeout,
      require: (path) => path === 'vue' ? { ...vue, onBeforeUnmount() {} } : path === 'tone' ? {} : dependencies[path] ?? { default: {} } })
    const scope = vue.effectScope()
    const api = scope.run(() => gridModule.exports.default.setup({ layout, editing: false, wiring: true, settingsOpen: false, bpm: 120 },
      { expose() {}, emit() {} }))

    api.selectWirePair('knob', 'lfo')
    api.wireOutput.value = 'value'
    api.wireInput.value = 'offset'
    assert.equal(api.canSetModulationAmount(api.wireDraft.value), true)
    dependencies['../modulation'].setMappingEndpoint(layout, api.wireDraft.value, 'min', -25, false)
    api.wireInput.value = 'depth'
    assert.equal(api.wireDraft.value.modulationMin, undefined)
    api.wireInput.value = 'offset'

    class InputElement {
      constructor(value) { this.value = String(value); this.valueAsNumber = value; this.validity = { valid: true } }
    }
    const mappingModule = { exports: {} }
    vm.runInNewContext(await compile('ConnectionMapping'), {
      module: mappingModule, exports: mappingModule.exports, HTMLInputElement: InputElement,
      require: (path) => path === 'vue' ? vue : dependencies[path],
    })
    const edit = (connection) => scope.run(() => mappingModule.exports.default.setup(
      { layout, connection, label: 'draft', draft: true }, { expose() {}, emit() {} }))
    const mapping = edit(api.wireDraft.value)
    mapping.toggleMode()
    mapping.setEndpoint('min', { target: new InputElement(-0.5) })
    mapping.setEndpoint('max', { target: new InputElement(0.5) })
    assert.equal(layout.connections.length, 0)
    api.connectWire()
    assert.equal(layout.connections.length, 1)
    assert.equal(layout.connections[0].mappingMode, 'abs')
    assert.equal(layout.connections[0].absoluteMin, -0.5)
    assert.equal(layout.connections[0].absoluteMax, 0.5)
    assert.equal(dependencies['../modulation'].effectiveControls(layout, new Map())[1].settings.offset, 0.003937007874015741)

    api.selectWirePair('knob', 'selector')
    api.wireOutput.value = 'value'
    api.wireInput.value = 'selection'
    edit(api.wireDraft.value).toggleMode()
    assert.equal(selector.settings.baseIndex, undefined)
    api.wirePair.value = null
    assert.equal(layout.connections.length, 1)
    assert.equal(selector.settings.baseIndex, undefined)
    api.selectWirePair('knob', 'selector')
    api.wireOutput.value = 'value'
    api.wireInput.value = 'selection'
    edit(api.wireDraft.value).toggleMode()
    api.connectWire()
    assert.equal(selector.settings.baseIndex, 2)

    api.selectWirePair('piano', 'pad')
    assert.equal(layout.connections.at(-1).sourceParameter, 'note')
    assert.equal(layout.connections.at(-1).mappingMode, undefined)
    assert.equal(api.wirePair.value, null)

    layout.items.push(createControl('knob2', 5, 0, 'knob'))
    api.selectWirePair('knob', 'knob2')
    assert.equal(api.wirePair.value.targetId, 'knob2')
    assert.equal(api.wireDraft.value.targetParameter, 'value')
    assert.equal(api.canSetModulationAmount(api.wireDraft.value), true)
    assert.equal(layout.connections.length, 3)
    scope.stop()
  } finally {
    await server.close()
  }
})

test('mapping editor renders numeric and selectable ABS endpoints', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: Mapping } = await server.ssrLoadModule('/src/components/ConnectionMapping.vue')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const pad = createControl('pad', 0, 0, 'pad')
    const lfo = createControl('lfo', 1, 0, 'lfo')
    const layout = { columns: 2, rows: 1, items: [pad, lfo], connections: [] }
    const connection = { id: '', sourceId: 'pad', sourceParameter: 'pressure', targetId: 'lfo', targetParameter: 'offset', mappingMode: 'abs' }
    const render = () => renderToString(vue.createSSRApp({ render: () => vue.h(Mapping, { layout, connection, label: 'wire', draft: true }) }))
    let html = await render()
    assert.match(html, /min="-1" max="1"/)
    assert.equal((html.match(/type="number"/g) ?? []).length, 2)
    connection.targetParameter = 'waveform'
    html = await render()
    assert.equal((html.match(/<select/g) ?? []).length, 2)
    assert.match(html, />sine<\/option>/)
    assert.match(html, />square<\/option>/)
  } finally {
    await server.close()
  }
})
