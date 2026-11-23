<script setup lang="ts">
import type { GridItem } from '../grid'
import NumericSetting from './NumericSetting.vue'

defineProps<{ draft: Extract<GridItem, { type: 'arpeggiator' }> }>()
</script>

<template>
  <div class="settings-section">
    <h3>Arpeggiator Settings</h3>
    <label>Style <select v-model="draft.settings.style"><option value="up">Up</option><option value="down">Down</option><option value="up-down">Up-down</option><option value="random">Random</option></select></label>
    <label>Rate <select v-model="draft.settings.rate"><option value="1/1">1/1</option><option value="3/4">3/4</option><option value="1/2">1/2</option><option value="1/4">1/4</option><option value="1/8">1/8</option><option value="1/16">1/16</option><option value="1/32">1/32</option></select></label>
    <NumericSetting v-model="draft.settings.distance" label="Distance (st)" :min="-24" :max="24" />
    <NumericSetting v-model="draft.settings.steps" label="Steps" :min="0" :max="16" />
    <NumericSetting v-model="draft.settings.gate" label="Gate" :min="0.05" :max="1" :step="0.05" />
    <label>Scale <select v-model="draft.settings.scale">
      <option value="chromatic">Chromatic</option><option value="major">Major</option><option value="minor">Minor</option>
      <option value="dorian">Dorian</option><option value="phrygian">Phrygian</option>
      <option value="lydian">Lydian</option><option value="mixolydian">Mixolydian</option>
      <option value="locrian">Locrian</option><option value="major-pentatonic">Major Pentatonic</option>
      <option value="minor-pentatonic">Minor Pentatonic</option><option value="blues">Blues</option>
    </select></label>
  </div>
</template>
