<script setup lang="ts">
import { ref } from 'vue'
import { pointerTap } from '../../pointerTap'

const props = defineProps<{ label: string; destination: string; value: string; flashSequence: number }>()
const emit = defineEmits<{ advance: [] }>()
const tap = pointerTap(() => emit('advance'))
const button = ref<HTMLButtonElement | null>(null)
const destinationText = ref<HTMLElement | null>(null)
const valueText = ref<HTMLElement | null>(null)
function setRuntimeDisplay(destination: string, value: string) {
  if (!button.value || !destinationText.value || !valueText.value || !button.value.getClientRects().length) return false
  destinationText.value.textContent = destination
  valueText.value.textContent = value
  button.value.setAttribute('aria-label', `${props.label}: ${destination}, ${value}. Select next output`)
  return true
}
defineExpose({ setRuntimeDisplay })
</script>

<template>
  <button ref="button" type="button" class="output-selector" :aria-label="`${label}: ${destination}, ${value}. Select next output`"
    @pointerdown="tap.down" @pointerup="tap.up" @pointercancel="tap.cancel" @lostpointercapture="tap.cancel" @click="tap.click">
    <span v-if="flashSequence" :key="flashSequence" class="flash" aria-hidden="true"></span>
    <span class="label">{{ label }}</span>
    <span ref="destinationText" :key="flashSequence" class="destination" :class="{ blinking: flashSequence }">{{ destination }}</span>
    <span ref="valueText" class="value">{{ value }}</span>
  </button>
</template>

<style scoped>
.output-selector {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: 2px solid var(--accent);
  border-radius: 6px;
  background: #30392b;
  color: #e2edd9;
  cursor: pointer;
  touch-action: none;
}
.output-selector span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.output-selector .flash { position: absolute; inset: 0; max-width: none; background: var(--accent); opacity: 0; pointer-events: none; animation: flash 900ms ease-out; }
.label { color: var(--muted); font-size: 11px; }
.destination { position: relative; font-size: 12px; }
.destination.blinking { animation: blink 300ms step-end 3; }
.value { font-size: 15px; font-weight: 700; }
.output-selector:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@keyframes flash { 0%, 35% { opacity: 0.55; } 100% { opacity: 0; } }
@keyframes blink { 50% { opacity: 0.2; } }
@media (prefers-reduced-motion: reduce) {
  .output-selector .flash { animation: none; opacity: 0.3; }
  .destination.blinking { animation: none; }
}
</style>
