<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import type { PadSettings, ParameterOutput } from '../grid'
import { ExpressionTracker } from '../expression'

defineProps<{ label: string; settings: PadSettings; wiredActive?: boolean }>()
const emit = defineEmits<{ output: [output: ParameterOutput] }>()
const pointerId = ref<number | null>(null)
const keyboardPressed = ref(false)
const expression = new ExpressionTracker()

function press(event: PointerEvent) {
  if (event.button !== 0 || pointerId.value !== null || keyboardPressed.value) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  event.preventDefault()
  target.setPointerCapture(event.pointerId)
  pointerId.value = event.pointerId
  const velocity = expression.updatePointer(event.pointerId, event, target.getBoundingClientRect())
  emit('output', { parameter: 'velocity', value: velocity })
  emit('output', { parameter: 'pressure', value: velocity })
  emit('output', { parameter: 'gate', value: 1 })
}

function move(event: PointerEvent) {
  if (pointerId.value !== event.pointerId || !(event.currentTarget instanceof HTMLElement)) return
  emit('output', { parameter: 'pressure', value: expression.updatePointer(event.pointerId, event, event.currentTarget.getBoundingClientRect()) })
}

function release(event: PointerEvent) {
  if (pointerId.value !== event.pointerId) return
  pointerId.value = null
  expression.remove(event.pointerId)
  emit('output', { parameter: 'pressure', value: expression.pressure })
  emit('output', { parameter: 'gate', value: 0 })
}

function keyDown(event: KeyboardEvent) {
  if ((event.key !== ' ' && event.key !== 'Enter') || event.repeat || pointerId.value !== null) return
  event.preventDefault()
  keyboardPressed.value = true
  expression.set('keyboard', 100)
  emit('output', { parameter: 'velocity', value: 100 })
  emit('output', { parameter: 'pressure', value: 100 })
  emit('output', { parameter: 'gate', value: 1 })
}

function keyUp(event: KeyboardEvent) {
  if ((event.key !== ' ' && event.key !== 'Enter') || !keyboardPressed.value) return
  event.preventDefault()
  releaseKeyboard()
}

function releaseKeyboard() {
  if (!keyboardPressed.value) return
  keyboardPressed.value = false
  expression.remove('keyboard')
  emit('output', { parameter: 'pressure', value: expression.pressure })
  emit('output', { parameter: 'gate', value: 0 })
}

onBeforeUnmount(() => {
  if (pointerId.value !== null || keyboardPressed.value) {
    emit('output', { parameter: 'pressure', value: 0 })
    emit('output', { parameter: 'gate', value: 0 })
  }
})
</script>

<template>
  <button
    type="button"
    class="pad"
    :class="{ active: pointerId !== null || keyboardPressed || wiredActive }"
    :style="{ '--pad-color': settings.color }"
    :aria-label="`Pad: ${label}`"
    :aria-pressed="pointerId !== null || keyboardPressed"
    @pointerdown="press"
    @pointermove="move"
    @pointerup="release"
    @pointercancel="release"
    @lostpointercapture="release"
    @keydown="keyDown"
    @keyup="keyUp"
    @blur="releaseKeyboard"
  >{{ label }}</button>
</template>

<style scoped>
.pad {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 8px;
  overflow: hidden;
  border: 2px solid var(--pad-color);
  border-radius: 6px;
  background: color-mix(in srgb, var(--pad-color) 75%, #171816);
  color: #171816;
  font-weight: 700;
  text-overflow: ellipsis;
  touch-action: none;
  cursor: pointer;
}

.pad.active {
  background: var(--pad-color);
  box-shadow: inset 0 2px 6px #0006;
}
</style>
