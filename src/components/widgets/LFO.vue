<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { LfoSettings, ParameterOutput } from '../../grid'
import { lfoLevel, lfoWaveValue } from '../../lfo'
import { subscribeVisualRefresh } from '../../audio/signalRuntime'
import LFOWaveform from './LFOWaveform.vue'

const props = defineProps<{ label: string; settings: LfoSettings; bpm: number; sourceId?: string;
  sampleLfo?: (id: string, settings: LfoSettings) => { value: number; phase: number } | undefined;
  publishValue?: (value: number, audioAvailable: boolean) => void }>()
const emit = defineEmits<{ output: [output: ParameterOutput] }>()
let value = 0
let phase = 0
let effectiveSettings = props.settings
const root = ref<HTMLDivElement | null>(null)
const waveformLabel = ref<HTMLElement | null>(null)
const waveform = ref<InstanceType<typeof LFOWaveform> | null>(null)
let unsubscribe: (() => void) | undefined
let previous: number | undefined

function tick(time: number) {
  if (previous !== undefined) {
    const elapsed = Math.max(0, (time - previous) / 1000)
    const sample = props.sourceId ? props.sampleLfo?.(props.sourceId, effectiveSettings) : undefined
    if (sample) phase = sample.phase
    else {
      const frequency = effectiveSettings.rateMode === 'sync' ? effectiveSettings.rate * props.bpm / 60 : effectiveSettings.rate
      phase = (phase + elapsed * frequency) % 1
    }
    waveform.value?.setPhase(phase)
    const desired = lfoLevel(sample?.value ?? lfoWaveValue(effectiveSettings.waveform, phase), effectiveSettings)
    const smoothing = Math.max(0, Math.min(0.99, effectiveSettings.smoothness))
    value += (desired - value) * (1 - Math.pow(smoothing, elapsed * 60))
    if (props.publishValue) props.publishValue(value, !!sample)
    else emit('output', { parameter: 'value', value })
  }
  previous = time
}

function setEffectiveSettings(settings: LfoSettings) {
  effectiveSettings = settings
  waveform.value?.setSettings(settings)
  root.value?.style.setProperty('--lfo-color', settings.color)
  root.value?.setAttribute('aria-label', `${props.label}, ${settings.waveform} LFO`)
  if (waveformLabel.value) waveformLabel.value.textContent = settings.waveform
}
defineExpose({ setEffectiveSettings })

onMounted(() => {
  setEffectiveSettings(effectiveSettings)
  unsubscribe = subscribeVisualRefresh(tick)
})
onBeforeUnmount(() => unsubscribe?.())
</script>

<template>
  <div ref="root" class="lfo" role="img" :style="{ '--lfo-color': settings.color }"
    :aria-label="`${label}, ${settings.waveform} LFO`">
    <LFOWaveform ref="waveform" :settings="settings" />
    <span>{{ label }}</span>
    <strong ref="waveformLabel"></strong>
  </div>
</template>

<style scoped>
.lfo { position: relative; width: 100%; height: 100%; padding: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--lfo-color); background: color-mix(in srgb, var(--lfo-color) 15%, #171816); color: #e4f2dc; text-align: center; overflow: hidden; font: inherit; font-size: 11px; }
.lfo span, .lfo strong { position: relative; text-shadow: 0 1px 3px #171816, 0 0 5px #171816; }
.lfo strong { font-size: 12px; }
</style>
