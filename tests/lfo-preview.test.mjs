import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import { createServer } from 'vite'

test('shared waveform reflects the LFO settings and phase', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { default: Waveform } = await server.ssrLoadModule('/src/components/widgets/LFOWaveform.vue')
    const settings = { waveform: 'square', rateMode: 'free', rate: 1, depth: 0.5, offset: 0.25, smoothness: 0 }
    const render = (phase) => renderToString(vue.createSSRApp({
      render: () => vue.h(Waveform, { settings, phase }),
    }))
    let html = await render(0.25)
    assert.match(html, /d="M 0 12\.5 L 1\.5625 12\.5/)
    assert.match(html, /L 50 62\.5/)
    assert.match(html, /transform="translate\(-25 0\)"/)
    settings.waveform = 'saw'
    settings.offset = 1
    html = await render(0)
    assert.match(html, /d="M 0 25 L 1\.5625 24\.21875/)
    assert.match(html, /L 50 0/)
  } finally {
    await server.close()
  }
})

test('LFO preview animation follows draft rate and tempo', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const lfo = await server.ssrLoadModule('/src/lfo.ts')
    const pointerTap = await server.ssrLoadModule('/src/pointerTap.ts')
    const source = await readFile(new URL('../src/components/widgets/LFO.vue', import.meta.url), 'utf8')
    const script = compileScript(parse(source).descriptor, { id: 'lfo' }).content
    const { outputText } = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
    let mounted
    let unmounted
    let frame
    let cancelled
    const vueMock = { ...vue, onMounted: (callback) => { mounted = callback }, onBeforeUnmount: (callback) => { unmounted = callback } }
    const module = { exports: {} }
    vm.runInNewContext(outputText, { module, exports: module.exports,
      require: (path) => path === 'vue' ? vueMock : path === '../../lfo' ? lfo : path === '../../pointerTap' ? pointerTap : { default: {} },
      requestAnimationFrame: (callback) => { frame = callback; return 42 },
      cancelAnimationFrame: (id) => { cancelled = id },
    })
    const props = vue.reactive({ label: 'Preview', bpm: 120,
      settings: { waveform: 'sine', rateMode: 'free', rate: 1, depth: 1, offset: 0, smoothness: 0 } })
    const output = []
    const api = module.exports.default.setup(props, { expose() {}, emit: (event, value) => {
      if (event === 'output') output.push(value)
    } })
    mounted()
    frame(100)
    frame(200)
    assert.ok(Math.abs(api.phase - 0.1) < 1e-10)
    assert.ok(Math.abs(output.at(-1).value - Math.sin(0.2 * Math.PI)) < 1e-10)
    frame(300)
    assert.equal(output.length, 2)
    props.settings.rateMode = 'sync'
    frame(400)
    assert.ok(Math.abs(api.phase - 0.4) < 1e-10)
    assert.equal(output.length, 3)
    unmounted()
    assert.equal(cancelled, 42)
  } finally {
    await server.close()
  }
})
