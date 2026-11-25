<script setup lang="ts">
import type { ToneElementSettings } from '../../../grid'
import NumericSetting from '../../UI/NumericSetting.vue'

defineProps<{ settings: ToneElementSettings }>()
</script>

<template>
  <label>Noise type
    <select v-model="settings.noiseType">
      <option value="white">White</option>
      <option value="pink">Pink</option>
      <option value="brown">Brown</option>
    </select>
  </label>
  <NumericSetting v-model="settings.gain" label="Gain" :min="0" :max="2" :step="0.01" />
  <label>Mode
    <select v-model="settings.noteMode">
      <option value="gated">Gated noise</option>
      <option value="continuous">Continuous noise</option>
    </select>
  </label>
</template>
