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
  getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 } }
  setPointerCapture() {}
  closest() { return this }
  contains() { return true }
}

async function setupComponent(name, props, dependencies, environment = {}) {
  if (name === 'GrooveGrid' && !dependencies['../sequencedLoop']) {
    const source = await readFile(new URL('../src/sequencedLoop.ts', import.meta.url), 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const loopModule = { exports: {} }
    vm.runInNewContext(code, { module: loopModule, exports: loopModule.exports, performance })
    dependencies['../sequencedLoop'] = loopModule.exports
  }
  if (!dependencies['../pointerTap']) {
    const source = await readFile(new URL('../src/pointerTap.ts', import.meta.url), 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const tapModule = { exports: {} }
    vm.runInNewContext(code, { module: tapModule, exports: tapModule.exports, HTMLElement: Element })
    dependencies['../pointerTap'] = tapModule.exports
  }
  if (name === 'GrooveGrid' && !dependencies['./useGridInteraction']) {
    const source = await readFile(new URL('../src/components/useGridInteraction.ts', import.meta.url), 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const interactionModule = { exports: {} }
    vm.runInNewContext(code, { module: interactionModule, exports: interactionModule.exports, HTMLElement: Element, ...environment,
      require: (path) => path === 'vue' ? vue : dependencies[path] })
    dependencies['./useGridInteraction'] = interactionModule.exports
  }
  const source = await readFile(new URL(`../src/components/${name}.vue`, import.meta.url), 'utf8')
  const script = compileScript(parse(source).descriptor, { id: name }).content
  const { outputText } = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
  const cleanup = []
  const module = { exports: {} }
  const vueMock = { ...vue, onMounted: () => {}, onBeforeUnmount: (callback) => cleanup.push(callback) }
  vm.runInNewContext(outputText, { module, exports: module.exports, HTMLElement: Element,
    require: (path) => path === 'vue' ? vueMock : dependencies[path] ?? { default: {} }, ...environment })
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
    assert.deepEqual(pad.emitted.map(({ parameter, value }) => [parameter, value]),
      [['velocity', 32], ['pressure', 32], ['gate', 1]])
    pad.api.move(pointer(1, first, 'mouse', 0.5, 0, 75))
    pad.api.release(pointer(1, first, 'mouse', 0, 0, 75))
    assert.deepEqual(pad.emitted.map(({ parameter, value }) => [parameter, value]),
      [['velocity', 32], ['pressure', 32], ['gate', 1], ['pressure', 95], ['pressure', 0], ['gate', 0]])
    assert.equal(pad.emitted.at(-2).active, false)
    pad.dispose()

    const piano = await setupComponent('PianoRoll', { label: 'Piano', settings: vue.reactive({
      scale: 'chromatic', rootNote: 'C', octaveTranspose: 0, octaves: 1, orientation: 'horizontal', color: '#ffffff',
    }) }, dependencies, { document: { elementFromPoint: () => underPointer } })
    piano.api.down(pointer(1, first, 'pen', 0.2, 0, 10), 48)
    piano.api.down(pointer(2, second, 'mouse', 0.5, 0, 80), 50)
    underPointer = first
    piano.api.move(pointer(1, first, 'pen', 0.5, 0, 10))
    piano.api.up(pointer(1, first, 'pen', 0, 0, 10))
    piano.api.up(pointer(2, second, 'mouse', 0, 0, 80))
    assert.deepEqual(piano.emitted.filter((event) => event.parameter === 'pressure').map((event) => event.value),
      [25, 64, 83, 102, 0])
    assert.deepEqual(piano.emitted.filter((event) => event.parameter === 'pressure').map((event) => event.active),
      [true, true, true, true, false])
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
    piano.emitted.length = 0
    piano.api.down(pointer(4, first, 'mouse', 0.5, 0, 0), 48)
    piano.api.down(pointer(5, second, 'mouse', 0.5, 0, 100), 50)
    piano.api.keyDown({ key: ' ', repeat: false, preventDefault() {} }, 52)
    piano.api.up(pointer(5, second, 'mouse', 0, 0, 100))
    piano.api.keyUp({ key: ' ', preventDefault() {} }, 52)
    piano.api.up(pointer(4, first, 'mouse', 0, 0, 0))
    assert.deepEqual(piano.emitted.filter((event) => event.parameter === 'pressure').map((event) => event.value),
      [0, 64, 76, 50, 0, 0])
    assert.equal(piano.emitted.at(-1).active, false)
    piano.dispose()
  } finally {
    await server.close()
  }
})

test('piano keeps three nearby touch contacts and duplicate notes independent', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const expression = await server.ssrLoadModule('/src/expression.ts')
    const music = await server.ssrLoadModule('/src/music.ts')
    const piano = await setupComponent('PianoRoll', { label: 'Piano', settings: {
      scale: 'chromatic', rootNote: 'C', octaveTranspose: 0, octaves: 1, numRows: 1,
      style: 'pads', orientation: 'horizontal', color: '#ffffff', pressureMode: 'position',
    } }, { '../expression': expression, '../music': music })
    const keys = [new Element(48), new Element(49), new Element(50)]
    for (let i = 0; i < 3; i++) {
      const event = pointer(i + 1, keys[i], 'touch', 0.5, 10 + i, 50)
      if (i > 0) event.button = -1
      piano.api.down(event, 48 + i)
    }
    piano.api.down(pointer(4, keys[1], 'touch', 0.5, 12, 50), 49)
    assert.deepEqual(piano.emitted.filter((event) => event.parameter === 'note' && event.on).map((event) => event.value),
      [48, 49, 50, 49])
    piano.api.up(pointer(2, keys[1], 'touch', 0, 11, 50))
    assert.equal(piano.api.pointers.size, 3)
    piano.api.up(pointer(4, keys[1], 'touch', 0, 12, 50))
    piano.api.up(pointer(1, keys[0], 'touch', 0, 10, 50))
    piano.api.up(pointer(3, keys[2], 'touch', 0, 12, 50))
    assert.deepEqual(piano.emitted.filter((event) => event.parameter === 'note' && event.on === false).map((event) => event.value),
      [49, 49, 48, 50])
    piano.dispose()
  } finally {
    await server.close()
  }
})

test('piano glide strip slides between rows and releases held notes on layout changes', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const expression = await server.ssrLoadModule('/src/expression.ts')
    const music = await server.ssrLoadModule('/src/music.ts')
    const first = new Element(48)
    const second = new Element(54)
    let underPointer = first
    const settings = vue.reactive({ scale: 'chromatic', rootNote: 'C', octaveTranspose: 0, octaves: 1, numRows: 2,
      style: 'glide-strip', orientation: 'horizontal', color: '#ffffff' })
    const piano = await setupComponent('PianoRoll', { label: 'Piano', settings },
      { '../expression': expression, '../music': music }, { document: { elementFromPoint: () => underPointer } })
    piano.api.down(pointer(1, first, 'touch', 0.5, 0, 20), 48)
    underPointer = second
    piano.api.move(pointer(1, first, 'touch', 0.5, 0, 70))
    settings.style = 'pads'
    assert.deepEqual(piano.emitted.filter((event) => event.parameter === 'note').map(({ value, on, velocity }) => [value, on, velocity]),
      [[48, true, 25], [48, false, 100], [54, true, 89], [54, false, 100]])
    assert.equal(piano.emitted.at(-1).active, false)
    piano.dispose()
  } finally {
    await server.close()
  }
})

test('rotated controls interpret pointer coordinates in their local orientation', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const expression = await server.ssrLoadModule('/src/expression.ts')
    const music = await server.ssrLoadModule('/src/music.ts')
    const target = new Element(48)
    target.dataset.index = '0'
    const pad = await setupComponent('MPCPad', { label: 'Pad', settings: { color: '#ffffff' }, rotated: true },
      { '../expression': expression })
    pad.api.press(pointer(1, target, 'mouse', 0.5, 75, 0))
    assert.equal(pad.emitted.find((event) => event.parameter === 'velocity').value, 32)
    pad.dispose()
    const piano = await setupComponent('PianoRoll', { label: 'Piano', rotated: true, settings: {
      scale: 'chromatic', rootNote: 'C', octaveTranspose: 0, octaves: 1, numRows: 1, style: 'glide-strip',
      orientation: 'horizontal', color: '#ffffff',
    } }, { '../expression': expression, '../music': music })
    piano.api.down(pointer(2, target, 'mouse', 0.5, 75, 80), 48)
    const note = piano.emitted.find((event) => event.parameter === 'note' && event.on)
    assert.equal(note.velocity, 32)
    assert.ok(Math.abs(note.bend - 0.3) < 1e-10)
    piano.dispose()
    const knob = await setupComponent('Knob', { label: 'Knob', rotated: true, settings: {
      min: 0, max: 100, value: 50, step: 1, unit: '', color: '#ffffff',
    } }, {})
    knob.api.start(pointer(3, target, 'mouse', 0.5, 20, 0))
    knob.api.move(pointer(3, target, 'mouse', 0.5, 40, 5))
    assert.equal(knob.emitted.at(-1).value, 70)
    knob.api.move(pointer(3, target, 'mouse', 0.5, 30, 8))
    assert.equal(knob.emitted.at(-1).value, 60)
    knob.api.move(pointer(3, target, 'mouse', 0.5, 30, 18))
    assert.equal(knob.emitted.at(-1).value, 70)
    knob.api.move(pointer(3, target, 'mouse', 0.5, 30, -2))
    assert.equal(knob.emitted.at(-1).value, 50)
    knob.api.wheel({ deltaX: 0, deltaY: 10 })
    assert.equal(knob.emitted.at(-1).value, 51)
    knob.api.wheel({ deltaX: 0, deltaY: -10 })
    assert.equal(knob.emitted.at(-1).value, 49)
    knob.dispose()
    const wheel = await setupComponent('ModWheel', { label: 'Wheel', rotated: true, settings: { depth: 1, autoCenter: false } }, {})
    wheel.api.start(pointer(4, target, 'mouse', 0.5, 75, 0))
    assert.equal(wheel.emitted.at(-1).value, 0.75)
    wheel.dispose()
  } finally {
    await server.close()
  }
})

test('knobs respond to horizontal and vertical dragging and scrolling', async () => {
  const settings = {
    min: 0, max: 100, value: 50, step: 1, unit: '', color: '#ffffff',
  }
  const knob = await setupComponent('Knob', { label: 'Knob', settings }, {})
  const target = new Element(0)
  knob.api.start(pointer(1, target, 'touch', 0.5, 50, 50))
  for (const [x, y, expected] of [[70, 50, 70], [30, 50, 30], [30, 10, 70], [30, 50, 30]]) {
    knob.api.move(pointer(1, target, 'touch', 0.5, x, y))
    assert.equal(knob.emitted.at(-1).value, expected)
    settings.value = expected
  }
  knob.api.move(pointer(1, target, 'touch', 0.5, 40, 52))
  assert.equal(knob.emitted.at(-1).value, 40)
  settings.value = 40
  knob.api.move(pointer(1, target, 'touch', 0.5, 30, 54))
  assert.equal(knob.emitted.at(-1).value, 30)
  settings.value = 30
  knob.api.move(pointer(1, target, 'touch', 0.5, 230, 54))
  assert.equal(knob.emitted.at(-1).value, 100)
  settings.value = 100
  knob.api.move(pointer(1, target, 'touch', 0.5, 229, 54))
  assert.equal(knob.emitted.at(-1).value, 99)
  settings.value = 50
  knob.api.wheel({ deltaX: 10, deltaY: 0 })
  assert.equal(knob.emitted.at(-1).value, 51)
  knob.api.wheel({ deltaX: -10, deltaY: 0 })
  assert.equal(knob.emitted.at(-1).value, 49)
  knob.api.wheel({ deltaX: 0, deltaY: -10 })
  assert.equal(knob.emitted.at(-1).value, 51)
  const count = knob.emitted.length
  knob.api.wheel({ deltaX: 0, deltaY: 0 })
  assert.equal(knob.emitted.length, count)
  knob.dispose()
})

test('rapid rotated knob moves apply each delta once even before the grid rerenders', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const item = dependencies['../grid'].createControl('knob', 0, 0, 'knob')
    item.orientation = 'vertical'
    Object.assign(item.settings, { min: 0, max: 100, value: 50, step: 1 })
    const layout = vue.reactive({ columns: 1, rows: 1, items: [item], connections: [] })
    const grid = await setupComponent('GrooveGrid', { layout, editing: false, wiring: false, settingsOpen: false, bpm: 120 },
      dependencies, { setTimeout, clearTimeout })
    const displayed = grid.api.displayItems.value[0]
    const knob = await setupComponent('Knob', { label: 'Knob', settings: displayed.settings, rotated: true }, {})
    const target = new Element(0)
    knob.api.start(pointer(1, target, 'touch', 0.5, 50, 50))
    for (const [x, expected] of [[60, 60], [65, 65], [60, 60], [50, 50]]) {
      knob.api.move(pointer(1, target, 'touch', 0.5, x, 50))
      grid.api.handleOutput(displayed, knob.emitted.at(-1))
      assert.equal(layout.items[0].settings.value, expected)
    }
    knob.api.move(pointer(1, target, 'touch', 0.5, 50, 60))
    grid.api.handleOutput(displayed, knob.emitted.at(-1))
    assert.equal(layout.items[0].settings.value, 60)
    knob.api.move(pointer(1, target, 'touch', 0.5, 50, 50))
    grid.api.handleOutput(displayed, knob.emitted.at(-1))
    assert.equal(layout.items[0].settings.value, 50)
    knob.dispose()
    grid.dispose()
  } finally {
    await server.close()
  }
})

test('piano pressure mode can force position even when touch reports pressure', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const expression = await server.ssrLoadModule('/src/expression.ts')
    const music = await server.ssrLoadModule('/src/music.ts')
    const target = new Element(48)
    const settings = vue.reactive({ scale: 'chromatic', rootNote: 'C', octaveTranspose: 0, octaves: 1, numRows: 1,
      style: 'pads', orientation: 'horizontal', color: '#ffffff', pressureMode: 'position' })
    const piano = await setupComponent('PianoRoll', { label: 'Piano', settings },
      { '../expression': expression, '../music': music }, { document: { elementFromPoint: () => target } })
    piano.api.down(pointer(1, target, 'touch', 0.8, 10, 25), 48)
    assert.equal(piano.emitted.find((event) => event.parameter === 'velocity').value, 32)
    piano.api.move(pointer(1, target, 'touch', 0.9, 10, 75))
    assert.equal(piano.emitted.filter((event) => event.parameter === 'pressure').at(-1).value, 95)
    settings.pressureMode = 'pressure'
    piano.api.move(pointer(1, target, 'touch', 0.9, 10, 25))
    assert.equal(piano.emitted.filter((event) => event.parameter === 'pressure').at(-1).value, 114)
    piano.api.up(pointer(1, target, 'touch', 0, 10, 25))
    assert.equal(piano.emitted.filter((event) => event.parameter === 'pressure').at(-1).active, false)
    settings.orientation = 'vertical'
    settings.pressureMode = 'position'
    piano.api.down(pointer(2, target, 'pen', 0.9, 75, 25), 48)
    assert.equal(piano.emitted.filter((event) => event.parameter === 'velocity').at(-1).value, 95)
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

test('arpeggiator traverses every held note at each distance level', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const music = await server.ssrLoadModule('/src/music.ts')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const newArp = createControl('new-arp', 0, 0, 'arpeggiator')
    assert.equal(newArp.settings.distance, 12)
    assert.equal(newArp.settings.steps, 0)
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{
      id: 'A', title: 'A', icon: 'A', color: '#ffffff',
      layout: { columns: 1, rows: 1, items: [newArp], connections: [] },
    }] }
    assert.equal(isSavedProject(project), true)
    newArp.settings.steps = -1
    assert.equal(isSavedProject(project), false)
    const timers = { setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {} }
    const run = async (style, steps, count) => {
      const props = { label: 'Arp', bpm: 120, notes: [60, 64, 67].map((note) => ({ note, count: 1, velocity: 100 })),
        settings: { enabled: true, rate: '1/8', style, steps, distance: 12, scale: 'chromatic', gate: 0.5 } }
      const arp = await setupComponent('Arpeggiator', props, { '../music': music },
        { window: timers, Math: Object.assign(Object.create(Math), { random: () => 0.99 }) })
      for (let i = 1; i < count; i++) arp.api.tick()
      const played = arp.emitted.filter((event) => event.parameter === 'note' && event.on).map((event) => event.value)
      arp.dispose()
      return played
    }
    assert.deepEqual(await run('up', 0, 4), [60, 64, 67, 60])
    assert.deepEqual(await run('up', 1, 6), [60, 64, 67, 72, 76, 79])
    assert.deepEqual(await run('down', 1, 6), [67, 64, 60, 79, 76, 72])
    assert.deepEqual(await run('up-down', 0, 5), [60, 64, 67, 64, 60])
    assert.deepEqual(await run('random', 0, 1), [67])
    assert.deepEqual(await run('random', 1, 2), [67, 79])
  } finally {
    await server.close()
  }
})

test('secondary touch toggles grid buttons once while another contact is held', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const music = await server.ssrLoadModule('/src/music.ts')
    const lfo = await server.ssrLoadModule('/src/lfo.ts')
    const expression = await server.ssrLoadModule('/src/expression.ts')
    const arp = await setupComponent('Arpeggiator', { label: 'Arp', bpm: 120, notes: [],
      settings: { enabled: true, rate: '1/8', style: 'up', steps: 1, distance: 12, scale: 'chromatic', gate: 0.5 } },
    { '../music': music }, { window: { clearTimeout() {}, clearInterval() {} } })
    const oscillator = await setupComponent('LFO', { label: 'LFO', bpm: 120,
      settings: { waveform: 'sine', rateMode: 'free', rate: 1, depth: 1, offset: 0, smoothness: 0 } }, { '../lfo': lfo },
    { cancelAnimationFrame() {} })
    const selector = await setupComponent('OutputSelector', { label: 'Selector', destination: '', value: '', flashSequence: 0 }, {})
    const piano = await setupComponent('PianoRoll', { label: 'Piano', settings: {
      scale: 'chromatic', rootNote: 'C', octaveTranspose: 0, octaves: 1, numRows: 1, style: 'pads',
      orientation: 'horizontal', color: '#ffffff', pressureMode: 'position',
    } }, { '../music': music, '../expression': expression })
    const target = new Element(0)
    const first = pointer(1, target, 'touch', 0.5, 25, 50)
    piano.api.down(first, 48)
    const secondary = pointer(2, target, 'touch', 0.5, 50, 50)
    secondary.button = -1
    for (const component of [arp, oscillator, selector]) {
      component.api.tap.down(secondary)
      component.api.tap.up(secondary)
      component.api.tap.click({ detail: 1 })
    }
    assert.equal(arp.emitted.length, 1)
    assert.equal(oscillator.api.held.value, true)
    assert.equal(selector.emitted.length, 1)
    assert.equal(piano.api.pointers.size, 1)
    assert.equal(piano.emitted.filter((event) => event.parameter === 'note' && event.on === false).length, 0)
    oscillator.api.tap.click({ detail: 0 })
    assert.equal(oscillator.api.held.value, false)
    arp.api.tap.down(secondary)
    arp.api.tap.cancel(secondary)
    arp.api.tap.up(secondary)
    assert.equal(arp.emitted.length, 1)
    arp.dispose()
    oscillator.dispose()
    selector.dispose()
    piano.dispose()
  } finally {
    await server.close()
  }
})

test('wired on/off switches arpeggiation and held-note bypass without changing the saved toggle', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const music = await server.ssrLoadModule('/src/music.ts')
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const { inputs, isCompatible } = await server.ssrLoadModule('/src/parameters.ts')
    const { effectiveControls } = await server.ssrLoadModule('/src/modulation.ts')
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const pad = createControl('pad', 0, 0, 'pad')
    const arp = createControl('arp', 1, 0, 'arpeggiator')
    const wire = { id: 'wire', sourceId: 'pad', sourceParameter: 'gate', targetId: 'arp', targetParameter: 'enabled', mappingMode: 'abs' }
    const layout = vue.reactive({ columns: 2, rows: 1, items: [pad, arp], connections: [wire] })
    const signals = vue.reactive(new Map())
    const settings = vue.computed(() => effectiveControls(layout, signals)[1].settings)
    const props = vue.reactive({ label: 'Arp', bpm: 120, notes: [{ note: 60, count: 1, velocity: 47 }], settings })
    const instance = await setupComponent('Arpeggiator', props, { '../music': music },
      { window: { setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {} } })
    assert.ok(inputs(arp).some((input) => input.id === 'enabled'))
    assert.equal(isCompatible(pad, 'gate', arp, 'enabled'), true)
    assert.equal(settings.value.enabled, true)
    instance.emitted.length = 0
    signals.set('pad:gate', 0)
    assert.equal(settings.value.enabled, false)
    assert.deepEqual(instance.emitted.filter((event) => event.parameter === 'note').map((event) => event.on), [false, true])
    assert.equal(layout.items[1].settings.enabled, true)
    instance.emitted.length = 0
    signals.set('pad:gate', 1)
    assert.equal(settings.value.enabled, true)
    assert.deepEqual(instance.emitted.filter((event) => event.parameter === 'note').map((event) => event.on), [false, true])
    signals.set('pad:gate', 0.5)
    assert.equal(settings.value.enabled, false)
    layout.connections[0].mappingMode = 'mod'
    layout.connections[0].modulationMin = -100
    layout.connections[0].modulationMax = 0
    signals.set('pad:gate', 0)
    assert.equal(settings.value.enabled, false)
    signals.set('pad:gate', 1)
    assert.equal(settings.value.enabled, true)
    signals.delete('pad:gate')
    assert.equal(settings.value.enabled, true)
    const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout }] }
    assert.equal(isSavedProject(JSON.parse(JSON.stringify(project))), true)
    instance.dispose()
  } finally {
    await server.close()
  }
})

test('wired chords through a selector trigger and release independent hit voices', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}.ts`)
    }
    const calls = []
    class SampleHit {
      constructor(params) { this.params = { ...params } }
      updateParameters(params) { Object.assign(this.params, params) }
      trigger(velocity, note, id, bend) { calls.push(['on', id, note, velocity, bend]) }
      release(id) { calls.push(['off', id]) }
      setVoicePitchBend(id, bend) { calls.push(['bend', id, bend]) }
      dispose() {}
    }
    const instruments = { SampleHit, SampleLoop: class {}, Bass303: class {}, Drum808: class {}, DrumKit: class {},
      InstrumentFactory: { create: (_, params) => new SampleHit(params) } }
    dependencies['../instruments'] = instruments
    const { createControl } = dependencies['../grid']
    const piano = createControl('piano', 0, 0, 'piano-roll')
    const selector = createControl('selector', 1, 0, 'output-selector')
    const hit = createControl('hit', 2, 0, 'instrument-pad')
    hit.settings.instrumentParams.polyphony = 4
    const layout = vue.reactive({ columns: 3, rows: 1, items: [piano, selector, hit], connections: [
      { id: 'one', sourceId: 'piano', sourceParameter: 'note', targetId: 'selector', targetParameter: 'note' },
      { id: 'two', sourceId: 'selector', sourceParameter: 'note', targetId: 'hit', targetParameter: 'note' },
    ] })
    const tone = { start: async () => {} }
    const grid = await setupComponent('GrooveGrid', { layout, editing: false, wiring: false, settingsOpen: false, bpm: 120 },
      { ...dependencies, tone }, { setTimeout, clearTimeout })
    const props = vue.reactive({ label: 'Hit', settings: hit.settings, notes: vue.computed(() => grid.api.receivedNotes('hit')) })
    const pad = await setupComponent('InstrumentPad', props, { '../instruments': instruments, tone })
    const send = (note, on, bend) => grid.api.handleOutput(piano,
      { parameter: 'note', value: note, on, velocity: 90, ...(bend === undefined ? {} : { bend }) })
    send(60, true)
    send(64, true)
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(calls, [['on', 'note:60', 60, 90, 0], ['on', 'note:64', 64, 90, 0]])
    send(60, undefined, 0.5)
    send(64, false)
    assert.deepEqual(calls.slice(2), [['bend', 'note:60', 0.5], ['off', 'note:64']])
    send(60, false)
    assert.deepEqual(calls.at(-1), ['off', 'note:60'])
    pad.dispose()
    grid.dispose()
  } finally {
    await server.close()
  }
})

test('toggle mode mutes incoming notes without changing trigger mode behavior', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const calls = []
    class SampleHit {
      constructor(params) { this.params = { ...params } }
      updateParameters(params) { Object.assign(this.params, params) }
      trigger(velocity, note, id, bend) { calls.push(['on', id, note, velocity, bend]) }
      release(id) { calls.push(['off', id]) }
      setVoicePitchBend() {}
      dispose() {}
    }
    const instruments = { SampleHit, SampleLoop: class {}, Bass303: class {}, Drum808: class {}, DrumKit: class {},
      InstrumentFactory: { create: (_, params) => new SampleHit(params) } }
    const { createControl } = await server.ssrLoadModule('/src/grid.ts')
    const hit = createControl('hit', 0, 0, 'instrument-pad')
    hit.settings.mode = 'toggle'
    hit.settings.instrumentParams.polyphony = 4
    const props = vue.reactive({ label: 'Hit', settings: hit.settings, notes: [] })
    const pad = await setupComponent('InstrumentPad', props, {
      '../instruments': instruments, tone: { start: async () => {} },
    })
    try {
      props.notes.push({ note: 60, velocity: 90, count: 1 })
      await new Promise((resolve) => setImmediate(resolve))
      assert.deepEqual(calls, [['on', 'note:60', 60, 90, 0]])
      pad.api.handlePadOutput({ parameter: 'gate', value: 1 })
      assert.deepEqual(calls.at(-1), ['off', 'note:60'])
      pad.api.handlePadOutput({ parameter: 'gate', value: 0 })
      assert.deepEqual(calls.at(-1), ['off', 'note:60'])
      pad.api.handlePadOutput({ parameter: 'gate', value: 1 })
      await new Promise((resolve) => setImmediate(resolve))
      assert.deepEqual(calls.at(-1), ['on', 'note:60', 60, 90, 0])
    } finally {
      pad.dispose()
    }
  } finally {
    await server.close()
  }
})

test('tapping a resize handle opens settings without preventing resize drags', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const pad = dependencies['../grid'].createControl('pad', 0, 0, 'pad')
    const layout = vue.reactive({ columns: 2, rows: 1, items: [pad], connections: [] })
    const grid = await setupComponent('GrooveGrid', { layout, editing: true, wiring: false, settingsOpen: false, bpm: 120 },
      dependencies, { setTimeout, clearTimeout, window: { getComputedStyle: () => ({ columnGap: '0', rowGap: '0' }) } })
    grid.api.grid.value = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }) }
    const target = new Element(0)
    const start = pointer(1, target, 'touch', 0.5, 0, 0)
    grid.api.startInteraction(start, layout.items[0], 'resize')
    grid.api.endInteraction(start)
    assert.equal(grid.api.draft.value.id, 'pad')
    grid.api.draft.value = null
    grid.api.startInteraction(start, layout.items[0], 'resize')
    grid.api.endInteraction(pointer(1, target, 'touch', 0.5, 100, 0))
    assert.equal(layout.items[0].width, 2)
    assert.equal(grid.api.draft.value, null)
    grid.dispose()
  } finally {
    await server.close()
  }
})

test('recorded knob automation yields to a live drag and resumes afterward', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const knob = dependencies['../grid'].createControl('knob', 0, 0, 'knob')
    const loop = dependencies['../grid'].createControl('loop', 1, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.syncMode = 'immediate'
    const layout = vue.reactive({ columns: 2, rows: 1, items: [knob, loop], connections: [] })
    let beat = 0
    const grid = await setupComponent('GrooveGrid', { layout, editing: false, wiring: false, settingsOpen: false,
      bpm: 120, playing: true, transportClock: { position: () => beat } }, dependencies,
    { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    try {
      grid.api.toggleLoop('loop')
      beat = 0.5
      grid.api.handleOutput(layout.items[0], { parameter: 'value', value: 65, delta: 1, user: true })
      beat = 0.75
      grid.api.handleOutput(layout.items[0], { parameter: 'value', value: 70, delta: 5, user: true })
      assert.deepEqual(loop.settings.automation[0].map((event) => event.value), [65, 70])
      layout.items[1].settings.armed = false
      layout.items[0].settings.value = 10
      beat = 4.5
      grid.api.loopEngine.tick()
      assert.equal(grid.api.displayItems.value[0].settings.value, 65)
      grid.api.controlActivity('knob', true)
      grid.api.handleOutput(grid.api.displayItems.value[0], { parameter: 'value', value: 75, delta: 10, user: true })
      beat = 4.75
      grid.api.loopEngine.tick()
      assert.equal(grid.api.displayItems.value[0].settings.value, 75)
      grid.api.controlActivity('knob', false)
      assert.equal(grid.api.displayItems.value[0].settings.value, 70)
      grid.api.loopEngine.stop()
      assert.equal(grid.api.displayItems.value[0].settings.value, 75)
    } finally { grid.dispose() }
  } finally { await server.close() }
})

test('tracker edits note steps and groups automation without losing recorded timing', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    class Input { constructor(value) { this.value = String(value); this.valueAsNumber = Number(value) } }
    class Select extends Input {}
    const sources = [{ id: 'pad', label: 'Pad', color: '#ff0000' }, { id: 'knob', label: 'Knob' }]
    const props = vue.reactive({ modelValue: [], automation: [
      { sourceId: 'knob', parameter: 'value', value: 10, position: 0.02 },
      { sourceId: 'knob', parameter: 'value', value: 20, position: 0.12 },
    ], instruments: [sources[0]], sources, barLength: 1 })
    const music = await server.ssrLoadModule('/src/music.ts')
    const editor = await setupComponent('SequenceEditor', props, { '../music': music },
      { HTMLInputElement: Input, HTMLSelectElement: Select })
    try {
      editor.api.addRow()
      const row = editor.api.rows.value.find((entry) => entry.kind === 'note')
      editor.api.addNote(row, 2)
      props.modelValue = editor.emitted.at(-1)
      assert.equal(props.modelValue[0].position, 0.5)
      editor.api.changeNote('velocity', { target: new Input(73) })
      props.modelValue = editor.emitted.at(-1)
      assert.equal(props.modelValue[0].velocity, 73)
      editor.api.changeNote('duration', { target: new Input(0.75) })
      props.modelValue = editor.emitted.at(-1)
      assert.equal(props.modelValue[0].duration, 0.75)
      const automationRow = editor.api.rows.value.find((entry) => entry.kind === 'automation')
      assert.equal(editor.api.entries(automationRow, 0).length, 2)
      editor.api.chooseCell(automationRow, 0)
      assert.equal(editor.api.selectedPeers.value.length, 2)
      assert.deepEqual(props.automation.map((event) => event.position), [0.02, 0.12])
      editor.api.selected.value = { kind: 'note', index: 0 }
      editor.api.chooseCell(row, 2)
      assert.equal(editor.emitted.at(-1).length, 0)
    } finally { editor.dispose() }
  } finally { await server.close() }
})

test('all-bank loops record and replay in the correct bank even when control IDs overlap', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const { BankEventBus } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const { createControl } = dependencies['../grid']
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.syncMode = 'immediate'
    const firstKnob = createControl('control-1', 1, 0, 'knob')
    const secondKnob = createControl('control-1', 0, 0, 'knob')
    const pad = createControl('pad', 1, 0, 'instrument-pad', '808')
    const layoutA = vue.reactive({ columns: 2, rows: 1, items: [loop, firstKnob], connections: [] })
    const layoutB = vue.reactive({ columns: 2, rows: 1, items: [secondKnob, pad], connections: [] })
    const bus = new BankEventBus()
    let beat = 0
    const clock = { position: () => beat }
    const common = { editing: false, wiring: false, settingsOpen: false, bpm: 120, playing: true, transportClock: clock, bankEvents: bus }
    const environment = { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} }
    const gridA = await setupComponent('GrooveGrid', { ...common, bankId: 'A', layout: layoutA }, dependencies, environment)
    const gridB = await setupComponent('GrooveGrid', { ...common, bankId: 'B', layout: layoutB }, dependencies, environment)
    try {
      gridA.api.toggleLoop('loop')
      beat = 0.1
      gridB.api.captureNote('pad', 60, true, 100)
      beat = 0.2
      gridB.api.captureNote('pad', 60, false, 100)
      assert.equal(loop.settings.clips[0].length, 0)
      layoutA.items[0].settings.recordScope = 'all'
      beat = 0.5
      gridB.api.captureNote('pad', 60, true, 100)
      beat = 0.75
      gridB.api.captureNote('pad', 60, false, 100)
      gridB.api.handleOutput(layoutB.items[0], { parameter: 'value', value: 65, delta: 1, user: true })
      assert.equal(loop.settings.clips[0][0].bankId, 'B')
      assert.equal(loop.settings.automation[0][0].bankId, 'B')
      beat = 4.5
      gridA.api.loopEngine.tick()
      assert.equal(gridA.api.recordedNotes('pad').length, 0)
      assert.equal(gridB.api.recordedNotes('pad')[0].note, 60)
      assert.equal(loop.settings.clips[0].length, 1)
      beat = 4.75
      gridA.api.loopEngine.tick()
      assert.equal(gridB.api.recordedNotes('pad').length, 0)
      assert.equal(gridB.api.displayItems.value[0].settings.value, 65)
      assert.equal(gridA.api.displayItems.value[1].settings.value, 64)
      gridA.api.loopEngine.stop()
      assert.equal(gridB.api.loopAutomation.size, 0)
    } finally { gridA.dispose(); gridB.dispose() }
  } finally { await server.close() }
})

test('loop tap arms when stopped and controls playback when transport is running', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const loop = dependencies['../grid'].createControl('loop', 0, 0, 'sequenced-loop')
    const layout = vue.reactive({ columns: 1, rows: 1, items: [loop], connections: [] })
    const props = vue.reactive({ layout, editing: false, wiring: false, settingsOpen: false, bpm: 120, playing: false,
      transportClock: { position: () => 0 } })
    const grid = await setupComponent('GrooveGrid', props, dependencies,
      { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    try {
      grid.api.toggleLoop('loop')
      assert.equal(layout.items[0].settings.armed, true)
      assert.equal(grid.api.loopEngine.isEnabled('loop'), false)
      props.playing = true
      assert.equal(grid.api.loopEngine.isEnabled('loop'), true)
      grid.api.toggleLoop('loop')
      assert.equal(grid.api.loopEngine.isEnabled('loop'), true)
      assert.equal(layout.items[0].settings.armed, true)
      grid.api.toggleLoop('loop')
      assert.equal(grid.api.loopEngine.isEnabled('loop'), true)
      props.playing = false
      assert.equal(grid.api.loopEngine.isEnabled('loop'), false)
    } finally { grid.dispose() }
  } finally { await server.close() }
})

test('loop swipes select clips without triggering taps, including while armed and playing', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const loop = dependencies['../grid'].createControl('loop', 0, 0, 'sequenced-loop')
    const layout = vue.reactive({ columns: 1, rows: 1, items: [loop], connections: [] })
    let beat = 0
    const props = vue.reactive({ layout, editing: false, wiring: false, settingsOpen: false, bpm: 120, playing: false,
      transportClock: { position: () => beat } })
    const grid = await setupComponent('GrooveGrid', props, dependencies,
      { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    const target = new Element(0)
    const gesture = grid.api.loopGesture('loop')
    const event = (id, x, y) => pointer(id, target, 'touch', 0.5, x, y)
    function swipe(id, fromY, toY) {
      gesture.down(event(id, 50, fromY))
      gesture.move(event(id, 50, toY))
      gesture.up(event(id, 50, toY))
    }
    try {
      gesture.down(event(1, 50, 50))
      gesture.up(event(1, 50, 50))
      assert.equal(loop.settings.armed, true)
      swipe(2, 70, 30)
      assert.equal(loop.settings.clipIndex, 1)
      assert.ok(Array.isArray(loop.settings.clips[1]))
      assert.ok(Array.isArray(loop.settings.automation[1]))
      assert.equal(loop.settings.armed, true)
      swipe(3, 30, 70)
      swipe(4, 30, 70)
      assert.equal(loop.settings.clipIndex, 0)
      gesture.down(event(5, 50, 50))
      gesture.move(event(5, 80, 50))
      gesture.up(event(5, 50, 50))
      assert.equal(loop.settings.armed, true)
      gesture.down(event(6, 50, 70))
      gesture.cancel(event(6, 50, 30))
      gesture.up(event(6, 50, 30))
      assert.equal(loop.settings.clipIndex, 0)
      gesture.down(pointer(9, target, 'mouse', 0.5, 50, 70))
      gesture.up(pointer(9, target, 'mouse', 0, 50, 30))
      assert.equal(loop.settings.clipIndex, 1)
      swipe(10, 30, 70)
      assert.equal(loop.settings.clipIndex, 0)
      let prevented = false
      grid.api.loopKeyDown({ key: 'ArrowUp', preventDefault() { prevented = true } }, 'loop')
      assert.equal(prevented, true)
      assert.equal(loop.settings.clipIndex, 1)
      props.playing = true
      beat = 1
      swipe(7, 70, 30)
      assert.equal(loop.settings.clipIndex, 2)
      assert.equal(grid.api.loopEngine.isEnabled('loop'), true)
      grid.api.loopEngine.tick()
      assert.equal(grid.api.loopEngine.isPending('loop'), true)
      beat = 4
      grid.api.loopEngine.tick()
      assert.equal(grid.api.loopEngine.isPending('loop'), false)
      loop.settings.clipIndex = 15
      swipe(8, 70, 30)
      assert.equal(loop.settings.clipIndex, 15)
    } finally { grid.dispose() }
  } finally { await server.close() }
})

test('a wired clip index selects and creates clips without overwriting the saved base index', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const { createControl } = dependencies['../grid']
    const knob = createControl('knob', 0, 0, 'knob')
    knob.settings.value = 0
    const loop = createControl('loop', 1, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.syncMode = 'immediate'
    const wire = { id: 'wire', sourceId: 'knob', sourceParameter: 'value', targetId: 'loop', targetParameter: 'clipIndex', mappingMode: 'abs' }
    const layout = vue.reactive({ columns: 2, rows: 1, items: [knob, loop], connections: [wire] })
    let beat = 0
    const grid = await setupComponent('GrooveGrid', { layout, editing: false, wiring: false, settingsOpen: false,
      bpm: 120, playing: true, transportClock: { position: () => beat } }, dependencies,
    { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    try {
      assert.equal(dependencies['../parameters'].isCompatible(knob, 'value', loop, 'clipIndex'), true)
      grid.api.handleOutput(layout.items[0], { parameter: 'value', value: 127, delta: 127, user: true })
      assert.equal(grid.api.displayItems.value[1].settings.clipIndex, 15)
      assert.ok(Array.isArray(layout.items[1].settings.clips[15]))
      assert.equal(layout.items[1].settings.clipIndex, 0)
      grid.api.changeLoopIndex('loop', 1)
      assert.equal(layout.items[1].settings.clipIndex, 1)
      assert.ok(Array.isArray(layout.items[1].settings.clips[1]))
      assert.equal(grid.api.displayItems.value[1].settings.clipIndex, 15)
      beat = 0.25
      grid.api.loopEngine.tick()
      grid.api.captureNote('pad', 60, true, 100)
      beat = 0.5
      grid.api.captureNote('pad', 60, false, 100)
      assert.equal(layout.items[1].settings.clips[15].length, 1)
      assert.equal(layout.items[1].settings.clips[0].length, 0)
    } finally { grid.dispose() }
  } finally { await server.close() }
})

test('disabled automation recording skips knob and wheel gestures but leaves controls operational', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const { createControl } = dependencies['../grid']
    const knob = createControl('knob', 0, 0, 'knob')
    const wheel = createControl('wheel', 1, 0, 'mod-wheel')
    const loop = createControl('loop', 2, 0, 'sequenced-loop')
    knob.settings.recordAutomation = false
    wheel.settings.recordAutomation = false
    loop.settings.armed = true
    const layout = vue.reactive({ columns: 3, rows: 1, items: [knob, wheel, loop], connections: [] })
    const grid = await setupComponent('GrooveGrid', { layout, editing: false, wiring: false, settingsOpen: false,
      bpm: 120, playing: true, transportClock: { position: () => 0 } }, dependencies,
    { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    try {
      grid.api.handleOutput(layout.items[0], { parameter: 'value', value: 65, delta: 1, user: true })
      grid.api.handleOutput(layout.items[1], { parameter: 'value', value: 0.75, user: true })
      assert.equal(layout.items[0].settings.value, 65)
      assert.equal(grid.api.signals.get('wheel:value'), 0.75)
      assert.equal(loop.settings.automation[0].length, 0)
      layout.items[0].settings.recordAutomation = true
      layout.items[1].settings.recordAutomation = true
      grid.api.handleOutput(layout.items[0], { parameter: 'value', value: 66, delta: 1, user: true })
      grid.api.handleOutput(layout.items[1], { parameter: 'value', value: 0.5, user: true })
      assert.equal(loop.settings.automation[0].length, 2)
    } finally { grid.dispose() }
  } finally { await server.close() }
})

test('unconnected touch pressure does not create loop automation', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const { createControl } = dependencies['../grid']
    const piano = createControl('piano', 0, 0, 'piano-roll')
    const knob = createControl('knob', 1, 0, 'knob')
    const loop = createControl('loop', 2, 0, 'sequenced-loop')
    loop.settings.armed = true
    const layout = vue.reactive({ columns: 3, rows: 1, items: [piano, knob, loop], connections: [] })
    const grid = await setupComponent('GrooveGrid', { layout, editing: false, wiring: false, settingsOpen: false,
      bpm: 120, playing: true, transportClock: { position: () => 0 } }, dependencies,
    { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    try {
      grid.api.handleOutput(piano, { parameter: 'pressure', value: 75, active: true, user: true })
      assert.equal(grid.api.signals.has('piano:pressure'), false)
      assert.equal(loop.settings.automation[0].length, 0)

      layout.connections.push({
        id: 'pressure-wire', sourceId: 'piano', sourceParameter: 'pressure',
        targetId: 'knob', targetParameter: 'value',
      })
      grid.api.handleOutput(piano, { parameter: 'pressure', value: 75, active: true, user: true })
      assert.equal(grid.api.signals.get('piano:pressure'), 75)
      assert.equal(loop.settings.automation[0].length, 1)

      grid.api.handleOutput(piano, { parameter: 'pressure', value: 0, active: false, user: true })
      assert.equal(grid.api.signals.has('piano:pressure'), false)
      assert.equal(loop.settings.automation[0].length, 2)
    } finally { grid.dispose() }
  } finally { await server.close() }
})
