<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { LfoSettings, ParameterOutput } from '../../grid'
import { lfoLevel, lfoWaveValue } from '../../lfo'
import LFOWaveform from './LFOWaveform.vue'

const props = defineProps<{ label: string; settings: LfoSettings; bpm: number; sourceId?: string;
  sampleLfo?: (id: string, settings: LfoSettings) => { value: number; phase: number } | undefined;
  publishValue?: (value: number, audioAvailable: boolean) => void }>()
const emit = defineEmits<{ output: [output: ParameterOutput] }>()
let value = 0
let phase = 0
const waveform = ref<InstanceType<typeof LFOWaveform> | null>(null)
let frame = 0
let previous = 0

function tick(time: number) {
  if (previous) {
    const sample = props.sourceId ? props.sampleLfo?.(props.sourceId, props.settings) : undefined
    if (sample) phase = sample.phase
    else {
      const frequency = props.settings.rateMode === 'sync' ? props.settings.rate * props.bpm / 60 : props.settings.rate
      phase = (phase + Math.min((time - previous) / 1000, 0.1) * frequency) % 1
    }
    waveform.value?.setPhase(phase)
    const desired = lfoLevel(sample?.value ?? lfoWaveValue(props.settings.waveform, phase), props.settings)
    const smoothing = Math.max(0, Math.min(0.99, props.settings.smoothness))
    value += (desired - value) * (1 - smoothing)
    if (props.publishValue) props.publishValue(value, !!sample)
    else emit('output', { parameter: 'value', value })
  }
  previous = time
  frame = requestAnimationFrame(tick)
}

onMounted(() => { frame = requestAnimationFrame(tick) })
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <div class="lfo" role="img" :style="{ '--lfo-color': settings.color }"
    :aria-label="`${label}, ${settings.waveform} LFO`">
    <LFOWaveform ref="waveform" :settings="settings" />
    <span>{{ label }}</span>
    <strong>{{ settings.waveform }}</strong>
  </div>
</template>

<style scoped>
.lfo { position: relative; width: 100%; height: 100%; padding: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--lfo-color); background: color-mix(in srgb, var(--lfo-color) 15%, #171816); color: #e4f2dc; text-align: center; overflow: hidden; font: inherit; font-size: 11px; }
.lfo span, .lfo strong { position: relative; text-shadow: 0 1px 3px #171816, 0 0 5px #171816; }
.lfo strong { font-size: 12px; }
</style>
