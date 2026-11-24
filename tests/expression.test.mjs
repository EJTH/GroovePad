import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createServer } from 'vite'

class Element {
  constructor(note) {
    this.dataset = { note: String(note) }
    this.parentElement = { contains: () => true }
    this.ownerDocument = { elementFromPoint: () => null }
  }
  getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 } }
  setPointerCapture() {}
  closest() { return this }
  contains() { return true }
}

async function setupComponent(name, props, dependencies, environment = {}, onEmit = () => {}) {
  const cleanup = []
  const vueMock = { ...vue, provide: () => {}, inject: name === 'NumericSetting' ? () => undefined : vue.inject,
    onMounted: () => {}, onBeforeUnmount: (callback) => cleanup.push(callback), onUnmounted: (callback) => cleanup.push(callback) }
  if (name === 'GrooveGrid' && !dependencies['../sequencedLoop']) {
    const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
    try {
      dependencies['../sequencedLoop'] = await server.ssrLoadModule('/src/sequencedLoop.ts')
    } finally { await server.close() }
  }
  if (name === 'App' && !dependencies['./audio/sessionRecording']) {
    dependencies['./audio/sessionRecording'] = { RECORDING_FORMATS: [], supportedRecordingFormats: () => [], startSessionRecording: async () => ({}) }
  }
  if (!dependencies['../pointerTap']) {
    const source = await readFile(new URL('../src/pointerTap.ts', import.meta.url), 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const tapModule = { exports: {} }
    vm.runInNewContext(code, { module: tapModule, exports: tapModule.exports, HTMLElement: Element })
    dependencies['../pointerTap'] = tapModule.exports
  }
  if (name === 'MPCPad' || name === 'PianoRoll') {
    const source = await readFile(new URL('../src/components/useNoteRepeat.ts', import.meta.url), 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const repeatModule = { exports: {} }
    vm.runInNewContext(code, { module: repeatModule, exports: repeatModule.exports, performance,
      setInterval: environment.setInterval ?? setInterval, clearInterval: environment.clearInterval ?? clearInterval,
      setTimeout: environment.setTimeout ?? setTimeout, clearTimeout: environment.clearTimeout ?? clearTimeout,
      require: (path) => path === 'vue' ? vueMock : dependencies[path] })
    dependencies['./useNoteRepeat'] = repeatModule.exports
  }
  if (name === 'GrooveGrid') {
    const sources = [
      ['../grid', '/src/grid.ts'],
      ['../modulation', '/src/modulation.ts'],
      ['../parameters', '/src/parameters.ts'],
      ['../music', '/src/music.ts'],
      ['../settingsAutomation', '/src/settingsAutomation.ts'],
    ]
    const missing = sources.filter(([key]) => !dependencies[key])
    if (missing.length) {
      const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
      try {
        for (const [key, path] of missing) dependencies[key] = await server.ssrLoadModule(path)
      } finally { await server.close() }
    }
    if (!dependencies['./useGridPlayback']) {
      const source = await readFile(new URL('../src/components/useGridPlayback.ts', import.meta.url), 'utf8')
      const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
      const playbackModule = { exports: {} }
      vm.runInNewContext(code, { module: playbackModule, exports: playbackModule.exports, HTMLElement: Element, ...environment,
        setInterval: environment.setInterval ?? setInterval, clearInterval: environment.clearInterval ?? clearInterval,
        setTimeout: environment.setTimeout ?? setTimeout, clearTimeout: environment.clearTimeout ?? clearTimeout,
        require: (path) => path === 'vue' ? vueMock : dependencies[path] ?? { default: {} } })
      dependencies['./useGridPlayback'] = playbackModule.exports
    }
  }
  if (name === 'GrooveGrid' && !dependencies['./useGridInteraction']) {
    const source = await readFile(new URL('../src/components/useGridInteraction.ts', import.meta.url), 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const interactionModule = { exports: {} }
    vm.runInNewContext(code, { module: interactionModule, exports: interactionModule.exports, HTMLElement: Element, ...environment,
      require: (path) => path === 'vue' ? vueMock : dependencies[path] })
    dependencies['./useGridInteraction'] = interactionModule.exports
  }
  if (name === 'App' && !dependencies['./composables/useTransport']) {
    const source = await readFile(new URL('../src/composables/useTransport.ts', import.meta.url), 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    const transportModule = { exports: {} }
    vm.runInNewContext(code, { module: transportModule, exports: transportModule.exports, ...environment,
      setInterval: environment.setInterval ?? setInterval, clearInterval: environment.clearInterval ?? clearInterval,
      setTimeout: environment.setTimeout ?? setTimeout, clearTimeout: environment.clearTimeout ?? clearTimeout,
      require: (path) => path === 'vue' ? vueMock
        : path === 'tone' ? dependencies.tone
          : path === '../sequencedLoop' ? dependencies['./sequencedLoop'] ?? { default: {} }
            : dependencies[path] ?? { default: {} } })
    dependencies['./composables/useTransport'] = transportModule.exports
  }
  const source = await readFile(new URL(name === 'App' ? '../src/App.vue' : `../src/components/${name}.vue`, import.meta.url), 'utf8')
  const script = compileScript(parse(source).descriptor, { id: name }).content
  const { outputText } = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports, HTMLElement: Element, HTMLButtonElement: Element,
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail } },
    require: (path) => path === 'vue' ? vueMock : dependencies[path] ?? { default: {} }, ...environment })
  const emitted = []
  const scope = vue.effectScope()
  const api = scope.run(() => module.exports.default.setup(props, {
    emit: (event, output) => { emitted.push(output); onEmit(event, output) }, expose: () => {},
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

test('swiping between pads transfers the pointer, expression and gate without disturbing other contacts', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const expression = await server.ssrLoadModule('/src/expression.ts')
    const dependencies = { '../expression': expression }
    class SwipeEvent { constructor(type, options) { this.type = type; this.detail = options.detail } }
    const environment = { CustomEvent: SwipeEvent }
    const outputs = []
    const first = await setupComponent('MPCPad', { label: 'First', settings: { color: '#fff' } }, dependencies, environment,
      (_event, output) => outputs.push(['first', output.parameter, output.value]))
    const second = await setupComponent('MPCPad', { label: 'Second', settings: { color: '#fff' } }, dependencies, environment,
      (_event, output) => outputs.push(['second', output.parameter, output.value]))
    const grid = {}
    const a = new Element(0)
    const b = new Element(1)
    let underPointer = a
    for (const [element, pad] of [[a, first], [b, second]]) {
      element.ownerDocument = { elementFromPoint: () => underPointer }
      element.closest = (selector) => selector === '.groove-grid' ? grid : element
      element.dispatchEvent = (event) => { event.currentTarget = element; pad.api.swipe(event) }
      element.setPointerCapture = (id) => { element.captured = id }
    }

    first.api.press(pointer(1, a, 'touch', 0.5, 0, 25))
    second.api.press(pointer(2, b, 'touch', 0.5, 0, 60))
    underPointer = b
    first.api.move(pointer(1, a, 'touch', 0.5, 0, 70))
    assert.deepEqual(outputs.filter((entry) => entry[1] === 'gate'), [['first', 'gate', 1], ['second', 'gate', 1]])
    second.api.release(pointer(2, b, 'touch', 0, 0, 60))
    first.api.move(pointer(1, a, 'touch', 0.5, 0, 70))
    assert.equal(b.captured, 1)
    assert.deepEqual(outputs.filter((entry) => entry[1] === 'gate'),
      [['first', 'gate', 1], ['second', 'gate', 1], ['second', 'gate', 0], ['first', 'gate', 0], ['second', 'gate', 1]])
    assert.deepEqual(second.emitted.filter((entry) => entry.parameter === 'velocity').map((entry) => entry.value), [76, 89])
    first.api.release(pointer(1, a, 'touch', 0, 0, 70)) // lost capture on the old pad
    underPointer = null
    second.api.move(pointer(1, b, 'touch', 0.5, 0, 80))
    underPointer = a
    second.api.move(pointer(1, b, 'touch', 0.5, 0, 30))
    assert.equal(a.captured, 1)
    first.api.release(pointer(1, a, 'touch', 0, 0, 30)) // pointerup or cancellation
    assert.deepEqual(outputs.filter((entry) => entry[1] === 'gate').slice(-3),
      [['second', 'gate', 0], ['first', 'gate', 1], ['first', 'gate', 0]])
    assert.equal(first.emitted.at(-2).active, false)
    first.dispose()
    second.dispose()
  } finally {
    await server.close()
  }
})

test('note repeat delays pad gates and piano notes until the next transport subdivision', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const expression = await server.ssrLoadModule('/src/expression.ts')
    const music = await server.ssrLoadModule('/src/music.ts')
    const dependencies = { '../expression': expression, '../music': music }
    let beat = 0
    let nextId = 0
    const timers = new Map()
    const environment = {
      setInterval: (fn) => { timers.set(++nextId, fn); return nextId },
      clearInterval: (id) => timers.delete(id),
    }
    const target = new Element(48)
    const timing = { repeatDivision: '1/16', bpm: 120, playing: true, transportClock: { repeatPosition: () => beat } }
    const pad = await setupComponent('MPCPad', { ...timing, label: 'Pad', settings: { color: '#ffffff' } }, dependencies, environment)
    const piano = await setupComponent('PianoRoll', { ...timing, label: 'Piano', settings: {
      scale: 'chromatic', rootNote: 'C', octaveTranspose: 0, octaves: 1, numRows: 1,
      orientation: 'horizontal', style: 'pads', color: '#ffffff',
    } }, dependencies, environment)
    pad.api.press(pointer(1, target, 'mouse', 0.5, 0, 25))
    piano.api.down(pointer(2, target, 'mouse', 0.5, 0, 25), 48)
    assert.equal(pad.emitted.some((event) => event.parameter === 'gate'), false)
    assert.equal(piano.emitted.some((event) => event.parameter === 'note'), false)
    beat = 0.25
    for (const tick of timers.values()) tick()
    assert.equal(pad.emitted.find((event) => event.parameter === 'gate')?.value, 1)
    assert.equal(piano.emitted.find((event) => event.parameter === 'note')?.on, true)
    pad.api.release(pointer(1, target, 'mouse', 0, 0, 25))
    piano.api.up(pointer(2, target, 'mouse', 0, 0, 25))
    pad.dispose(); piano.dispose()
  } finally { await server.close() }
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

test('arpeggiator follows transport subdivisions without restarting on note changes', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const music = await server.ssrLoadModule('/src/music.ts')
    let now = 100
    let nextId = 0
    const timers = new Map()
    const window = {
      setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id },
      clearTimeout: (id) => timers.delete(id),
      setInterval: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: now + delay, delay }); return id },
      clearInterval: (id) => timers.delete(id),
    }
    function advance(target) {
      while (true) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        const [id, timer] = due
        now = Math.max(now, timer.at)
        if (timer.delay === undefined) timers.delete(id)
        else timer.at += timer.delay
        timer.callback()
      }
      now = target
    }
    const props = vue.reactive({ label: 'Arp', bpm: 120, playing: true, transportClock: { position: () => now / 500 },
      notes: [], settings: { enabled: true, rate: '1/8', style: 'up', steps: 0, distance: 12, scale: 'chromatic', gate: 0.5 } })
    const arp = await setupComponent('Arpeggiator', props, { '../music': music }, { window })
    const attacks = () => arp.emitted.filter((event) => event.parameter === 'note' && event.on).map((event) => event.value)
    try {
      props.notes.push({ note: 60, count: 1, velocity: 80 })
      advance(150)
      props.notes.push({ note: 64, count: 1, velocity: 90 })
      advance(249)
      assert.deepEqual(attacks(), [])
      advance(250)
      assert.deepEqual(attacks(), [60])
      advance(300)
      props.notes.push({ note: 67, count: 1, velocity: 100 })
      assert.deepEqual(attacks(), [60])
      advance(500)
      assert.deepEqual(attacks(), [60, 64])

      advance(550)
      props.settings.rate = '1/4'
      advance(999)
      assert.deepEqual(attacks(), [60, 64])
      advance(1000)
      assert.deepEqual(attacks(), [60, 64, 60])
      props.playing = false
      assert.deepEqual(attacks(), [60, 64, 60, 60])
      advance(1100)
      props.notes.pop()
      assert.deepEqual(attacks(), [60, 64, 60, 60])
      advance(1500)
      assert.deepEqual(attacks(), [60, 64, 60, 60, 64])
      props.notes.splice(0)
      assert.equal(timers.size, 0)
    } finally { arp.dispose() }
  } finally { await server.close() }
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
    assert.equal(hit.settings.mode, 'trigger')
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
    assert.deepEqual(pad.emitted, [])
    send(60, undefined, 0.5)
    send(64, false)
    assert.deepEqual(calls.slice(2), [['bend', 'note:60', 0.5], ['off', 'note:64']])
    send(60, false)
    assert.deepEqual(calls.at(-1), ['off', 'note:60'])
    pad.api.handlePadOutput({ parameter: 'gate', value: 1 })
    pad.api.handlePadOutput({ parameter: 'gate', value: 0 })
    assert.deepEqual(pad.emitted.filter((event) => typeof event === 'number'), [60, 60])
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

test('numeric settings apply precise entries and clamp invalid values without snapping to knob steps', async () => {
  class Input {
    constructor(value) { this.value = value }
    get valueAsNumber() { return this.value === '' ? NaN : Number(this.value) }
  }
  const props = vue.reactive({ label: 'Volume', modelValue: -12, min: -48, max: 0, step: 1 })
  const numeric = await setupComponent('NumericSetting', props, {}, { HTMLInputElement: Input }, (event, value) => {
    if (event === 'update:modelValue') props.modelValue = value
  })
  try {
    const input = new Input('-12.35')
    numeric.api.updateInput({ target: input })
    assert.equal(props.modelValue, -12.35)
    input.value = '10'
    numeric.api.updateInput({ target: input })
    assert.equal(props.modelValue, -12.35)
    numeric.api.finishInput({ target: input })
    assert.equal(props.modelValue, 0)
    input.value = ''
    numeric.api.finishInput({ target: input })
    assert.equal(props.modelValue, 0)
    props.integer = true
    props.min = 1
    props.max = 16
    input.value = '3.7'
    numeric.api.finishInput({ target: input })
    assert.equal(props.modelValue, 4)
  } finally { numeric.dispose() }
})

test('instrument settings knobs update the live control and its sounding instrument', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}.ts`)
    }
    const calls = []
    class SampleHit {
      constructor(params) { this.params = { ...params } }
      updateParameters(params) { Object.assign(this.params, params); calls.push(params.volume) }
      trigger() {}
      release() {}
      dispose() {}
    }
    const instruments = { SampleHit, SampleLoop: class {}, Bass303: class {}, DrumKit: class {},
      InstrumentFactory: { create: (_, params) => new SampleHit(params) } }
    const item = dependencies['../grid'].createControl('hit', 0, 0, 'instrument-pad')
    const layout = vue.reactive({ columns: 1, rows: 1, items: [item], connections: [] })
    const tone = { start: async () => {} }
    const grid = await setupComponent('GrooveGrid', { layout, editing: true, wiring: false, settingsOpen: false, bpm: 120, playing: true },
      { ...dependencies, '../instruments': instruments, tone }, { setTimeout, clearTimeout })
    const pad = await setupComponent('InstrumentPad', vue.reactive({
      label: 'Hit', settings: vue.computed(() => grid.api.displayItems.value[0].settings), notes: [],
    }), { '../instruments': instruments, tone })
    try {
      pad.api.handlePadOutput({ parameter: 'gate', value: 1 })
      await new Promise((resolve) => setImmediate(resolve))
      grid.api.openSettings(layout.items[0])
      assert.equal(grid.api.selectedControl.value, layout.items[0])
      const numeric = await setupComponent('NumericSetting', {
        label: 'Volume', modelValue: -12, min: -48, max: 0, step: 0.01,
      }, {}, {}, (event, value) => {
        if (event === 'update:modelValue') grid.api.selectedControl.value.settings.instrumentParams.volume = value
      })
      try {
        numeric.api.updateKnob({ parameter: 'value', value: -7.25 })
        await vue.nextTick()
        assert.equal(layout.items[0].settings.instrumentParams.volume, -7.25)
        assert.equal(calls.at(-1), -7.25)
      } finally { numeric.dispose() }
    } finally { pad.dispose(); grid.dispose() }
  } finally { await server.close() }
})

test('armed loops record and replay control setting changes without mutating their saved values', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments', 'settingsAutomation']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const { createControl } = dependencies['../grid']
    const instrument = createControl('bass', 0, 0, 'instrument-pad', '303')
    const lfo = createControl('lfo', 1, 0, 'lfo')
    const loop = createControl('loop', 2, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.syncMode = 'immediate'
    const layout = vue.reactive({ columns: 3, rows: 1, items: [instrument, lfo, loop], connections: [] })
    let beat = 0
    const grid = await setupComponent('GrooveGrid', { layout, editing: true, wiring: false, settingsOpen: false,
      bpm: 120, playing: true, transportClock: { position: () => beat } }, dependencies,
    { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    const changes = []
    const dialog = await setupComponent('GridControlSettingsDialog',
      vue.reactive({ draft: layout.items[0], displayItem: vue.computed(() => grid.api.displayItems.value[0]),
        selectedId: 'bass', layout, bpm: 120, message: '' }), dependencies, {},
      (event, change) => {
        if (event === 'settingChange') { changes.push(change); grid.api.recordSettingChange('bass', change) }
      })
    const lfoDialog = await setupComponent('GridControlSettingsDialog',
      vue.reactive({ draft: layout.items[1], displayItem: vue.computed(() => grid.api.displayItems.value[1]),
        selectedId: 'lfo', layout, bpm: 120, message: '' }), dependencies, {},
      (event, change) => { if (event === 'settingChange') grid.api.recordSettingChange('lfo', change) })
    try {
      beat = 0.5
      layout.items[0].settings.instrumentParams.resonance = 8.25
      beat = 0.75
      layout.items[0].settings.instrumentParams.resonance = 12.5
      beat = 1
      layout.items[1].settings.waveform = 'square'
      grid.api.finishSettingChanges()
      assert.deepEqual(loop.settings.automation[0].map(({ sourceId, parameter, value, position }) =>
        [sourceId, parameter, value, position]), [
        ['bass', 'setting:instrument-pad:303:resonance', 8.25, 0.5],
        ['bass', 'setting:instrument-pad:303:resonance', 12.5, 0.75],
        ['lfo', 'setting:lfo:waveform', 2, 1],
      ])
      const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout }] }
      assert.equal(isSavedProject(JSON.parse(JSON.stringify(project))), true)
      loop.settings.armed = false
      layout.items[1].settings.waveform = 'random'
      const recordedChanges = changes.length
      beat = 4.5
      grid.api.loopEngine.tick()
      assert.equal(grid.api.displayItems.value[0].settings.instrumentParams.resonance, 8.25)
      assert.equal(dialog.api.liveItem.value.settings.instrumentParams.resonance, 8.25)
      assert.equal(layout.items[0].settings.instrumentParams.resonance, 12.5)
      assert.equal(changes.length, recordedChanges)
      dialog.api.liveItem.value.settings.instrumentParams.resonance = 12.5
      assert.equal(changes.length, recordedChanges + 1)
      assert.equal(grid.api.displayItems.value[0].settings.instrumentParams.resonance, 12.5)
      beat = 4.75
      grid.api.loopEngine.tick()
      assert.equal(grid.api.displayItems.value[0].settings.instrumentParams.resonance, 12.5)
      beat = 5
      grid.api.loopEngine.tick()
      assert.equal(grid.api.displayItems.value[1].settings.waveform, 'square')
      assert.equal(lfoDialog.api.liveItem.value.settings.waveform, 'square')
      assert.equal(layout.items[1].settings.waveform, 'random')
      grid.api.loopEngine.stop()
      assert.equal(grid.api.displayItems.value[0].settings.instrumentParams.resonance, 12.5)
    } finally { lfoDialog.dispose(); dialog.dispose(); grid.dispose() }
  } finally { await server.close() }
})

test('settings automation follows all-bank recording and replaces prior motion while held', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments', 'settingsAutomation', 'sequencedLoop']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const { createControl } = dependencies['../grid']
    const bass = createControl('bass', 0, 0, 'instrument-pad', '303')
    const loop = createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.recordScope = 'all'
    loop.settings.syncMode = 'immediate'
    loop.settings.automation[0].push(
      { bankId: 'A', sourceId: 'bass', parameter: 'setting:instrument-pad:303:volume', value: -20, position: 0.5 },
      { bankId: 'A', sourceId: 'bass', parameter: 'setting:instrument-pad:303:volume', value: -18, position: 1.5 },
    )
    const banks = vue.reactive([
      { id: 'A', layout: { columns: 1, rows: 1, items: [bass], connections: [] } },
      { id: 'B', layout: { columns: 1, rows: 1, items: [loop], connections: [] } },
    ])
    let beat = 0
    const bankEvents = new dependencies['../sequencedLoop'].BankEventBus()
    const common = { banks, bankEvents, editing: true, wiring: false, settingsOpen: false, bpm: 120,
      playing: true, transportClock: { position: () => beat } }
    const environment = { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} }
    const gridA = await setupComponent('GrooveGrid', { ...common, bankId: 'A', layout: banks[0].layout }, dependencies, environment)
    const gridB = await setupComponent('GrooveGrid', { ...common, bankId: 'B', layout: banks[1].layout }, dependencies, environment)
    try {
      beat = 0.75
      gridA.api.setSettingGesture(true)
      banks[0].layout.items[0].settings.instrumentParams.volume = -10
      gridA.api.recordSettingChange('bass', { id: 'setting:instrument-pad:303:volume', previous: -12, value: -10, continuous: true })
      beat = 1.5
      gridB.api.loopEngine.tick()
      assert.equal(gridA.api.displayItems.value[0].settings.instrumentParams.volume, -10)
      beat = 2
      banks[0].layout.items[0].settings.instrumentParams.volume = -8
      gridA.api.recordSettingChange('bass', { id: 'setting:instrument-pad:303:volume', previous: -10, value: -8, continuous: true })
      gridA.api.setSettingGesture(false)
      const events = loop.settings.automation[0]
      assert.equal(events.some((event) => event.position === 1.5 && event.value === -18), false)
      assert.ok(events.some((event) => event.position === 0.75 && event.value === -10 && event.bankId === 'A'))
      assert.ok(events.some((event) => event.position === 2 && event.value === -8 && event.bankId === 'A'))
      loop.settings.armed = false
      beat = 4.75
      gridB.api.loopEngine.tick()
      assert.equal(gridA.api.displayItems.value[0].settings.instrumentParams.volume, -10)
      beat = 6
      gridB.api.loopEngine.tick()
      assert.equal(gridA.api.displayItems.value[0].settings.instrumentParams.volume, -8)
      assert.equal(bass.settings.instrumentParams.volume, -8)
    } finally { gridA.dispose(); gridB.dispose() }
  } finally { await server.close() }
})

test('settings changes only record while playback is running and a loop is armed', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments', 'settingsAutomation']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const { createControl } = dependencies['../grid']
    const lfo = createControl('lfo', 0, 0, 'lfo')
    const loop = createControl('loop', 1, 0, 'sequenced-loop')
    const layout = vue.reactive({ columns: 2, rows: 1, items: [lfo, loop], connections: [] })
    const props = vue.reactive({ layout, editing: true, wiring: false, settingsOpen: false, bpm: 120,
      playing: false, transportClock: { position: () => 1 } })
    const grid = await setupComponent('GrooveGrid', props, dependencies,
      { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    const change = { id: 'setting:lfo:rate', previous: 1, value: 2, continuous: true }
    try {
      loop.settings.armed = true
      grid.api.recordSettingChange('lfo', change)
      assert.equal(loop.settings.automation[0].length, 0)
      props.playing = true
      loop.settings.armed = false
      grid.api.recordSettingChange('lfo', change)
      grid.api.finishSettingChanges()
      assert.equal(loop.settings.automation[0].length, 0)
      loop.settings.armed = true
      grid.api.recordSettingChange('lfo', change)
      grid.api.finishSettingChanges()
      assert.equal(loop.settings.automation[0].at(-1).value, 2)
    } finally { grid.dispose() }
  } finally { await server.close() }
})

test('editing automated knob and piano settings keeps their saved ranges valid', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments', 'settingsAutomation']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const { createControl, copyControl, validPianoRollSettings } = dependencies['../grid']
    const knob = vue.reactive(createControl('knob', 0, 0, 'knob'))
    Object.assign(knob.settings, { min: 100, max: 200, value: 150, defaultValue: 150 })
    const knobDisplay = copyControl(knob, knob.id)
    knobDisplay.settings.min = 0
    const piano = vue.reactive(createControl('piano', 0, 0, 'piano-roll'))
    piano.settings.octaves = 3
    piano.settings.numRows = 2
    const pianoDisplay = copyControl(piano, piano.id)
    pianoDisplay.settings.octaves = 1
    pianoDisplay.settings.numRows = 1
    const layout = vue.reactive({ columns: 1, rows: 1, items: [knob], connections: [] })
    const knobDialog = await setupComponent('GridControlSettingsDialog',
      vue.reactive({ draft: knob, displayItem: knobDisplay, selectedId: knob.id, layout, bpm: 120, message: '' }), dependencies)
    const knobPanel = await setupComponent('KnobSettingsPanel',
      { draft: knobDialog.api.liveItem.value, baseDraft: knob }, dependencies)
    const pianoDialog = await setupComponent('GridControlSettingsDialog',
      vue.reactive({ draft: piano, displayItem: pianoDisplay, selectedId: piano.id, layout, bpm: 120, message: '' }), dependencies)
    const pianoPanel = await setupComponent('PianoRollSettingsPanel',
      { draft: pianoDialog.api.liveItem.value, baseDraft: piano }, dependencies)
    try {
      knobPanel.api.setRange('max', 50)
      assert.equal(knob.settings.min, 0)
      assert.equal(knob.settings.max, 50)
      assert.equal(knob.settings.value, 50)
      pianoPanel.api.setNumber('numRows', 6)
      assert.equal(piano.settings.numRows, 6)
      assert.equal(piano.settings.octaves, 1)
      assert.equal(validPianoRollSettings(piano.settings), true)
    } finally { knobPanel.dispose(); knobDialog.dispose(); pianoPanel.dispose(); pianoDialog.dispose() }
  } finally { await server.close() }
})

test('startup loads the default project only when no saved project exists', async () => {
  const project = (id) => ({
    version: 1, bpm: 123, selectedBankId: id,
    banks: [{ id, title: id, icon: 'A', color: '#ffffff',
      layout: { columns: 4, rows: 4, items: [], connections: [] } }],
  })
  const defaultProject = project('default')
  const savedProject = project('saved')
  let stored
  let defaultLoads = 0
  let defaultError
  const app = await setupComponent('App', {}, {
    './defaultProject': { loadDefaultProject: async () => {
      defaultLoads++
      if (defaultError) throw defaultError
      return defaultProject
    } },
    './projectStorage': { loadStoredProject: async () => stored, saveStoredProject: async () => {} },
    './project': { DEFAULT_INFO_SCROLL_SPEED: 20 },
    './sampleAssets': { sampleAssetKey: Symbol('assets'), samplesInBanks: () => [] },
    './sequencedLoop': { BankEventBus: class {} },
    './composables/useTransport': { useTransport: () => ({}) },
  }, {
    localStorage: { getItem: () => null },
    window: { clearTimeout, setTimeout, removeEventListener() {} },
    document: { removeEventListener() {} },
  })
  try {
    await app.api.initializeStorage()
    assert.equal(app.api.selectedBank.value.id, 'default')
    assert.equal(defaultLoads, 1)

    stored = savedProject
    await app.api.initializeStorage()
    assert.equal(app.api.selectedBank.value.id, 'saved')
    assert.equal(defaultLoads, 1)
  } finally {
    app.dispose()
  }

  stored = undefined
  defaultError = new Error('template unavailable')
  const failed = await setupComponent('App', {}, {
    './defaultProject': { loadDefaultProject: async () => { throw defaultError } },
    './projectStorage': { loadStoredProject: async () => undefined, saveStoredProject: async () => {} },
    './project': { DEFAULT_INFO_SCROLL_SPEED: 20 },
    './sampleAssets': { sampleAssetKey: Symbol('assets'), samplesInBanks: () => [] },
    './sequencedLoop': { BankEventBus: class {} },
    './composables/useTransport': { useTransport: () => ({}) },
  }, {
    localStorage: { getItem: () => null },
    window: { clearTimeout, setTimeout, removeEventListener() {} },
    document: { removeEventListener() {} },
  })
  try {
    await failed.api.initializeStorage()
    assert.equal(failed.api.storageReady.value, true)
    assert.equal(failed.api.storageBlocked.value, true)
    assert.equal(failed.api.selectedBank.value, undefined)
    assert.match(failed.api.storageError.value, /Default project could not be loaded:.*template unavailable/)
  } finally {
    failed.dispose()
  }
})

test('beta startup leaves stable legacy project data untouched', async () => {
  const project = (id) => ({
    version: 1, bpm: 123, selectedBankId: id,
    banks: [{ id, title: id, icon: 'A', color: '#ffffff',
      layout: { columns: 4, rows: 4, items: [], connections: [] } }],
  })
  const legacy = JSON.stringify(project('stable'))
  const storage = new Map([['groovepad.project.v1', legacy]])
  const saved = []
  const app = await setupComponent('App', {}, {
    './appChannel': { isBeta: true },
    './defaultProject': { loadDefaultProject: async () => project('beta') },
    './projectStorage': { loadStoredProject: async () => undefined, saveStoredProject: async (value) => saved.push(value) },
    './project': { DEFAULT_INFO_SCROLL_SPEED: 20, migrateSavedProject: () => {}, isSavedProject: () => true },
    './sampleAssets': { sampleAssetKey: Symbol('assets'), samplesInBanks: () => [] },
    './sequencedLoop': { BankEventBus: class {} },
    './composables/useTransport': { useTransport: () => ({}) },
  }, {
    localStorage: { getItem: (key) => storage.get(key) ?? null, removeItem: (key) => storage.delete(key) },
    window: { clearTimeout, setTimeout, removeEventListener() {} },
    document: { removeEventListener() {} },
  })
  try {
    await app.api.initializeStorage()
    assert.equal(app.api.selectedBank.value.id, 'beta')
    assert.equal(storage.get('groovepad.project.v1'), legacy)
    assert.equal(saved.length, 0)
  } finally {
    app.dispose()
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
    grid.api.clickInteraction({ detail: 1 }, layout.items[0])
    assert.equal(grid.api.selectedControl.value, layout.items[0])
    grid.api.selectedId.value = null
    grid.api.startInteraction(start, layout.items[0], 'resize')
    grid.api.endInteraction(pointer(1, target, 'touch', 0.5, 100, 0))
    grid.api.clickInteraction({ detail: 1 }, layout.items[0])
    assert.equal(layout.items[0].width, 2)
    assert.equal(grid.api.selectedControl.value, null)
    grid.dispose()
  } finally {
    await server.close()
  }
})

test('copying an armed sequencer leaves the copy disarmed', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const loop = dependencies['../grid'].createControl('loop', 0, 0, 'sequenced-loop')
    loop.settings.armed = true
    const layout = vue.reactive({ columns: 2, rows: 1, items: [loop], connections: [] })
    const grid = await setupComponent('GrooveGrid', { layout, editing: true, wiring: false, settingsOpen: false, bpm: 120 },
      dependencies, { setTimeout, clearTimeout })
    try {
      grid.api.dropAction.value = { original: layout.items[0], candidate: { ...layout.items[0], x: 1 } }
      grid.api.completeDrop('copy')
      assert.equal(layout.items.length, 2)
      assert.equal(layout.items[0].settings.armed, true)
      assert.equal(layout.items[1].settings.armed, false)
    } finally { grid.dispose() }
  } finally { await server.close() }
})

test('arpeggiator toggles and LFO holds record and replay as control state', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments', 'lfo']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const { isSavedProject } = await server.ssrLoadModule('/src/project.ts')
    const { createControl } = dependencies['../grid']
    const arp = createControl('arp', 0, 0, 'arpeggiator')
    const lfo = createControl('lfo', 1, 0, 'lfo')
    const loop = createControl('loop', 2, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.syncMode = 'immediate'
    const layout = vue.reactive({ columns: 3, rows: 1, items: [arp, lfo, loop], connections: [] })
    let beat = 0
    const props = vue.reactive({ layout, editing: false, wiring: false, settingsOpen: false,
      bpm: 120, playing: true, transportClock: { position: () => beat } })
    const grid = await setupComponent('GrooveGrid', props, dependencies,
      { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    const oscillatorProps = vue.reactive({ label: 'LFO', settings: lfo.settings, bpm: 120,
      get automationHold() { return grid.api.lfoAutomationHold('lfo') } })
    const oscillator = await setupComponent('LFO', oscillatorProps, dependencies,
      { requestAnimationFrame: () => 1, cancelAnimationFrame() {} }, (event, value) => {
        if (event === 'hold-change') grid.api.recordToggle('lfo', 'hold', value)
      })
    try {
      oscillator.api.tick(1000)
      oscillator.api.tick(1100)
      beat = 0.5
      grid.api.toggleArpeggiator('arp')
      beat = 0.75
      oscillator.api.toggleHold()
      const phase = oscillator.api.phase.value
      oscillator.api.tick(1200)
      assert.equal(oscillator.api.phase.value, phase)
      beat = 1.25
      grid.api.toggleArpeggiator('arp')
      beat = 1.5
      oscillator.api.toggleHold()
      assert.deepEqual(loop.settings.automation[0].map(({ sourceId, parameter, value, position }) =>
        [sourceId, parameter, value, position]), [
        ['arp', 'enabled', 0, 0.5], ['lfo', 'hold', 1, 0.75],
        ['arp', 'enabled', 1, 1.25], ['lfo', 'hold', 0, 1.5],
      ])
      const project = { version: 1, bpm: 120, selectedBankId: 'A', banks: [{ id: 'A', title: 'A', icon: 'A', color: '#ffffff', layout }] }
      assert.equal(isSavedProject(JSON.parse(JSON.stringify(project))), true)
      loop.settings.armed = false
      beat = 4.5
      grid.api.loopEngine.tick()
      assert.equal(grid.api.displayItems.value[0].settings.enabled, false)
      assert.equal(arp.settings.enabled, true)
      beat = 4.75
      grid.api.loopEngine.tick()
      assert.equal(oscillator.api.held.value, true)
      oscillator.api.tick(1300)
      assert.equal(oscillator.api.phase.value, phase)
      oscillator.api.toggleHold()
      assert.equal(oscillator.api.held.value, false)
      grid.api.toggleArpeggiator('arp')
      assert.equal(grid.api.displayItems.value[0].settings.enabled, true)
      beat = 5.25
      grid.api.loopEngine.tick()
      assert.equal(grid.api.displayItems.value[0].settings.enabled, true)
      beat = 5.5
      grid.api.loopEngine.tick()
      assert.equal(oscillator.api.held.value, false)
      beat = 8.5
      grid.api.loopEngine.tick()
      assert.equal(grid.api.displayItems.value[0].settings.enabled, false)
      beat = 8.75
      grid.api.loopEngine.tick()
      assert.equal(oscillator.api.held.value, true)
      assert.equal(loop.settings.automation[0].length, 4)
      grid.api.loopEngine.stop()
      assert.equal(grid.api.lfoAutomationHold('lfo'), undefined)
    } finally { oscillator.dispose(); grid.dispose() }
  } finally { await server.close() }
})

test('recorded arpeggiator state remains subordinate to its on/off wire', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const { createControl } = dependencies['../grid']
    const pad = createControl('pad', 0, 0, 'pad')
    const arp = createControl('arp', 1, 0, 'arpeggiator')
    const loop = createControl('loop', 2, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.syncMode = 'immediate'
    loop.settings.automation[0].push({ sourceId: 'arp', parameter: 'enabled', value: 0, position: 0.5 })
    const layout = vue.reactive({ columns: 3, rows: 1, items: [pad, arp, loop], connections: [
      { id: 'wire', sourceId: 'pad', sourceParameter: 'gate', targetId: 'arp', targetParameter: 'enabled', mappingMode: 'abs' },
    ] })
    let beat = 0
    const grid = await setupComponent('GrooveGrid', { layout, editing: false, wiring: false, settingsOpen: false,
      bpm: 120, playing: true, transportClock: { position: () => beat } }, dependencies,
    { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    try {
      loop.settings.armed = false
      grid.api.handleOutput(pad, { parameter: 'gate', value: 1 })
      beat = 0.5
      grid.api.loopEngine.tick()
      assert.equal(grid.api.displayItems.value[1].settings.enabled, true)
      grid.api.handleOutput(pad, { parameter: 'gate', value: 0, active: false })
      assert.equal(grid.api.displayItems.value[1].settings.enabled, false)
      assert.equal(arp.settings.enabled, true)
    } finally { grid.dispose() }
  } finally { await server.close() }
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
      grid.api.handleOutput(layout.items[0], { parameter: 'value', value: 65, delta: 1, user: true, pointer: true })
      assert.equal(loop.settings.automation[0].length, 0)
      layout.items[0].settings.value = 64
      grid.api.controlActivity('knob', true)
      grid.api.handleOutput(layout.items[0], { parameter: 'value', value: 65, delta: 1, user: true, pointer: true })
      beat = 0.75
      grid.api.handleOutput(layout.items[0], { parameter: 'value', value: 70, delta: 5, user: true, pointer: true })
      assert.deepEqual(loop.settings.automation[0].map((event) => event.value), [65, 70])
      grid.api.controlActivity('knob', false)
      layout.items[1].settings.armed = false
      layout.items[0].settings.value = 10
      beat = 4.5
      grid.api.loopEngine.tick()
      assert.equal(grid.api.displayItems.value[0].settings.value, 65)
      grid.api.controlActivity('knob', true)
      grid.api.handleOutput(grid.api.displayItems.value[0], { parameter: 'value', value: 75, delta: 10, user: true, pointer: true })
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

test('only active pointer drags record while an LFO moves knobs', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments', 'lfo']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const { createControl } = dependencies['../grid']
    const lfo = createControl('lfo', 0, 0, 'lfo')
    const knob = createControl('knob', 1, 0, 'knob')
    const other = createControl('other', 2, 0, 'knob')
    const loop = createControl('loop', 3, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.syncMode = 'immediate'
    const layout = vue.reactive({ columns: 4, rows: 1, items: [lfo, knob, other, loop], connections: [
      { id: 'wire', sourceId: 'lfo', sourceParameter: 'value', targetId: 'knob', targetParameter: 'value' },
      { id: 'wire2', sourceId: 'lfo', sourceParameter: 'value', targetId: 'other', targetParameter: 'value' },
    ] })
    let beat = 0
    const grid = await setupComponent('GrooveGrid', { layout, editing: false, wiring: false, settingsOpen: false,
      bpm: 120, playing: true, transportClock: { position: () => beat } }, dependencies,
    { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    const knobProps = vue.reactive({ label: 'Knob', settings: grid.api.displayItems.value[1].settings })
    const knobComponent = await setupComponent('Knob', knobProps, {}, {}, (event, output) => {
      if (event === 'activity') grid.api.controlActivity('knob', output)
      else if (event === 'output') grid.api.handleOutput(grid.api.displayItems.value[1], output)
    })
    const oscillator = await setupComponent('LFO', { label: 'LFO', settings: lfo.settings, bpm: 120 }, dependencies,
      { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} }, (event, output) => {
        if (event === 'output') grid.api.handleOutput(grid.api.displayItems.value[0], output)
      })
    try {
      grid.api.toggleLoop('loop')
      oscillator.api.tick(1000)
      oscillator.api.tick(1100)
      assert.notEqual(grid.api.displayItems.value[1].settings.value, knob.settings.value)
      assert.notEqual(grid.api.displayItems.value[2].settings.value, other.settings.value)
      assert.equal(loop.settings.automation[0].length, 0)

      knobProps.settings = grid.api.displayItems.value[1].settings
      const target = new Element(0)
      knobComponent.api.start(pointer(1, target, 'touch', 0.5, 50, 50))
      oscillator.api.tick(1200)
      knobComponent.api.move(pointer(2, target, 'touch', 0.5, 60, 50))
      grid.api.handleOutput(grid.api.displayItems.value[2],
        { parameter: 'value', value: 70, delta: 1, user: true, pointer: true })
      knobComponent.api.wheel({ deltaX: 0, deltaY: -10 })
      knobComponent.api.keyDown({ key: 'ArrowUp', preventDefault() {} })
      assert.equal(loop.settings.automation[0].length, 0)

      beat = 0.5
      knobComponent.api.move(pointer(1, target, 'touch', 0.5, 60, 50))
      assert.deepEqual(loop.settings.automation[0].map((event) => event.sourceId), ['knob'])
      knobComponent.api.end(pointer(1, target, 'touch', 0, 60, 50))
      knobComponent.api.move(pointer(1, target, 'touch', 0.5, 70, 50))
      oscillator.api.tick(1300)
      assert.equal(loop.settings.automation[0].length, 1)

      knobComponent.api.start(pointer(3, target, 'touch', 0.5, 50, 50))
      knobComponent.api.end(pointer(3, target, 'touch', 0, 50, 50))
      knobComponent.api.move(pointer(3, target, 'touch', 0.5, 60, 50))
      beat = 4.5
      grid.api.loopEngine.tick()
      assert.equal(loop.settings.automation[0].length, 1)
    } finally { oscillator.dispose(); knobComponent.dispose(); grid.dispose() }
  } finally { await server.close() }
})

test('separate knob and wheel gestures retain their final recorded values', async () => {
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
    loop.settings.armed = true
    loop.settings.syncMode = 'immediate'
    const layout = vue.reactive({ columns: 3, rows: 1, items: [knob, wheel, loop], connections: [] })
    let beat = 0
    const grid = await setupComponent('GrooveGrid', { layout, editing: false, wiring: false, settingsOpen: false,
      bpm: 120, playing: true, transportClock: { position: () => beat } }, dependencies,
    { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    try {
      grid.api.controlActivity('knob', true)
      for (const value of [65, 66, 67]) {
        beat += 0.01
        grid.api.handleOutput(layout.items[0], { parameter: 'value', value, delta: 1, user: true, pointer: true })
      }
      grid.api.controlActivity('knob', false)
      grid.api.controlActivity('knob', true)
      beat += 0.01
      grid.api.handleOutput(layout.items[0], { parameter: 'value', value: 68, delta: 1, user: true, pointer: true })
      grid.api.controlActivity('knob', false)
      grid.api.controlActivity('wheel', true)
      grid.api.handleOutput(layout.items[1], { parameter: 'value', value: 0.8, user: true })
      beat += 0.01
      grid.api.handleOutput(layout.items[1], { parameter: 'value', value: 0.5, user: true })
      grid.api.controlActivity('wheel', false)
      assert.deepEqual(loop.settings.automation[0].map((event) => [event.sourceId, event.value]),
        [['knob', 65], ['knob', 67], ['knob', 68], ['wheel', 0.8], ['wheel', 0.5]])
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
    ], mutedRows: [], instruments: [sources[0]], sources, barLength: 1 })
    const music = await server.ssrLoadModule('/src/music.ts')
    const loopRows = await server.ssrLoadModule('/src/loopRows.ts')
    const editor = await setupComponent('SequenceEditor', props, { '../music': music, '../loopRows': loopRows },
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
    const firstArp = createControl('arp', 2, 0, 'arpeggiator')
    const secondArp = createControl('arp', 2, 0, 'arpeggiator')
    firstArp.settings.enabled = false
    const lfo = createControl('lfo', 3, 0, 'lfo')
    const layoutA = vue.reactive({ columns: 3, rows: 1, items: [loop, firstKnob, firstArp], connections: [] })
    const layoutB = vue.reactive({ columns: 4, rows: 1, items: [secondKnob, pad, secondArp, lfo], connections: [] })
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
      gridB.api.toggleArpeggiator('arp')
      assert.equal(loop.settings.automation[0].length, 0)
      layoutA.items[0].settings.recordScope = 'all'
      beat = 0.5
      gridB.api.captureNote('pad', 60, true, 100)
      beat = 0.75
      gridB.api.captureNote('pad', 60, false, 100)
      gridB.api.controlActivity('control-1', true)
      gridB.api.handleOutput(layoutB.items[0], { parameter: 'value', value: 65, delta: 1, user: true, pointer: true })
      gridB.api.controlActivity('control-1', false)
      assert.equal(loop.settings.clips[0][0].bankId, 'B')
      assert.equal(loop.settings.automation[0][0].bankId, 'B')
      beat = 0.9
      gridB.api.toggleArpeggiator('arp')
      gridB.api.recordToggle('lfo', 'hold', true)
      assert.deepEqual(loop.settings.automation[0].slice(1).map((event) => [event.bankId, event.parameter, event.value]),
        [['B', 'enabled', 1], ['B', 'hold', 1]])
      secondArp.settings.enabled = false
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
      beat = 4.9
      gridA.api.loopEngine.tick()
      assert.equal(gridB.api.displayItems.value[2].settings.enabled, true)
      assert.equal(gridA.api.displayItems.value[2].settings.enabled, false)
      assert.equal(gridA.api.lfoAutomationHold('lfo'), undefined)
      assert.equal(gridB.api.lfoAutomationHold('lfo'), true)
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
      props.editing = true
      assert.equal(grid.api.loopEngine.isEnabled('loop'), true)
      props.editing = false
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

test('edit mode preserves loop notes, automation, and transport timing', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const { createControl } = dependencies['../grid']
    const pad = createControl('pad', 0, 0, 'instrument-pad', '808')
    const knob = createControl('knob', 1, 0, 'knob')
    const loop = createControl('loop', 2, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.syncMode = 'immediate'
    loop.settings.clips[0] = [
      { instrumentId: 'pad', note: 60, velocity: 100, position: 0, duration: 1.5 },
      { instrumentId: 'pad', note: 62, velocity: 100, position: 2, duration: 0.5 },
    ]
    loop.settings.automation[0] = [
      { sourceId: 'knob', parameter: 'value', value: 20, position: 0 },
      { sourceId: 'knob', parameter: 'value', value: 90, position: 1 },
    ]
    const layout = vue.reactive({ columns: 3, rows: 1, items: [pad, knob, loop], connections: [] })
    let beat = 0
    let tick
    let timerStarts = 0
    const props = vue.reactive({ layout, editing: false, wiring: false, settingsOpen: false, bpm: 120, playing: true,
      transportClock: { position: () => beat } })
    const grid = await setupComponent('GrooveGrid', props, dependencies,
      { setTimeout, clearTimeout, setInterval: (callback) => { tick = callback; return ++timerStarts }, clearInterval: () => {} })
    try {
      assert.equal(grid.api.recordedNotes('pad')[0].note, 60)
      assert.equal(grid.api.displayItems.value[1].settings.value, 20)
      props.editing = true
      assert.equal(grid.api.recordedNotes('pad')[0].note, 60)
      assert.equal(timerStarts, 1)
      beat = 1
      tick()
      assert.equal(grid.api.displayItems.value[1].settings.value, 90)
      beat = 1.5
      tick()
      assert.equal(grid.api.recordedNotes('pad').length, 0)
      beat = 2
      tick()
      assert.equal(grid.api.recordedNotes('pad')[0].note, 62)
      props.editing = false
      assert.equal(grid.api.recordedNotes('pad')[0].note, 62)
      assert.equal(timerStarts, 1)
      beat = 2.5
      tick()
      assert.equal(grid.api.recordedNotes('pad').length, 0)
      props.editing = true
      props.playing = false
      props.playing = true
      assert.equal(grid.api.loopEngine.isEnabled('loop'), true)
      assert.equal(timerStarts, 2)
    } finally { grid.dispose() }
  } finally { await server.close() }
})

test('global metronome follows playback and can be toggled without an armed loop', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const gridModule = await server.ssrLoadModule('/src/grid.ts')
    const loopModule = await server.ssrLoadModule('/src/sequencedLoop.ts')
    let position = 0
    class Clock {
      start() { position = 0 }
      stop() {}
      setTempo() {}
      position() { return position }
    }
    const clicks = []
    class Synth {
      connect() { return this }
      triggerAttackRelease(note) { clicks.push(note) }
      dispose() {}
    }
    const intervals = new Map()
    let timerId = 0
    const window = {
      setInterval: (fn, delay) => { intervals.set(++timerId, { fn, delay }); return timerId },
      clearInterval: (id) => intervals.delete(id),
      clearTimeout: () => {},
      setTimeout: () => 1,
      removeEventListener: () => {},
    }
    const app = await setupComponent('App', {}, {
      './grid': gridModule,
      './sequencedLoop': { ...loopModule, TransportClock: Clock },
      tone: { start: async () => {}, Synth, getContext: () => ({ rawContext: { destination: {} } }) },
      './sampleAssets': { sampleAssetKey: Symbol('assets'), samplesInBanks: () => [] },
    }, { window, document: { removeEventListener: () => {} }, localStorage: { getItem: () => null, setItem: () => {} }, console })
    try {
      const loop = gridModule.createControl('loop', 0, 0, 'sequenced-loop')
      loop.settings.armed = true
      loop.settings.metronome = true
      app.api.banks.value.push({ id: 'A', title: 'A', icon: 'A', color: '#ffffff',
        layout: { columns: 1, rows: 1, items: [loop], connections: [] } })
      await app.api.togglePlayback()
      assert.deepEqual(clicks, [])
      loop.settings.armed = false
      app.api.metronomeEnabled.value = true
      const tick = () => [...intervals.values()].filter((timer) => timer.delay === 20).forEach((timer) => timer.fn())
      position = 1
      tick()
      assert.deepEqual(clicks, ['G5'])
      app.api.selectedBankId.value = 'B'
      position = 2
      tick()
      assert.deepEqual(clicks, ['G5', 'G5'])
      app.api.metronomeEnabled.value = false
      position = 3
      tick()
      assert.deepEqual(clicks, ['G5', 'G5'])
      app.api.metronomeEnabled.value = true
      position = 4
      tick()
      assert.deepEqual(clicks, ['G5', 'G5', 'C6'])
      await app.api.togglePlayback()
      assert.equal(intervals.size, 0)
      await app.api.togglePlayback()
      assert.deepEqual(clicks, ['G5', 'G5', 'C6', 'C6'])
    } finally { app.dispose() }
  } finally { await server.close() }
})

test('transport count-in precedes playback while input start bypasses it', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const gridModule = await server.ssrLoadModule('/src/grid.ts')
    const loopModule = await server.ssrLoadModule('/src/sequencedLoop.ts')
    let position = 0
    class Clock {
      start() { position = 0 }
      stop() {}
      setTempo() {}
      position() { return position }
    }
    const clicks = []
    class Synth {
      connect() { return this }
      triggerAttackRelease(note) { clicks.push(note) }
      dispose() {}
    }
    const intervals = new Map()
    let timerId = 0
    const window = {
      setInterval: (fn) => { intervals.set(++timerId, fn); return timerId },
      clearInterval: (id) => intervals.delete(id),
      clearTimeout: () => {},
      setTimeout: () => 1,
      removeEventListener: () => {},
    }
    const app = await setupComponent('App', {}, {
      './grid': gridModule,
      './sequencedLoop': { ...loopModule, TransportClock: Clock },
      tone: { start: async () => {}, Synth, getContext: () => ({ rawContext: { destination: {} } }) },
      './sampleAssets': { sampleAssetKey: Symbol('assets'), samplesInBanks: () => [] },
    }, { window, document: { removeEventListener: () => {} }, localStorage: { getItem: () => null, setItem: () => {} }, console })
    try {
      const loop = gridModule.createControl('loop', 0, 0, 'sequenced-loop')
      loop.settings.armed = true
      loop.settings.countIn = true
      loop.settings.metronome = false
      app.api.banks.value.push({ id: 'A', title: 'A', icon: 'A', color: '#ffffff',
        layout: { columns: 1, rows: 1, items: [loop], connections: [] } })
      assert.equal(await app.api.startFromInput('B'), false)
      assert.equal(await app.api.startFromInput('A'), true)
      assert.equal(app.api.playing.value, true)
      assert.equal(app.api.triggeredByInput.value, true)
      assert.deepEqual(clicks, [])
      await app.api.togglePlayback()
      await app.api.togglePlayback()
      assert.equal(app.api.playing.value, false)
      assert.equal(app.api.countingIn.value, true)
      for (position = 1; position <= 4; position++) [...intervals.values()].forEach((tick) => tick())
      assert.equal(app.api.playing.value, true)
      assert.equal(app.api.countingIn.value, false)
      assert.deepEqual(clicks, ['C6', 'G5', 'G5', 'G5'])
      await app.api.togglePlayback()
      await app.api.togglePlayback()
      assert.equal(app.api.countingIn.value, true)
      await app.api.togglePlayback()
      assert.equal(app.api.countingIn.value, false)
      assert.equal(intervals.size, 0)
      const importedLoop = gridModule.createControl('imported', 0, 0, 'sequenced-loop')
      importedLoop.settings.armed = true
      app.api.addImportedBank({ id: 'X', title: 'Imported', icon: 'X', color: '#ffffff',
        layout: { columns: 1, rows: 1, items: [importedLoop], connections: [] } })
      assert.equal(loop.settings.armed, true)
      assert.equal(app.api.banks.value.at(-1).layout.items[0].settings.armed, false)
    } finally { app.dispose() }
  } finally { await server.close() }
})

test('transport start aligns armed and playback loops across banks', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const { BankEventBus } = await server.ssrLoadModule('/src/sequencedLoop.ts')
    const { createControl } = dependencies['../grid']
    for (const triggeredByInput of [false, true]) {
      const armed = createControl('armed', 0, 0, 'sequenced-loop')
      const playing = createControl('playing', 0, 0, 'sequenced-loop')
      const stopped = createControl('stopped', 2, 0, 'sequenced-loop')
      const padA = createControl('pad-a', 1, 0, 'instrument-pad')
      const padB = createControl('pad-b', 1, 0, 'instrument-pad')
      armed.settings.armed = true
      armed.settings.countIn = true
      armed.settings.syncMode = 'sync'
      playing.settings.syncMode = 'sync'
      stopped.settings.syncMode = 'sync'
      armed.settings.clips[0] = [{ instrumentId: 'pad-a', note: 60, velocity: 100, position: 0, duration: 0.2 }]
      playing.settings.clips[0] = [{ instrumentId: 'pad-b', note: 62, velocity: 100, position: 0, duration: 0.2 }]
      const layoutA = vue.reactive({ columns: 2, rows: 1, items: [armed, padA], connections: [] })
      const layoutB = vue.reactive({ columns: 3, rows: 1, items: [playing, padB, stopped], connections: [] })
      let beat = 0.1
      const common = { editing: false, wiring: false, settingsOpen: false, bpm: 120, playing: false,
        triggeredByInput, transportStartImmediate: true, transportClock: { position: () => beat }, bankEvents: new BankEventBus() }
      const propsA = vue.reactive({ ...common, bankId: 'A', layout: layoutA })
      const propsB = vue.reactive({ ...common, bankId: 'B', layout: layoutB })
      const environment = { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} }
      const gridA = await setupComponent('GrooveGrid', propsA, dependencies, environment)
      const gridB = await setupComponent('GrooveGrid', propsB, dependencies, environment)
      try {
        gridB.api.toggleLoopPlayback('playing')
        propsA.playing = true
        propsB.playing = true
        assert.equal(gridA.api.loopEngine.isCounting('armed'), false)
        assert.equal(gridB.api.loopEngine.isPending('playing'), false)
        assert.equal(gridB.api.loopEngine.isEnabled('stopped'), false)
        assert.equal(gridA.api.recordedNotes('pad-a')[0].note, 60)
        assert.equal(gridB.api.recordedNotes('pad-b')[0].note, 62)

        beat = 0.21
        gridA.api.loopEngine.tick()
        gridB.api.loopEngine.tick()
        assert.equal(gridA.api.recordedNotes('pad-a').length, 0)
        assert.equal(gridB.api.recordedNotes('pad-b').length, 0)
        gridB.api.toggleLoopPlayback('playing')
        gridB.api.toggleLoopPlayback('playing')
        assert.equal(gridB.api.loopEngine.isPending('playing'), true)
      } finally { gridA.dispose(); gridB.dispose() }
    }
    const mountedLoop = createControl('mounted', 0, 0, 'sequenced-loop')
    const mountedPad = createControl('mounted-pad', 1, 0, 'instrument-pad')
    mountedLoop.settings.armed = true
    mountedLoop.settings.clips[0] = [{ instrumentId: 'mounted-pad', note: 65, velocity: 100, position: 0, duration: 0.2 }]
    const layout = vue.reactive({ columns: 2, rows: 1, items: [mountedLoop, mountedPad], connections: [] })
    const grid = await setupComponent('GrooveGrid', { layout, editing: false, wiring: false, settingsOpen: false,
      bpm: 120, playing: true, transportStartImmediate: true, transportClock: { position: () => 1 } }, dependencies,
    { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    try { assert.equal(grid.api.recordedNotes('mounted-pad')[0].note, 65) } finally { grid.dispose() }
  } finally { await server.close() }
})

test('armed loops start on a piano hit and capture the first routed note', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    dependencies.tone = { start: async () => {} }
    const { createControl } = dependencies['../grid']
    const piano = createControl('piano', 0, 0, 'piano-roll')
    const selector = createControl('selector', 1, 0, 'output-selector')
    const pad = createControl('pad', 2, 0, 'instrument-pad', '808')
    const loop = createControl('loop', 3, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.countIn = true
    const layout = vue.reactive({ columns: 4, rows: 1, items: [piano, selector, pad, loop], connections: [
      { id: 'one', sourceId: 'piano', sourceParameter: 'note', targetId: 'selector', targetParameter: 'note' },
      { id: 'two', sourceId: 'selector', sourceParameter: 'note', targetId: 'pad', targetParameter: 'note' },
    ] })
    let beat = 0
    let starts = 0
    let finishStart
    const props = vue.reactive({ layout, editing: false, wiring: false, settingsOpen: false, bpm: 120, playing: false,
      transportStartImmediate: true, triggeredByInput: true, transportClock: { position: () => beat },
      startOnInput: () => { starts++; return new Promise((resolve) => { finishStart = resolve }) } })
    const grid = await setupComponent('GrooveGrid', props, dependencies,
      { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    try {
      grid.api.handleOutput(piano, { parameter: 'note', value: 64, on: true, velocity: 90 }, true)
      assert.equal(starts, 1)
      props.playing = true
      finishStart(true)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(grid.api.loopEngine.isEnabled('loop'), true)
      assert.equal(grid.api.loopEngine.isCounting('loop'), false)
      beat = 0.5
      grid.api.handleOutput(piano, { parameter: 'note', value: 64, on: false, velocity: 90 }, true)
      assert.equal(loop.settings.clips[0].length, 1)
      assert.equal(loop.settings.clips[0][0].instrumentId, 'piano')
      assert.equal(loop.settings.clips[0][0].note, 64)
      assert.equal(loop.settings.clips[0][0].duration, 0.5)
      grid.api.toggleLoopPlayback('loop')
      beat = 1
      grid.api.handleOutput(piano, { parameter: 'note', value: 65, on: true, velocity: 90 }, true)
      assert.equal(grid.api.loopEngine.isEnabled('loop'), true)
      assert.equal(grid.api.loopEngine.isCounting('loop'), false)
      grid.api.handleOutput(piano, { parameter: 'note', value: 65, on: false, velocity: 90 }, true)
    } finally { grid.dispose() }
  } finally { await server.close() }
})

test('piano notes record their source and replay through its arpeggiator', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    dependencies.tone = { start: async () => {} }
    const { createControl } = dependencies['../grid']
    const piano = createControl('piano', 0, 0, 'piano-roll')
    const selector = createControl('selector', 1, 0, 'output-selector')
    const arp = createControl('arp', 2, 0, 'arpeggiator')
    const pad = createControl('pad', 3, 0, 'instrument-pad')
    const loop = createControl('loop', 4, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.syncMode = 'immediate'
    const layout = vue.reactive({ columns: 5, rows: 1, items: [piano, selector, arp, pad, loop], connections: [
      { id: 'one', sourceId: 'piano', sourceParameter: 'note', targetId: 'selector', targetParameter: 'note' },
      { id: 'two', sourceId: 'selector', sourceParameter: 'note', targetId: 'arp', targetParameter: 'note' },
      { id: 'three', sourceId: 'arp', sourceParameter: 'note', targetId: 'pad', targetParameter: 'note' },
    ] })
    let beat = 0
    const grid = await setupComponent('GrooveGrid', { layout, editing: false, wiring: false, settingsOpen: false,
      bpm: 120, playing: true, transportClock: { position: () => beat } }, dependencies,
    { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    const arpProps = vue.reactive({ label: 'Arp', settings: arp.settings, bpm: 120,
      notes: vue.computed(() => grid.api.receivedNotes('arp')) })
    const window = { setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {} }
    const arpeggiator = await setupComponent('Arpeggiator', arpProps, dependencies, { window }, (event, output) => {
      if (event === 'output') grid.api.handleOutput(arp, output)
    })
    try {
      grid.api.toggleLoop('loop')
      beat = 0.25
      grid.api.handleOutput(piano, { parameter: 'note', value: 64, on: true, velocity: 90 }, true)
      assert.equal(grid.api.receivedNotes('pad')[0].note, 64)
      beat = 0.75
      grid.api.handleOutput(piano, { parameter: 'note', value: 64, on: false, velocity: 90 }, true)
      assert.equal(loop.settings.clips[0].length, 1)
      assert.equal(loop.settings.clips[0][0].instrumentId, 'piano')
      assert.equal(loop.settings.clips[0][0].duration, 0.5)

      beat = 4.25
      grid.api.loopEngine.tick()
      assert.equal(grid.api.receivedNotes('arp')[0].note, 64)
      assert.equal(grid.api.receivedNotes('pad')[0].note, 64)
      grid.api.routeNote('piano', { parameter: 'note', value: 64, on: true, velocity: 90 })
      assert.equal(grid.api.receivedNotes('arp')[0].count, 2)
      grid.api.routeNote('piano', { parameter: 'note', value: 64, on: false, velocity: 90 })
      assert.equal(grid.api.receivedNotes('arp')[0].count, 1)
      beat = 4.75
      grid.api.loopEngine.tick()
      assert.equal(grid.api.receivedNotes('arp').length, 0)
      assert.equal(grid.api.receivedNotes('pad').length, 0)
      assert.equal(loop.settings.clips[0].length, 1)
    } finally { arpeggiator.dispose(); grid.dispose() }
  } finally { await server.close() }
})

test('a drum hit released during transport startup is still recorded', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const { createControl } = dependencies['../grid']
    const pad = createControl('pad', 0, 0, 'instrument-pad', '808')
    const loop = createControl('loop', 1, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.countIn = true
    const layout = vue.reactive({ columns: 2, rows: 1, items: [pad, loop], connections: [] })
    let finishStart
    let starts = 0
    const props = vue.reactive({ layout, editing: false, wiring: false, settingsOpen: false, bpm: 120, playing: false,
      transportStartImmediate: true, triggeredByInput: true, transportClock: { position: () => 0 },
      startOnInput: () => { starts++; return new Promise((resolve) => { finishStart = resolve }) } })
    const grid = await setupComponent('GrooveGrid', props, dependencies,
      { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    try {
      grid.api.handleOutput(pad, { parameter: 'gate', value: 1 }, true)
      grid.api.captureNote('pad', 60, true, 100)
      grid.api.handleOutput(pad, { parameter: 'gate', value: 0 }, true)
      grid.api.captureNote('pad', 60, false, 100)
      assert.equal(starts, 1)
      props.playing = true
      finishStart(true)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(loop.settings.clips[0].length, 1)
      assert.equal(grid.api.loopEngine.isCounting('loop'), false)
    } finally { grid.dispose() }
  } finally { await server.close() }
})

test('arming a sequencer disarms other banks without stopping their playback', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const { createControl } = dependencies['../grid']
    const first = createControl('loop', 0, 0, 'sequenced-loop')
    const second = createControl('other', 1, 0, 'sequenced-loop')
    const remote = createControl('loop', 0, 0, 'sequenced-loop')
    const layoutA = { columns: 2, rows: 1, items: [first, second], connections: [] }
    const layoutB = { columns: 1, rows: 1, items: [remote], connections: [] }
    const banks = vue.reactive([{ id: 'A', layout: layoutA }, { id: 'B', layout: layoutB }])
    const common = { banks, editing: false, wiring: false, settingsOpen: false, bpm: 120, playing: true,
      transportClock: { position: () => 0 } }
    const environment = { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} }
    const gridA = await setupComponent('GrooveGrid', { ...common, bankId: 'A', layout: banks[0].layout }, dependencies, environment)
    const gridB = await setupComponent('GrooveGrid', { ...common, bankId: 'B', layout: banks[1].layout }, dependencies, environment)
    try {
      gridA.api.armLoop('loop')
      assert.equal(first.settings.armed, true)
      assert.equal(gridA.api.loopEngine.isEnabled('loop'), true)
      gridB.api.armLoop('loop')
      assert.equal(first.settings.armed, false)
      assert.equal(remote.settings.armed, true)
      assert.equal(gridA.api.loopEngine.isEnabled('loop'), true)

      gridA.api.selectedId.value = second.id
      gridA.api.setLoopArmed(banks[0].layout.items[1], true)
      assert.equal(banks[0].layout.items[1].settings.armed, true)
      assert.equal(remote.settings.armed, false)
      gridA.api.armLoop('loop')
      assert.equal(first.settings.armed, true)
      assert.equal(banks[0].layout.items[1].settings.armed, false)
      gridA.api.armLoop('loop')
      assert.equal(first.settings.armed, false)
      gridA.api.armLoop('other')
      assert.equal(banks[0].layout.items[1].settings.armed, true)
    } finally { gridA.dispose(); gridB.dispose() }
  } finally { await server.close() }
})

test('loop arm and play controls operate independently while the transport runs', async () => {
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
      grid.api.toggleLoopPlayback('loop')
      assert.equal(loop.settings.playing, true)
      assert.equal(grid.api.loopEngine.isEnabled('loop'), false)

      props.playing = true
      assert.equal(grid.api.loopEngine.isEnabled('loop'), true)
      grid.api.toggleLoopPlayback('loop')
      assert.equal(grid.api.loopEngine.isEnabled('loop'), false)
      grid.api.toggleLoopPlayback('loop')
      assert.equal(grid.api.loopEngine.isEnabled('loop'), true)

      grid.api.armLoop('loop')
      assert.equal(loop.settings.armed, true)
      grid.api.armLoop('loop')
      assert.equal(loop.settings.armed, false)
      assert.equal(grid.api.loopEngine.isEnabled('loop'), true)
      props.playing = false
      assert.equal(grid.api.loopEngine.isEnabled('loop'), false)
      assert.equal(loop.settings.playing, true)
      grid.api.toggleLoopPlayback('loop')
      assert.equal(loop.settings.playing, false)

      loop.settings.clips['0'] = [{ instrumentId: 'pad', note: 60, velocity: 100, position: 0, duration: 1 }]
      loop.settings.automation['0'] = [{ sourceId: 'knob', parameter: 'value', value: 64, position: 0 }]
      loop.settings.clips['1'] = [{ instrumentId: 'pad', note: 62, velocity: 90, position: 1, duration: 1 }]
      grid.api.clearLoopClip('loop')
      assert.equal(loop.settings.clips['0'].length, 0)
      assert.equal(loop.settings.automation['0'].length, 0)
      assert.equal(loop.settings.clips['1'].length, 1)
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
      grid.api.controlActivity('knob', true)
      grid.api.controlActivity('wheel', true)
      grid.api.handleOutput(layout.items[0], { parameter: 'value', value: 66, delta: 1, user: true, pointer: true })
      grid.api.handleOutput(layout.items[1], { parameter: 'value', value: 0.5, user: true })
      grid.api.controlActivity('knob', false)
      grid.api.controlActivity('wheel', false)
      assert.equal(loop.settings.automation[0].length, 2)
    } finally { grid.dispose() }
  } finally { await server.close() }
})

test('instrument hits do not record unconnected gates, but wired gates remain recordable', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    const { createControl } = dependencies['../grid']
    const drum = createControl('drum', 0, 0, 'instrument-pad', '808')
    const knob = createControl('knob', 1, 0, 'knob')
    const loop = createControl('loop', 2, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.syncMode = 'immediate'
    const layout = vue.reactive({ columns: 3, rows: 1, items: [drum, knob, loop], connections: [] })
    let beat = 0
    const grid = await setupComponent('GrooveGrid', { layout, editing: false, wiring: false, settingsOpen: false,
      bpm: 120, playing: true, transportClock: { position: () => beat } }, dependencies,
    { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    try {
      grid.api.handleOutput(drum, { parameter: 'gate', value: 1 }, true)
      grid.api.captureNote('drum', 60, true, 100)
      beat = 0.5
      grid.api.handleOutput(drum, { parameter: 'gate', value: 0 }, true)
      grid.api.captureNote('drum', 60, false, 100)
      assert.equal(loop.settings.clips[0].length, 1)
      assert.equal(loop.settings.automation[0].length, 0)

      layout.connections.push({ id: 'gate-wire', sourceId: 'drum', sourceParameter: 'gate',
        targetId: 'knob', targetParameter: 'value' })
      beat = 1
      grid.api.handleOutput(drum, { parameter: 'gate', value: 1 }, true)
      beat = 1.5
      grid.api.handleOutput(drum, { parameter: 'gate', value: 0 }, true)
      assert.deepEqual(loop.settings.automation[0].map((event) => [event.parameter, event.value]), [['gate', 1], ['gate', 0]])
    } finally { grid.dispose() }
  } finally { await server.close() }
})

test('note velocity is retained but velocity automation requires a connection', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const dependencies = {}
    for (const name of ['grid', 'parameters', 'modulation', 'music', 'instruments']) {
      dependencies[`../${name}`] = await server.ssrLoadModule(`/src/${name}${name === 'instruments' ? '/index' : ''}.ts`)
    }
    dependencies.tone = { start: async () => {} }
    const { createControl } = dependencies['../grid']
    const piano = createControl('piano', 0, 0, 'piano-roll')
    const drum = createControl('drum', 1, 0, 'instrument-pad')
    const pad = createControl('pad', 2, 0, 'pad')
    const knob = createControl('knob', 3, 0, 'knob')
    const loop = createControl('loop', 4, 0, 'sequenced-loop')
    loop.settings.armed = true
    loop.settings.syncMode = 'immediate'
    const layout = vue.reactive({ columns: 5, rows: 1, items: [piano, drum, pad, knob, loop], connections: [] })
    let beat = 0
    const grid = await setupComponent('GrooveGrid', { layout, editing: false, wiring: false, settingsOpen: false,
      bpm: 120, playing: true, transportClock: { position: () => beat } }, dependencies,
    { setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} })
    try {
      grid.api.handleOutput(piano, { parameter: 'pressure', value: 83, active: true }, true)
      grid.api.handleOutput(piano, { parameter: 'velocity', value: 83 }, true)
      grid.api.handleOutput(piano, { parameter: 'note', value: 64, on: true, velocity: 83 }, true)
      grid.api.handleOutput(drum, { parameter: 'velocity', value: 97 }, true)
      grid.api.handleOutput(drum, { parameter: 'gate', value: 1 }, true)
      grid.api.captureNote('drum', 60, true, 97)
      grid.api.handleOutput(pad, { parameter: 'velocity', value: 75 }, true)
      grid.api.handleOutput(pad, { parameter: 'gate', value: 1 }, true)
      beat = 0.5
      grid.api.handleOutput(piano, { parameter: 'note', value: 64, on: false, velocity: 83 }, true)
      grid.api.handleOutput(piano, { parameter: 'pressure', value: 0, active: false }, true)
      grid.api.handleOutput(drum, { parameter: 'gate', value: 0 }, true)
      grid.api.captureNote('drum', 60, false, 97)
      grid.api.handleOutput(pad, { parameter: 'gate', value: 0 }, true)
      assert.deepEqual(loop.settings.clips[0].map((note) => [note.instrumentId, note.velocity]),
        [['piano', 83], ['drum', 97]])
      assert.equal(loop.settings.automation[0].length, 0)
      assert.equal(grid.api.signals.get('piano:velocity'), 83)

      for (const sourceId of ['piano', 'drum', 'pad']) layout.connections.push({
        id: `${sourceId}-velocity`, sourceId, sourceParameter: 'velocity', targetId: 'knob', targetParameter: 'value',
      })
      grid.api.handleOutput(piano, { parameter: 'velocity', value: 81 }, true)
      grid.api.handleOutput(drum, { parameter: 'velocity', value: 91 }, true)
      grid.api.handleOutput(pad, { parameter: 'velocity', value: 71 }, true)
      grid.api.handleOutput(drum, { parameter: 'velocity', value: 55 })
      assert.deepEqual(loop.settings.automation[0].map((event) => [event.sourceId, event.value]),
        [['piano', 81], ['drum', 91], ['pad', 71]])
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
      grid.api.handleOutput(piano, { parameter: 'pressure', value: 75, active: true, user: true }, true)
      assert.equal(grid.api.signals.has('piano:pressure'), false)
      assert.equal(loop.settings.automation[0].length, 0)

      layout.connections.push({
        id: 'pressure-wire', sourceId: 'piano', sourceParameter: 'pressure',
        targetId: 'knob', targetParameter: 'value',
      })
      grid.api.handleOutput(piano, { parameter: 'pressure', value: 75, active: true, user: true }, true)
      assert.equal(grid.api.signals.get('piano:pressure'), 75)
      assert.equal(loop.settings.automation[0].length, 1)

      grid.api.handleOutput(piano, { parameter: 'pressure', value: 0, active: false, user: true }, true)
      assert.equal(grid.api.signals.has('piano:pressure'), false)
      assert.equal(loop.settings.automation[0].length, 2)
    } finally { grid.dispose() }
  } finally { await server.close() }
})
