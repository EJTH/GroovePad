<script setup lang="ts">
import { computed } from 'vue'
import type { LfoSettings } from '../grid'
import { lfoLevel, lfoWaveValue } from '../lfo'

const props = defineProps<{ settings: LfoSettings; phase: number; randomValue: number }>()

const waveform = computed(() => {
  const points = Array.from({ length: 129 }, (_, index) => {
    const position = (index % 64) / 64
    const y = (1 - lfoLevel(lfoWaveValue(props.settings.waveform, position, props.randomValue), props.settings)) * 50
    return `${index === 0 ? 'M' : 'L'} ${index / 64 * 100} ${y}`
  })
  return points.join(' ')
})
</script>

<template>
  <svg class="waveform" :style="{ '--wave-color': settings.color }" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <path :d="waveform" :transform="`translate(${-phase * 100} 0)`" vector-effect="non-scaling-stroke" />
  </svg>
</template>

<style scoped>
.waveform { position: absolute; inset: 8%; width: 84%; height: 84%; overflow: visible; pointer-events: none; }
.waveform path { fill: none; stroke: var(--wave-color); stroke-width: 1.5; opacity: 0.55; }
</style>
