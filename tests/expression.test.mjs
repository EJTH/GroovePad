import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createServer } from 'vite'

class Element {
  constructor(note) { this.dataset = { note: String(note) }; this.parentElement = { contains: () => true } }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 } }
  setPointerCapture() {}
  closest() { return this }
}

async function setupComponent(name, props, dependencies, environment = {}) {
  const source = await readFile(new URL(`../src/components/${name}.vue`, import.meta.url), 'utf8')
  const script = compileScript(parse(source).descriptor, { id: name }).content
  const { outputText } = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
  const cleanup = []
  const module = { exports: {} }
  const vueMock = { ...vue, onBeforeUnmount: (callback) => cleanup.push(callback) }
  vm.runInNewContext(outputText, { module, exports: module.exports, HTMLElement: Element,
    require: (path) => path === 'vue' ? vueMock : dependencies[path], ...environment })
  const emitted = []
  const scope = vue.effectScope()
  const api = scope.run(() => module.exports.default.setup(props, {
    emit: (_, output) => emitted.push(output), expose: () => {},
  }))
  return { api, emitted, dispose: () => { cleanup.forEach((callback) => callback()); scope.stop() } }
}

function pointer(id, target, type, pressure, x, y) {
  return { pointerId: id, currentTarget: target, pointerType: type, pressure, clientX: x, clientY: y,
    button: 0, preventDefault() {} }
}

test('pad and polyphonic piano emit attack velocity and live pressure through release', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const expression = await server.ssrLoadModule('/src/expression.ts')
    const music = await server.ssrLoadModule('/src/music.ts')
    const dependencies = { '../expression': expression, '../music': music }
    const first = new Element(48)
    const second = new Element(50)
    let underPointer = first
    const pad = await setupComponent('MPCPad', { label: 'Pad', settings: { color: '#ffffff' } }, dependencies)
    pad.api.press(pointer(1, first, 'mouse', 0.5, 0, 25))
    pad.api.move(pointer(1, first, 'mouse', 0.5, 0, 75))
    pad.api.release(pointer(1, first, 'mouse', 0, 0, 75))
    assert.deepEqual(pad.emitted.map(({ parameter, value }) => [parameter, value]),
      [['velocity', 32], ['pressure', 32], ['gate', 1], ['pressure', 95], ['pressure', 0], ['gate', 0]])
    pad.dispose()

    const piano = await setupComponent('PianoRoll', { label: 'Piano', settings: vue.reactive({
      scale: 'chromatic', transpose: 0, octaves: 1, orientation: 'horizontal', color: '#ffffff',
    }) }, dependencies, { document: { elementFromPoint: () => underPointer } })
    piano.api.down(pointer(1, first, 'pen', 0.2, 0, 10), 48)
    piano.api.down(pointer(2, second, 'mouse', 0.5, 0, 80), 50)
    underPointer = first
    piano.api.move(pointer(1, first, 'pen', 0.5, 0, 10))
    piano.api.up(pointer(1, first, 'pen', 0, 0, 10))
    piano.api.up(pointer(2, second, 'mouse', 0, 0, 80))
    assert.deepEqual(piano.emitted.filter((event) => event.parameter === 'pressure').map((event) => event.value),
      [25, 102, 64, 102, 0])
    assert.deepEqual(piano.emitted.filter((event) => event.parameter === 'velocity').map((event) => event.value), [25, 102])
    assert.deepEqual(piano.emitted.filter((event) => event.parameter === 'note' && event.on).map((event) => event.velocity), [25, 102])
    piano.emitted.length = 0
    piano.api.down(pointer(3, first, 'touch', 0.5, 0, 20), 48)
    underPointer = second
    piano.api.move(pointer(3, first, 'touch', 0.5, 0, 70))
    piano.api.up(pointer(3, first, 'touch', 0, 0, 70))
    assert.deepEqual(piano.emitted.filter((event) => event.parameter === 'note').map(({ value, on, velocity }) => [value, on, velocity]),
      [[48, true, 25], [48, false, 100], [50, true, 89], [50, false, 100]])
    piano.emitted.length = 0
    piano.api.keyDown({ key: ' ', repeat: false, preventDefault() {} }, 48)
    piano.api.keyUp({ key: ' ', preventDefault() {} }, 48)
    assert.deepEqual(piano.emitted.filter((event) => event.parameter === 'pressure').map((event) => event.value), [100, 0])
    piano.dispose()
  } finally {
    await server.close()
  }
})

test('expression outputs are wireable and drive numeric modulation', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { outputs, isCompatible } = await server.ssrLoadModule('/src/parameters.ts')
    const { effectiveControls } = await server.ssrLoadModule('/src/modulation.ts')
    for (const type of ['pad', 'instrument-pad', 'piano-roll', 'arpeggiator']) {
      const source = createControl(type, 0, 0, type)
      const target = createControl('target', 1, 0, 'lfo')
      assert.equal(isCompatible(source, 'velocity', target, 'depth'), true)
      assert.equal(outputs(source).some((output) => output.id === 'pressure'), type !== 'arpeggiator')
      const parameter = type === 'arpeggiator' ? 'velocity' : 'pressure'
      const layout = { columns: 2, rows: 1, items: [source, target],
        connections: [{ id: 'wire', sourceId: source.id, sourceParameter: parameter, targetId: target.id, targetParameter: 'depth' }] }
      assert.equal(effectiveControls(layout, new Map([[`${source.id}:${parameter}`, 127]]))[1].settings.depth, 1)
      assert.equal(effectiveControls(layout, new Map([[`${source.id}:${parameter}`, 0]]))[1].settings.depth, 0)
      target.settings.depth = 0.5
      layout.connections[0].modulationAmount = -50
      assert.equal(effectiveControls(layout, new Map([[`${source.id}:${parameter}`, 127]]))[1].settings.depth, 0)
      layout.connections[0].modulationAmount = 50
      assert.equal(effectiveControls(layout, new Map([[`${source.id}:${parameter}`, 127]]))[1].settings.depth, 1)
      assert.equal(target.settings.depth, 0.5)
    }
  } finally {
    await server.close()
  }
})

test('arpeggiator emits the outgoing note velocity when playing and bypassed', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const music = await server.ssrLoadModule('/src/music.ts')
    const props = vue.reactive({ label: 'Arp', bpm: 120, notes: [{ note: 60, count: 1, velocity: 47 }],
      settings: { enabled: true, rate: '1/8', style: 'up', steps: 1, distance: 0, scale: 'chromatic', gate: 0.5 } })
    const arp = await setupComponent('Arpeggiator', props, { '../music': music },
      { window: { setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {} } })
    assert.equal(arp.emitted.find((event) => event.parameter === 'velocity').value, 47)
    assert.equal(arp.emitted.find((event) => event.parameter === 'note' && event.on).velocity, 47)
    arp.emitted.length = 0
    props.settings.enabled = false
    assert.equal(arp.emitted.find((event) => event.parameter === 'velocity').value, 47)
    assert.equal(arp.emitted.find((event) => event.parameter === 'note' && event.on).velocity, 47)
    arp.dispose()
  } finally {
    await server.close()
  }
})
