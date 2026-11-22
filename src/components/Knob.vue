<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { KnobSettings, ParameterOutput } from '../grid'

const props = defineProps<{ label: string; settings: KnobSettings; emitInitial?: boolean }>()
const emit = defineEmits<{ output: [output: ParameterOutput] }>()
const pointerId = ref<number | null>(null)
let startY = 0
let startValue = 0
const rotation = computed(() => props.settings.max === props.settings.min
  ? 0
  : (props.settings.value - props.settings.min) / (props.settings.max - props.settings.min) * 270 - 135)
const displayedValue = computed(() => Number(props.settings.value.toPrecision(10)).toString())

function setValue(value: number) {
  const { min, max, step } = props.settings
  const snapped = min + Math.round((value - min) / step) * step
  const next = Number(Math.max(min, Math.min(max, snapped)).toPrecision(12))
  if (next !== props.settings.value) emit('output', { parameter: 'value', value: next })
}

function start(event: PointerEvent) {
  if (event.button !== 0 || pointerId.value !== null) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  event.preventDefault()
  target.setPointerCapture(event.pointerId)
  pointerId.value = event.pointerId
  startY = event.clientY
  startValue = props.settings.value
}

function move(event: PointerEvent) {
  if (pointerId.value !== event.pointerId) return
  setValue(startValue + (startY - event.clientY) / 100 * (props.settings.max - props.settings.min))
}

function end(event: PointerEvent) {
  if (pointerId.value === event.pointerId) pointerId.value = null
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
      @wheel.prevent="setValue(settings.value + ($event.deltaY < 0 ? settings.step : -settings.step))"
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
  cursor: ns-resize;
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
