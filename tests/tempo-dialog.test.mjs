import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'

async function createDialog() {
  const source = await readFile(new URL('../src/components/TempoDialog.vue', import.meta.url), 'utf8')
  const script = compileScript(parse(source).descriptor, { id: 'tempo' }).content
  const { outputText } = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
  let now = 0
  class Input {
    constructor(value) { this.value = value }
    get valueAsNumber() { return this.value === '' ? NaN : Number(this.value) }
  }
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module, exports: module.exports,
    require: (path) => path === 'vue' ? vue : path === '../project'
      ? { MIN_INFO_SCROLL_SPEED: 1, MAX_INFO_SCROLL_SPEED: 100 } : { default: {} },
    performance: { now: () => now },
    HTMLInputElement: Input,
  })
  const events = []
  const props = { bpm: 120, infoText: 'Project notes', infoScrollSpeed: 20 }
  const api = module.exports.default.setup(props, { expose() {}, emit: (...args) => {
    events.push(args)
    if (args[0].startsWith('update:')) props[args[0].slice(7)] = args[1]
  } })
  return { api, events, props, Input, tap: (time) => { now = time; api.tapTempo() } }
}

test('tap tempo averages recent intervals and starts a new sequence after a long pause', async () => {
  const { props, tap } = await createDialog()
  tap(0)
  assert.equal(props.bpm, 120)
  tap(500)
  assert.equal(props.bpm, 120)
  tap(1100)
  assert.equal(props.bpm, 109.09)
  tap(1600)
  tap(2100)
  tap(2600)
  assert.equal(props.bpm, 114.29)
  tap(63000)
  assert.equal(props.bpm, 114.29)
  tap(64000)
  assert.equal(props.bpm, 60)
})

test('tap tempo applies changes immediately and rejects overly fast taps', async () => {
  const { api, props, tap } = await createDialog()
  tap(0)
  tap(100)
  assert.match(api.error.value, /between 1 and 300/)
  assert.equal(props.bpm, 120)
  tap(300)
  assert.equal(props.bpm, 300)
  assert.equal(api.error.value, '')
})

test('project settings retain precise input and clamp invalid numbers on blur', async () => {
  const { api, props, Input } = await createDialog()
  const tempo = new Input('127.35')
  api.updateNumber({ target: tempo }, 'bpm')
  assert.equal(props.bpm, 127.35)
  tempo.value = '400'
  api.updateNumber({ target: tempo }, 'bpm', true)
  assert.equal(props.bpm, 300)
  const speed = new Input('')
  api.updateNumber({ target: speed }, 'speed', true)
  assert.equal(speed.value, '20')
  speed.value = '-2'
  api.updateNumber({ target: speed }, 'speed', true)
  assert.equal(props.infoScrollSpeed, 1)
})
