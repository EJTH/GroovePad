<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { LfoSettings } from '../../grid'
import { lfoLevel, lfoWaveValue } from '../../lfo'
import { useVisualRefresh } from '../../composables/useVisualRefresh'

const props = defineProps<{ settings: LfoSettings; phase?: number }>()

const element = ref<SVGElement | null>(null)
const path = ref<SVGPathElement | null>(null)
let phase = props.phase ?? 0
const initialTransform = `translate(${-phase * 100} 0)`
const snapshot = shallowRef({ settings: { ...props.settings }, phase })
const { request, visible } = useVisualRefresh(element, 12, () => {
  path.value?.setAttribute('transform', `translate(${-phase * 100} 0)`)
  snapshot.value.phase = phase
  const { waveform, depth, offset, color } = props.settings
  const previous = snapshot.value.settings
  if (waveform !== previous.waveform || depth !== previous.depth || offset !== previous.offset || color !== previous.color) {
    snapshot.value = { settings: { ...props.settings }, phase }
  }
})
watch(() => visible.value ? [
  props.phase, props.settings.waveform,
  props.settings.depth, props.settings.offset, props.settings.color,
] : undefined, () => {
  if (props.phase !== undefined) phase = props.phase
  request()
})

function setPhase(value: number) {
  phase = value
  request()
}
defineExpose({ setPhase })

const shape = computed<Pick<LfoSettings, 'waveform' | 'depth' | 'offset'>>((previous) => {
  const { waveform, depth, offset } = snapshot.value.settings
  return previous && previous.waveform === waveform && previous.depth === depth &&
    previous.offset === offset
    ? previous : { waveform, depth, offset }
})
const waveform = computed(() => {
  const points = Array.from({ length: 129 }, (_, index) => {
    const position = (index % 64) / 64
    const y = (1 - lfoLevel(lfoWaveValue(shape.value.waveform, position), shape.value)) * 50
    return `${index === 0 ? 'M' : 'L'} ${index / 64 * 100} ${y}`
  })
  return points.join(' ')
})
</script>

<template>
  <svg ref="element" class="waveform" :style="{ '--wave-color': snapshot.settings.color }" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <path ref="path" :d="waveform" :transform="initialTransform" vector-effect="non-scaling-stroke" />
  </svg>
</template>

<style scoped>
.waveform { position: absolute; inset: 8%; width: 84%; height: 84%; overflow: visible; pointer-events: none; }
.waveform path { fill: none; stroke: var(--wave-color); stroke-width: 1.5; opacity: 0.55; }
</style>
