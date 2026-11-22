<script setup lang="ts">
import type { ADSREnvelope } from '../instruments/types'
import ADSRVisualizer from './ADSRVisualizer.vue'
import NumericSetting from './NumericSetting.vue'

defineProps<{ title: string; envelope: ADSREnvelope }>()
</script>

<template>
  <div class="envelope-settings">
    <h4 v-if="title">{{ title }}</h4>
    <ADSRVisualizer :envelope="envelope" />
    <div class="adsr-knobs">
      <NumericSetting v-model="envelope.attack" label="Attack (s)" :min="0.001" :max="1" :step="0.001" />
      <NumericSetting v-model="envelope.decay" label="Decay (s)" :min="0.001" :max="2" :step="0.01" />
      <NumericSetting v-model="envelope.sustain" label="Sustain" :min="0" :max="1" :step="0.01" />
      <NumericSetting v-model="envelope.release" label="Release (s)" :min="0.01" :max="10" :step="0.01" />
    </div>
  </div>
</template>
