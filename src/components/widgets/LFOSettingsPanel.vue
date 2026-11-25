<script setup lang="ts">
import type { GridItem } from '../../grid'
import NumericSetting from '../UI/NumericSetting.vue'

defineProps<{ draft: Extract<GridItem, { type: 'lfo' }> }>()
</script>

<template>
  <div class="settings-section">
    <h3>LFO Settings</h3>
    <div class="lfo-preview">
      <slot name="preview" />
    </div>
    <label>Waveform <select v-model="draft.settings.waveform"><option value="sine">Sine</option><option value="saw">Saw</option><option value="square">Square</option></select></label>
    <label>Rate mode <select v-model="draft.settings.rateMode"><option value="free">Hz</option><option value="sync">Cycles per beat</option></select></label>
    <NumericSetting v-model="draft.settings.rate" label="Rate" :min="0.01" :max="20" :step="0.01" />
    <NumericSetting v-model="draft.settings.depth" label="Depth" :min="0" :max="1" :step="0.01" />
    <NumericSetting v-model="draft.settings.offset" label="Offset" :min="-1" :max="1" :step="0.01" />
    <NumericSetting v-model="draft.settings.smoothness" label="Smoothness" :min="0" :max="0.99" :step="0.01" />
  </div>
</template>
