<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { LfoSettings, ParameterOutput } from '../grid'

const props = defineProps<{ label: string; settings: LfoSettings; bpm: number }>()
const emit = defineEmits<{ output: [output: ParameterOutput] }>()
const value = ref(0)
const phase = ref(0)
const randomValue = ref(0)
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
  const points = Array.from({ length: 65 }, (_, index) => {
    const position = index / 64
    const y = (1 - applySettings(waveValue(position))) * 50
    return `${index === 0 ? 'M' : 'L'} ${position * 100} ${y}`
  })
  return points.join(' ')
})

function tick(time: number) {
  if (previous) {
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

onMounted(() => { frame = requestAnimationFrame(tick) })
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <div class="lfo" role="img" :aria-label="`${label}, ${settings.waveform} LFO`">
    <svg class="waveform" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path :d="waveform" vector-effect="non-scaling-stroke" />
      <line :x1="phase * 100" y1="0" :x2="phase * 100" y2="100" vector-effect="non-scaling-stroke" />
      <circle :cx="phase * 100" :cy="(1 - value) * 50" r="2" vector-effect="non-scaling-stroke" />
    </svg>
    <span>{{ label }}</span>
    <strong>{{ settings.waveform }}</strong>
  </div>
</template>

<style scoped>
.lfo { position: relative; width: 100%; height: 100%; padding: 6px; display: flex; flex-direction: column; justify-content: center; gap: 5px; background: #26332e; color: #e4f2dc; text-align: center; overflow: hidden; font-size: 11px; }
.lfo span, .lfo strong { position: relative; text-shadow: 0 1px 3px #171816, 0 0 5px #171816; }
.lfo strong { font-size: 12px; }
.waveform { position: absolute; inset: 8%; width: 84%; height: 84%; overflow: visible; pointer-events: none; }
.waveform path { fill: none; stroke: var(--accent); stroke-width: 1.5; opacity: 0.55; }
.waveform line { stroke: var(--accent); stroke-width: 1; opacity: 0.3; }
.waveform circle { fill: var(--accent); }
</style>
