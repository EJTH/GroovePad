<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ModWheelSettings, ParameterOutput } from '../grid'

const props = defineProps<{ label: string; settings: ModWheelSettings }>()
const emit = defineEmits<{ output: [output: ParameterOutput] }>()
const position = ref(0.5)
const pointer = ref<number | null>(null)

function setPosition(next: number) {
  position.value = Math.max(0, Math.min(1, next))
  const normalized = props.settings.autoCenter ? position.value * 2 - 1 : position.value
  emit('output', { parameter: 'value', value: normalized * props.settings.depth })
}
function move(event: PointerEvent) {
  if (event.pointerId !== pointer.value) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  const rect = target.getBoundingClientRect()
  setPosition(1 - (event.clientY - rect.top) / rect.height)
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
  if (event.pointerId !== pointer.value) return
  pointer.value = null
  if (props.settings.autoCenter) setPosition(0.5)
}
function key(event: KeyboardEvent) {
  if (event.key === 'ArrowUp') setPosition(position.value + 0.05)
  else if (event.key === 'ArrowDown') setPosition(position.value - 0.05)
  else return
  event.preventDefault()
}
onBeforeUnmount(() => { if (props.settings.autoCenter && pointer.value !== null) setPosition(0.5) })
onMounted(() => setPosition(position.value))
watch([() => props.settings.depth, () => props.settings.autoCenter], () => setPosition(position.value))
</script>

<template>
  <div class="wheel">
    <div class="track" role="slider" tabindex="0" :aria-label="label" aria-valuemin="0" aria-valuemax="1" :aria-valuenow="position"
      @pointerdown="start" @pointermove="move" @pointerup="end" @pointercancel="end" @lostpointercapture="end" @keydown="key">
      <span :style="{ bottom: `${position * 100}%` }"></span>
    </div>
    <small>{{ label }}</small>
  </div>
</template>

<style scoped>
.wheel { width: 100%; height: 100%; padding: 6px; display: flex; flex-direction: column; align-items: center; gap: 4px; background: #26332e; color: #d3e6c1; overflow: hidden; }
.track { position: relative; width: min(100%, 44px); flex: 1; min-height: 0; border: 1px solid #536149; border-radius: 4px; background: #171816; touch-action: none; }
.track:focus-visible { outline: 2px solid var(--accent); }
.track span { position: absolute; left: 0; width: 100%; height: 10px; transform: translateY(50%); border-radius: 3px; background: var(--accent); }
small { max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 10px; }
</style>
