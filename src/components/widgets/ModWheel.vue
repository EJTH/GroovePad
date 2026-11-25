<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ModWheelSettings, ParameterOutput } from '../../grid'

const props = defineProps<{ label: string; settings: ModWheelSettings; rotated?: boolean; automationValue?: number }>()
const emit = defineEmits<{ output: [output: ParameterOutput]; activity: [active: boolean] }>()
const pointer = ref<number | null>(null)
let livePosition = 0.5
let effectiveSettings = props.settings
const track = ref<HTMLElement | null>(null)
const thumb = ref<HTMLElement | null>(null)

function setPosition(next: number, user = false) {
  livePosition = Math.max(0, Math.min(1, next))
  drawPosition(livePosition)
  const normalized = effectiveSettings.autoCenter ? livePosition * 2 - 1 : livePosition
  emit('output', { parameter: 'value', value: normalized * effectiveSettings.depth, wheelPosition: normalized,
    ...(user ? { user: true } : {}) })
}
function move(event: PointerEvent) {
  if (event.pointerId !== pointer.value) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  const rect = target.getBoundingClientRect()
  setPosition(props.rotated ? (event.clientX - rect.left) / rect.width : 1 - (event.clientY - rect.top) / rect.height, true)
}
function start(event: PointerEvent) {
  if (pointer.value !== null || event.button !== 0) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  event.preventDefault()
  target.setPointerCapture(event.pointerId)
  pointer.value = event.pointerId
  emit('activity', true)
  move(event)
}
function end(event: PointerEvent) {
  if (event.pointerId !== pointer.value) return
  pointer.value = null
  if (effectiveSettings.autoCenter) setPosition(0.5, true)
  emit('activity', false)
}
function key(event: KeyboardEvent) {
  if (event.key === 'ArrowUp' || event.key === 'ArrowRight') setPosition(livePosition + 0.05, true)
  else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') setPosition(livePosition - 0.05, true)
  else return
  event.preventDefault()
}
onBeforeUnmount(() => { if (effectiveSettings.autoCenter && pointer.value !== null) setPosition(0.5) })
function drawPosition(value: number) {
  if (thumb.value) thumb.value.style.bottom = `${value * 100}%`
  track.value?.setAttribute('aria-valuenow', String(value))
}
function showAutomation(value: number | undefined) {
  if (pointer.value !== null) return
  if (value === undefined || effectiveSettings.depth === 0) { drawPosition(livePosition); return }
  const normalized = value / effectiveSettings.depth
  drawPosition(Math.max(0, Math.min(1, effectiveSettings.autoCenter ? (normalized + 1) / 2 : normalized)))
}
function setEffectiveSettings(settings: ModWheelSettings, automationValue = props.automationValue) {
  if (effectiveSettings.depth === settings.depth && effectiveSettings.autoCenter === settings.autoCenter) {
    effectiveSettings = settings
    showAutomation(automationValue)
    return
  }
  effectiveSettings = settings
  drawPosition(livePosition)
  if (automationValue === undefined) {
    const normalized = effectiveSettings.autoCenter ? livePosition * 2 - 1 : livePosition
    emit('output', { parameter: 'value', value: normalized * effectiveSettings.depth, wheelPosition: normalized })
  }
  showAutomation(automationValue)
}
defineExpose({ setEffectiveSettings })
onMounted(() => { setPosition(livePosition); showAutomation(props.automationValue) })
watch([() => props.settings.depth, () => props.settings.autoCenter], () => {
  effectiveSettings = props.settings
  setPosition(livePosition)
  showAutomation(props.automationValue)
})
watch(() => props.automationValue, showAutomation)
</script>

<template>
  <div class="wheel">
    <div ref="track" class="track" role="slider" tabindex="0" :aria-label="label" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0.5"
      @pointerdown="start" @pointermove="move" @pointerup="end" @pointercancel="end" @lostpointercapture="end" @keydown="key">
      <span ref="thumb"></span>
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
