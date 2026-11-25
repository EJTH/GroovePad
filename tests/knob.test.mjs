import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'

test('knob drag uses at least 100 pixels for its range, or more when steps require it', async () => {
  const source = await readFile(new URL('../src/components/UI/Knob.vue', import.meta.url), 'utf8')
  const script = compileScript(parse(source).descriptor, { id: 'knob' }).content
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const componentModule = { exports: {} }
  class Element { setPointerCapture() {} }
  vm.runInNewContext(code, { module: componentModule, exports: componentModule.exports, HTMLElement: Element,
    require: (path) => path === 'vue' ? { ...vue, onMounted() {} } : {} })

  function drag(min, max, step, positions) {
    const outputs = []
    const settings = { color: '', min, max, value: min, step, unit: '' }
    const component = componentModule.exports.default.setup({ label: '', settings }, {
      expose() {},
      emit: (event, output) => { if (event === 'output') outputs.push(output) },
    })
    component.start({ button: 0, currentTarget: new Element(), pointerId: 1, clientX: 0, clientY: 0, preventDefault() {} })
    for (const x of positions) component.move({ pointerId: 1, clientX: x, clientY: 0 })
    return outputs.map((output) => output.value)
  }

  assert.deepEqual(drag(0, 2, 1, [20, 30, 60, 80, 100]), [1, 2])
  assert.deepEqual(drag(0, 127, 1, [20, 100, 127]), [20, 100, 127])
  assert.deepEqual(drag(-1, 1, 0.01, [20, 100, 200]), [-0.8, 0, 1])
  assert.deepEqual(drag(0, 2, 1, [150, 100]), [2, 1])
})
