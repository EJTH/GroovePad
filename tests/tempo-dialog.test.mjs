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
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module, exports: module.exports,
    require: (path) => path === 'vue' ? vue : path === '../project'
      ? { MIN_INFO_SCROLL_SPEED: 1, MAX_INFO_SCROLL_SPEED: 100 } : { default: {} },
    performance: { now: () => now },
  })
  const events = []
  const api = module.exports.default.setup({ bpm: 120, infoText: 'Project notes', infoScrollSpeed: 20 }, { expose() {}, emit: (...args) => events.push(args) })
  return { api, events, tap: (time) => { now = time; api.tapTempo() } }
}

test('tap tempo averages recent intervals and starts a new sequence after a long pause', async () => {
  const { api, tap } = await createDialog()
  tap(0)
  assert.equal(api.draft.value, 120)
  tap(500)
  assert.equal(api.draft.value, 120)
  tap(1100)
  assert.equal(api.draft.value, 109.09)
  tap(1600)
  tap(2100)
  tap(2600)
  assert.equal(api.draft.value, 114.29)
  tap(63000)
  assert.equal(api.draft.value, 114.29)
  tap(64000)
  assert.equal(api.draft.value, 60)
})

test('tap tempo rejects overly fast taps and saves only valid precise values', async () => {
  const { api, events, tap } = await createDialog()
  tap(0)
  tap(100)
  assert.match(api.error.value, /between 1 and 300/)
  assert.equal(api.draft.value, 120)
  tap(300)
  assert.equal(api.draft.value, 300)
  assert.equal(api.error.value, '')
  api.draft.value = 127.35
  assert.equal(api.infoDraft.value, 'Project notes')
  api.infoDraft.value = '  Updated   notes  '
  api.speedDraft.value = 12.5
  api.saveTempo()
  assert.deepEqual(events, [['save', 127.35, '  Updated   notes  ', 12.5]])
  api.draft.value = 301
  api.saveTempo()
  assert.equal(events.length, 1)
  assert.match(api.error.value, /between 1 and 300/)
  api.draft.value = 120
  for (const speed of [0, 101, NaN]) {
    api.speedDraft.value = speed
    api.saveTempo()
    assert.equal(events.length, 1)
    assert.match(api.error.value, /between 1 and 100/)
  }
})
