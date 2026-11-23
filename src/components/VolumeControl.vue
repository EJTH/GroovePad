<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ label: string; color: string; value: number; muted: boolean }>()
const emit = defineEmits<{ change: [value: number]; mute: [] }>()
const pointer = ref<number | null>(null)
let x = 0
let y = 0
let dragValue = 0
function set(next: number) { emit('change', Math.round(Math.max(0, Math.min(1, next)) * 100) / 100) }
function down(event: PointerEvent) {
  if (event.button !== 0 || pointer.value !== null || !(event.currentTarget instanceof HTMLElement)) return
  event.preventDefault()
  event.currentTarget.setPointerCapture(event.pointerId)
  pointer.value = event.pointerId
  x = event.clientX; y = event.clientY; dragValue = props.value
}
function move(event: PointerEvent) {
  if (event.pointerId !== pointer.value) return
  const dx = event.clientX - x, dy = y - event.clientY
  dragValue = Math.max(0, Math.min(1, dragValue + (Math.abs(dx) >= Math.abs(dy) ? dx : dy) / 100))
  x = event.clientX; y = event.clientY
  set(dragValue)
}
function end(event: PointerEvent) { if (pointer.value === event.pointerId) pointer.value = null }
function key(event: KeyboardEvent) {
  if (event.key === 'Home') set(0)
  else if (event.key === 'End') set(1)
  else if (event.key === 'ArrowUp' || event.key === 'ArrowRight') set(props.value + 0.01)
  else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') set(props.value - 0.01)
  else return
  event.preventDefault()
}
</script>

<template>
  <div class="volume-tile" :style="{ '--volume-color': color, '--volume-level': `${value * 100}%` }">
    <div class="volume-slider" role="slider" tabindex="0" :aria-label="`${label} volume`"
      aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(value * 100)"
      @pointerdown="down" @pointermove="move" @pointerup="end" @pointercancel="end" @lostpointercapture="end"
      @keydown="key" @wheel.prevent="set(value + ($event.deltaY < 0 ? 0.01 : -0.01))">
      <span>{{ label }}</span><small>{{ Math.round(value * 100) }}%</small>
    </div>
    <button class="volume-mute" type="button" :aria-label="`${muted ? 'Unmute' : 'Mute'} ${label}`"
      :aria-pressed="muted" @click="emit('mute')">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 9h4l5-4v14l-5-4H3z" />
        <path v-if="muted" d="m16 9 5 6m0-6-5 6" />
        <path v-else d="M15 9c2 2 2 4 0 6M18 6c4 4 4 8 0 12" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.volume-tile { position: relative; width: 100%; height: 100%; border: 1px solid var(--volume-color); border-radius: 4px; background: #20231d; overflow: hidden; }
.volume-slider { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 8px 8px 28px; color: #fff; cursor: ns-resize; touch-action: none; background: linear-gradient(to top, color-mix(in srgb, var(--volume-color) 75%, #171816) var(--volume-level), transparent var(--volume-level)); }
.volume-slider span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.volume-slider small { font-size: 11px; }
.volume-slider:focus-visible { outline: 2px solid white; outline-offset: -3px; }
.volume-mute { position: absolute; right: 0; bottom: 0; width: 32px; height: 32px; border: 0; border-radius: 4px; background: #20231dcc; color: white; cursor: pointer; }
.volume-mute svg { width: 20px; fill: none; stroke: currentColor; stroke-width: 2; }
</style>
