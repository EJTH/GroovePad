<script setup lang="ts">
import { computed } from 'vue'
import type { ADSREnvelope } from '../../instruments/types'
import type { KnobSettings, ParameterOutput } from '../../grid'
import ADSRVisualizer from './ADSRVisualizer.vue'
import Knob from './Knob.vue'
import NumericSetting from './NumericSetting.vue'

const props = withDefaults(defineProps<{ title: string; envelope: ADSREnvelope; attackMax?: number; decayMin?: number;
  decayMax?: number; compact?: boolean; color?: string; showVisualizer?: boolean; showKnobs?: boolean }>(),
  { attackMax: 1, decayMin: 0.001, decayMax: 2, color: '#b8d986', showVisualizer: true, showKnobs: true })
const emit = defineEmits<{ change: [parameter: keyof ADSREnvelope, output: ParameterOutput]; activity: [active: boolean]; 'open-settings': [] }>()
const stages = computed(() => [
  { id: 'attack' as const, label: 'Attack', min: 0.001, max: props.attackMax, step: 0.001 },
  { id: 'decay' as const, label: 'Decay', min: props.decayMin, max: props.decayMax, step: 0.01 },
  { id: 'sustain' as const, label: 'Sustain', min: 0, max: 1, step: 0.01 },
  { id: 'release' as const, label: 'Release', min: 0.01, max: 10, step: 0.01 },
])
function knobSettings(stage: typeof stages.value[number]): KnobSettings {
  const value = props.envelope[stage.id]
  return { color: props.color, min: stage.min, max: stage.max, step: stage.step, value,
    defaultValue: value, unit: '', recordAutomation: true }
}
</script>

<template>
  <button v-if="compact && !showVisualizer && !showKnobs" type="button" class="envelope-empty"
    :style="{ '--envelope-color': color }" :aria-label="`Open ${title || 'envelope'} control settings`"
    @click="emit('open-settings')">
    <strong>{{ title || 'Envelope' }}</strong>
    <span>Open settings</span>
  </button>
  <div v-else-if="compact" class="envelope-settings envelope-compact" :style="{ '--envelope-color': color }">
    <h4 v-if="title">{{ title }}</h4>
    <ADSRVisualizer v-if="showVisualizer" :envelope="envelope" :color="color" />
    <div v-if="showKnobs" class="envelope-compact-controls">
      <div v-for="stage in stages" :key="stage.id" class="envelope-compact-stage">
        <Knob :label="`${title || 'Envelope'} ${stage.label}`" :settings="knobSettings(stage)"
          @output="emit('change', stage.id, $event)" @activity="emit('activity', $event)" />
        <span aria-hidden="true">{{ stage.label[0] }}</span>
      </div>
    </div>
  </div>
  <div v-else class="envelope-settings">
    <h4 v-if="title">{{ title }}</h4>
    <ADSRVisualizer :envelope="envelope" :color="color" />
    <div class="adsr-knobs">
      <NumericSetting v-model="envelope.attack" label="Attack (s)" :min="0.001" :max="attackMax" :step="0.001" />
      <NumericSetting v-model="envelope.decay" label="Decay (s)" :min="decayMin" :max="decayMax" :step="0.01" />
      <NumericSetting v-model="envelope.sustain" label="Sustain" :min="0" :max="1" :step="0.01" />
      <NumericSetting v-model="envelope.release" label="Release (s)" :min="0.01" :max="10" :step="0.01" />
    </div>
  </div>
</template>

<style scoped>
.envelope-compact {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  margin: 0;
  padding: 4px;
  border: 1px solid var(--envelope-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--envelope-color) 18%, #222320);
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}
.envelope-compact h4 { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 0 auto; }
.envelope-compact :deep(.adsr-visualizer) { flex: 1 1 35%; min-height: 0; padding: 1px; overflow: hidden; }
.envelope-compact :deep(.adsr-visualizer svg) { width: 100%; height: 100%; margin: 0; }
.envelope-compact-controls { flex: 1 1 65%; min-height: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.envelope-compact-stage { min-width: 0; min-height: 0; display: flex; flex-direction: column; align-items: center; }
.envelope-compact-stage :deep(.knob) { flex: 1; min-height: 0; padding: 1px; }
.envelope-compact-stage :deep(.knob-control) { width: min(100cqw, 100cqh, 100px); }
.envelope-compact-stage :deep(.knob .label) { display: none; }
.envelope-compact-stage :deep(.knob .value) { font-size: clamp(6px, 2cqw, 10px); }
.envelope-compact-stage > span { flex: 0 0 auto; color: var(--muted); font-size: 10px; line-height: 11px; }
.envelope-empty {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 8px;
  border: 1px solid var(--envelope-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--envelope-color) 18%, #222320);
  color: var(--envelope-color);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
}
.envelope-empty strong, .envelope-empty span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.envelope-empty span { color: var(--muted); font-size: 11px; }
</style>
