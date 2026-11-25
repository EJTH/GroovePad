<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import type { PadSettings, ParameterOutput, RepeatDivision } from '../../grid'
import type { TransportClock } from '../../sequencedLoop'
import { useNoteRepeat } from '../useNoteRepeat'
import { ExpressionTracker } from '../../expression'

const props = defineProps<{ label: string; settings: PadSettings; wiredActive?: boolean; rotated?: boolean; inputMuted?: boolean; repeatDivision?: RepeatDivision; bpm?: number; playing?: boolean; transportClock?: TransportClock }>()
const emit = defineEmits<{ output: [output: ParameterOutput] }>()
const pointerId = ref<number | null>(null)
const keyboardPressed = ref(false)
const expression = new ExpressionTracker()
const positionFullAt = 0.6
const minVelocity = 0.1;
const repeat = useNoteRepeat({
  division: () => props.repeatDivision, bpm: () => props.bpm ?? 120, playing: () => props.playing,
  clock: () => props.transportClock, send: (_value: number, on) => emit('output', { parameter: 'gate', value: on ? 1 : 0 }),
})
function gate(on: boolean) { repeat.change('gate', 1, on) }

function pointerExpression(event: PointerEvent, target: HTMLElement) {
  return expression.updatePointer(event.pointerId, event, target.getBoundingClientRect(), props.rotated ? 'x' : 'y',
    props.rotated, true, positionFullAt, minVelocity)
}

function beginPress(event: PointerEvent, target: HTMLElement, beforePress?: () => void) {
  if (pointerId.value !== null || keyboardPressed.value || (target instanceof HTMLButtonElement && target.disabled)) return
  beforePress?.()
  target.setPointerCapture(event.pointerId)
  pointerId.value = event.pointerId
  const velocity = pointerExpression(event, target)
  emit('output', { parameter: 'velocity', value: velocity })
  emit('output', { parameter: 'pressure', value: velocity })
  gate(true)
}

function press(event: PointerEvent) {
  if ((event.pointerType !== 'touch' && event.button !== 0) || !(event.currentTarget instanceof HTMLElement)) return
  if (pointerId.value !== null || keyboardPressed.value) return
  event.preventDefault()
  beginPress(event, event.currentTarget)
}

function swipe(event: Event) {
  if (!(event instanceof CustomEvent) || !(event.currentTarget instanceof HTMLElement)) return
  const { pointer, releasePrevious } = event.detail as { pointer: PointerEvent; releasePrevious: () => void }
  beginPress(pointer, event.currentTarget, releasePrevious)
}

function move(event: PointerEvent) {
  if (pointerId.value !== event.pointerId || !(event.currentTarget instanceof HTMLElement)) return
  const grid = event.currentTarget.closest('.groove-grid')
  const target = event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest('.pad')
  if (grid && target instanceof HTMLElement && target !== event.currentTarget && target.closest('.groove-grid') === grid) {
    target.dispatchEvent(new CustomEvent('pad-swipe', { detail: { pointer: event, releasePrevious: () => release(event) } }))
    if (pointerId.value !== event.pointerId) return
  }
  emit('output', { parameter: 'pressure', value: pointerExpression(event, event.currentTarget) })
}

function release(event: PointerEvent) {
  if (pointerId.value !== event.pointerId) return
  pointerId.value = null
  expression.remove(event.pointerId)
  emit('output', { parameter: 'pressure', value: expression.pressure, active: false })
  gate(false)
}

function keyDown(event: KeyboardEvent) {
  if ((event.key !== ' ' && event.key !== 'Enter') || event.repeat || pointerId.value !== null) return
  event.preventDefault()
  keyboardPressed.value = true
  expression.set('keyboard', 100)
  emit('output', { parameter: 'velocity', value: 100 })
  emit('output', { parameter: 'pressure', value: 100 })
  gate(true)
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
  emit('output', { parameter: 'pressure', value: expression.pressure, active: false })
  gate(false)
}

onBeforeUnmount(() => {
  if (pointerId.value !== null || keyboardPressed.value) {
    emit('output', { parameter: 'pressure', value: 0, active: false })
    gate(false)
  }
})
</script>

<template>
  <button
    type="button"
    class="pad mpc-surface"
    :class="{ active: pointerId !== null || keyboardPressed || wiredActive, 'input-muted': inputMuted }"
    :style="{ '--mpc-color': settings.color }"
    :aria-label="inputMuted === undefined ? `Pad: ${label}` : `Pad: ${label}, input connections ${inputMuted ? 'muted' : 'unmuted'}`"
    :aria-pressed="inputMuted ?? (pointerId !== null || keyboardPressed)"
    :title="inputMuted === undefined ? undefined : `Input connections ${inputMuted ? 'muted' : 'unmuted'}`"
    @pointerdown="press"
    @pad-swipe="swipe"
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
  text-overflow: ellipsis;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
}

.pad.input-muted {
  border-color: #777970;
  background: #353631;
  color: #c2c3bb;
  box-shadow: inset 0 2px 6px #0006;
}
</style>
