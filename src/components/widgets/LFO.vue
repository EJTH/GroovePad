<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { LfoSettings, ParameterOutput } from '../../grid'
import { lfoLevel, lfoWaveValue } from '../../lfo'
import { pointerTap } from '../../pointerTap'
import LFOWaveform from './LFOWaveform.vue'

const props = defineProps<{ label: string; settings: LfoSettings; bpm: number; automationHold?: boolean }>()
const emit = defineEmits<{ output: [output: ParameterOutput]; 'hold-change': [held: boolean] }>()
const value = ref(0)
const phase = ref(0)
const randomValue = ref(0)
const manualHold = ref(false)
const held = computed(() => props.automationHold ?? manualHold.value)
let frame = 0
let previous = 0

function tick(time: number) {
  if (previous && !held.value) {
    const frequency = props.settings.rateMode === 'sync' ? props.settings.rate * props.bpm / 60 : props.settings.rate
    const nextPhase = phase.value + Math.min((time - previous) / 1000, 0.1) * frequency
    if (Math.floor(nextPhase) !== Math.floor(phase.value)) randomValue.value = Math.random() * 2 - 1
    phase.value = nextPhase % 1
    const desired = lfoLevel(lfoWaveValue(props.settings.waveform, phase.value, randomValue.value), props.settings)
    const smoothing = Math.max(0, Math.min(0.99, props.settings.smoothness))
    value.value += (desired - value.value) * (1 - smoothing)
    emit('output', { parameter: 'value', value: value.value })
  }
  previous = time
  frame = requestAnimationFrame(tick)
}

function toggleHold() {
  manualHold.value = !held.value
  emit('hold-change', manualHold.value)
}
const tap = pointerTap(toggleHold)

onMounted(() => { frame = requestAnimationFrame(tick) })
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <button type="button" class="lfo" :class="{ held }" :style="{ '--lfo-color': settings.color }"
    :aria-label="`${label}, ${settings.waveform} LFO, ${held ? 'held' : 'running'}`"
    :aria-pressed="held" @pointerdown="tap.down" @pointerup="tap.up"
    @pointercancel="tap.cancel" @lostpointercapture="tap.cancel" @click="tap.click">
    <LFOWaveform :settings="settings" :phase="phase" :random-value="randomValue" />
    <span>{{ label }}</span>
    <strong>{{ settings.waveform }}</strong>
    <small v-if="held">HOLD</small>
  </button>
</template>

<style scoped>
.lfo { position: relative; width: 100%; height: 100%; padding: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--lfo-color); background: color-mix(in srgb, var(--lfo-color) 15%, #171816); color: #e4f2dc; text-align: center; overflow: hidden; font: inherit; font-size: 11px; cursor: pointer; touch-action: none; }
.lfo.held { border-width: 2px; }
.lfo:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; }
.lfo span, .lfo strong, .lfo small { position: relative; text-shadow: 0 1px 3px #171816, 0 0 5px #171816; }
.lfo strong { font-size: 12px; }
.lfo small { color: var(--accent); font-weight: 700; }
</style>
