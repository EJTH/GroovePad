<script setup lang="ts">
import { ref, watch } from 'vue'
import type { LfoSettings } from '../../grid'
import { lfoLevel, lfoWaveValue } from '../../lfo'
import { useVisualRefresh } from '../../composables/useVisualRefresh'

const props = defineProps<{ settings: LfoSettings; phase?: number }>()

const element = ref<SVGElement | null>(null)
const path = ref<SVGPathElement | null>(null)
let phase = props.phase ?? 0
let displaySettings = { ...props.settings }
let renderedShape: Pick<LfoSettings, 'waveform' | 'depth' | 'offset' | 'color'> | undefined
const { request, visible } = useVisualRefresh(element, 30, () => {
  path.value?.setAttribute('transform', `translate(${-phase * 100} 0)`)
  if (!renderedShape || renderedShape.waveform !== displaySettings.waveform ||
    renderedShape.depth !== displaySettings.depth || renderedShape.offset !== displaySettings.offset ||
    renderedShape.color !== displaySettings.color) {
    renderedShape = {
      waveform: displaySettings.waveform,
      depth: displaySettings.depth,
      offset: displaySettings.offset,
      color: displaySettings.color,
    }
    element.value?.style.setProperty('--wave-color', displaySettings.color)
    path.value?.setAttribute('d', makeWaveform())
  }
})
watch(visible, (isVisible) => { if (isVisible) request() })
watch(() => props.phase, (value) => {
  if (value !== undefined) phase = value
  request()
})

function setSettings(settings: LfoSettings) {
  displaySettings = { ...settings }
  request()
}
function setPhase(value: number) {
  phase = value
  request()
}
defineExpose({ setPhase, setSettings })

function makeWaveform() {
  const points = Array.from({ length: 129 }, (_, index) => {
    const position = (index % 64) / 64
    const y = (1 - lfoLevel(lfoWaveValue(displaySettings.waveform, position), displaySettings)) * 50
    return `${index === 0 ? 'M' : 'L'} ${index / 64 * 100} ${y}`
  })
  return points.join(' ')
}
</script>

<template>
  <svg ref="element" class="waveform" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <path ref="path" vector-effect="non-scaling-stroke" />
  </svg>
</template>

<style scoped>
.waveform { position: absolute; inset: 8%; width: 84%; height: 84%; overflow: visible; pointer-events: none; }
.waveform path { fill: none; stroke: var(--wave-color); stroke-width: 1.5; opacity: 0.55; }
</style>
