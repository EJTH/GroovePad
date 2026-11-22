<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { LfoSettings, ParameterOutput } from '../grid'

const props = defineProps<{ label: string; settings: LfoSettings; bpm: number }>()
const emit = defineEmits<{ output: [output: ParameterOutput] }>()
const value = ref(0)
const phase = ref(0)
const randomValue = ref(0)
const held = ref(false)
let frame = 0
let previous = 0

function waveValue(position: number): number {
  switch (props.settings.waveform) {
    case 'sine': return Math.sin(position * 2 * Math.PI)
    case 'saw': return position * 2 - 1
    case 'square': return position < 0.5 ? 1 : -1
    case 'random': return randomValue.value
  }
}

function applySettings(raw: number): number {
  return Math.max(-1, Math.min(1, raw * props.settings.depth + props.settings.offset))
}

const waveform = computed(() => {
  const points = Array.from({ length: 129 }, (_, index) => {
    const position = (index % 64) / 64
    const y = (1 - applySettings(waveValue(position))) * 50
    return `${index === 0 ? 'M' : 'L'} ${index / 64 * 100} ${y}`
  })
  return points.join(' ')
})

function tick(time: number) {
  if (previous && !held.value) {
    const frequency = props.settings.rateMode === 'sync' ? props.settings.rate * props.bpm / 60 : props.settings.rate
    const nextPhase = phase.value + Math.min((time - previous) / 1000, 0.1) * frequency
    if (Math.floor(nextPhase) !== Math.floor(phase.value)) randomValue.value = Math.random() * 2 - 1
    phase.value = nextPhase % 1
    const desired = applySettings(waveValue(phase.value))
    const smoothing = Math.max(0, Math.min(0.99, props.settings.smoothness))
    value.value += (desired - value.value) * (1 - smoothing)
    emit('output', { parameter: 'value', value: value.value })
  }
  previous = time
  frame = requestAnimationFrame(tick)
}

function toggleHold() {
  held.value = !held.value
}

onMounted(() => { frame = requestAnimationFrame(tick) })
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <button type="button" class="lfo" :class="{ held }"
    :aria-label="`${label}, ${settings.waveform} LFO, ${held ? 'held' : 'running'}`"
    :aria-pressed="held" @click="toggleHold">
    <svg class="waveform" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path :d="waveform" :transform="`translate(${-phase * 100} 0)`" vector-effect="non-scaling-stroke" />
    </svg>
    <span>{{ label }}</span>
    <strong>{{ settings.waveform }}</strong>
    <small v-if="held">HOLD</small>
  </button>
</template>

<style scoped>
.lfo { position: relative; width: 100%; height: 100%; padding: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; border: 1px solid transparent; background: #26332e; color: #e4f2dc; text-align: center; overflow: hidden; font: inherit; font-size: 11px; cursor: pointer; }
.lfo.held { border-color: var(--accent); }
.lfo:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; }
.lfo span, .lfo strong, .lfo small { position: relative; text-shadow: 0 1px 3px #171816, 0 0 5px #171816; }
.lfo strong { font-size: 12px; }
.lfo small { color: var(--accent); font-weight: 700; }
.waveform { position: absolute; inset: 8%; width: 84%; height: 84%; overflow: visible; pointer-events: none; }
.waveform path { fill: none; stroke: var(--accent); stroke-width: 1.5; opacity: 0.55; }
</style>
