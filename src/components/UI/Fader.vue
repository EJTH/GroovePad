<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{ label: string; value: number; min?: number; max?: number }>(), {
  min: -60,
  max: 6,
})
const emit = defineEmits<{ change: [value: number] }>()
const pointer = ref<number | null>(null)
const displayed = computed(() => `${props.value > 0 ? '+' : ''}${props.value.toFixed(1)} dB`)

function setValue(value: number) {
  const next = Math.max(props.min, Math.min(props.max, Math.round(value * 10) / 10))
  if (next !== props.value) emit('change', next)
}
function move(event: PointerEvent) {
  if (event.pointerId !== pointer.value) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  const rect = target.getBoundingClientRect()
  if (!rect.height) return
  const position = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height))
  setValue(props.min + position * (props.max - props.min))
}
function start(event: PointerEvent) {
  if (pointer.value !== null || event.button !== 0) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  event.preventDefault()
  target.setPointerCapture(event.pointerId)
  pointer.value = event.pointerId
  move(event)
}
function end(event: PointerEvent) {
  if (event.pointerId === pointer.value) pointer.value = null
}
function keyDown(event: KeyboardEvent) {
  if (event.key === 'ArrowUp' || event.key === 'ArrowRight') setValue(props.value + 1)
  else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') setValue(props.value - 1)
  else if (event.key === 'Home') setValue(props.min)
  else if (event.key === 'End') setValue(props.max)
  else return
  event.preventDefault()
}
const position = computed(() => (props.value - props.min) / (props.max - props.min))
</script>

<template>
  <div class="fader">
    <div class="track" role="slider" tabindex="0" :aria-label="label" :aria-valuemin="min" :aria-valuemax="max"
      :aria-valuenow="value" :aria-valuetext="displayed"
      @pointerdown="start" @pointermove="move" @pointerup="end" @pointercancel="end"
      @lostpointercapture="end" @keydown="keyDown">
      <span class="meter" :style="{ height: `${position * 100}%` }"></span>
      <span class="thumb" :style="{ bottom: `${position * 100}%` }"></span>
    </div>
    <small>{{ displayed }}</small>
  </div>
</template>

<style scoped>
.fader { width: 100%; min-width: 0; min-height: 0; flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.track { position: relative; width: min(100%, 24px); min-height: 16px; flex: 1; border: 1px solid #536149; border-radius: 3px; background: #171816; touch-action: none; }
.track:focus-visible { outline: 2px solid var(--accent); }
.meter { position: absolute; bottom: 0; left: 0; width: 100%; background: #536149; }
.thumb { position: absolute; left: -3px; width: calc(100% + 6px); height: 5px; transform: translateY(50%); border-radius: 2px; background: var(--accent); }
small { max-width: 100%; color: var(--muted); font-size: 8px; line-height: 10px; white-space: nowrap; }
</style>
