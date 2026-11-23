<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { KnobSettings, ParameterOutput } from '../grid'

const props = defineProps<{ label: string; settings: KnobSettings; emitInitial?: boolean; rotated?: boolean }>()
const emit = defineEmits<{ output: [output: ParameterOutput]; activity: [active: boolean] }>()
const pointerId = ref<number | null>(null)
let lastY = 0
let lastX = 0
let dragValue = 0
let lastDragValue = 0
const rotation = computed(() => props.settings.max === props.settings.min
  ? 0
  : (props.settings.value - props.settings.min) / (props.settings.max - props.settings.min) * 270 - 135)
const displayedValue = computed(() => Number(props.settings.value.toPrecision(10)).toString())

function setValue(value: number, previous = props.settings.value): number {
  const { min, max, step } = props.settings
  const snapped = min + Math.round((value - min) / step) * step
  const next = Number(Math.max(min, Math.min(max, snapped)).toPrecision(12))
  if (next !== previous) emit('output', { parameter: 'value', value: next, delta: next - previous, user: true })
  return next
}

function start(event: PointerEvent) {
  if (event.button !== 0 || pointerId.value !== null) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  event.preventDefault()
  target.setPointerCapture(event.pointerId)
  pointerId.value = event.pointerId
  emit('activity', true)
  lastX = event.clientX
  lastY = event.clientY
  dragValue = props.settings.value
  lastDragValue = dragValue
}

function move(event: PointerEvent) {
  if (pointerId.value !== event.pointerId) return
  const horizontal = event.clientX - lastX
  const vertical = props.rotated ? event.clientY - lastY : lastY - event.clientY
  const distance = Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical
  lastX = event.clientX
  lastY = event.clientY
  const { min, max } = props.settings
  dragValue = Math.max(min, Math.min(max, dragValue + distance / 100 * (max - min)))
  lastDragValue = setValue(dragValue, lastDragValue)
}

function wheel(event: WheelEvent) {
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ? event.deltaX : props.rotated ? event.deltaY : -event.deltaY
  if (delta !== 0) setValue(props.settings.value + Math.sign(delta) * props.settings.step)
}

function end(event: PointerEvent) {
  if (pointerId.value === event.pointerId) { pointerId.value = null; emit('activity', false) }
}

function keyDown(event: KeyboardEvent) {
  if (event.key === 'ArrowUp' || event.key === 'ArrowRight') setValue(props.settings.value + props.settings.step)
  else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') setValue(props.settings.value - props.settings.step)
  else if (event.key === 'Home') setValue(props.settings.min)
  else if (event.key === 'End') setValue(props.settings.max)
  else return
  event.preventDefault()
}
onMounted(() => {
  if (props.emitInitial) emit('output', { parameter: 'value', value: props.settings.value })
})
</script>

<template>
  <div class="knob" :style="{ '--knob-color': settings.color }">
    <div
      class="knob-control"
      role="slider"
      tabindex="0"
      :aria-label="label"
      :aria-valuemin="settings.min"
      :aria-valuemax="settings.max"
      :aria-valuenow="settings.value"
      :aria-valuetext="`${displayedValue}${settings.unit}`"
      @pointerdown="start"
      @pointermove="move"
      @pointerup="end"
      @pointercancel="end"
      @lostpointercapture="end"
      @keydown="keyDown"
      @wheel.prevent="wheel"
    >
      <span class="indicator" :style="{ transform: `rotate(${rotation}deg)` }"></span>
      <span class="value">{{ displayedValue }}{{ settings.unit }}</span>
    </div>
    <span class="label">{{ label }}</span>
  </div>
</template>

<style scoped>
.knob {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 4px;
  container-type: size;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.knob-control {
  position: relative;
  width: min(100cqw, max(0px, calc(100cqh - 18px)), 100px);
  aspect-ratio: 1;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 2px solid var(--knob-color);
  border-radius: 50%;
  background: #30392b;
  color: #e2edd9;
  touch-action: none;
  cursor: move;
}

.knob-control:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.indicator {
  position: absolute;
  inset: 5px;
  pointer-events: none;
}

.indicator::before {
  content: '';
  position: absolute;
  top: 0;
  left: calc(50% - 1px);
  width: 2px;
  height: 15%;
  background: var(--knob-color);
}

.value, .label {
  max-width: 100%;
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.label {
  flex: 0 0 auto;
  color: var(--muted);
  line-height: 14px;
}
</style>
