<script setup lang="ts">
import type { GridItem } from '../../grid'
import NumericSetting from '../UI/NumericSetting.vue'

defineProps<{ draft: Extract<GridItem, { type: 'mod-wheel' }> }>()
</script>

<template>
  <div class="settings-section">
    <h3>Mod Wheel Settings</h3>
    <NumericSetting v-model="draft.settings.depth" label="Depth" :min="0" :max="1" :step="0.01" />
    <label class="inline-checkbox"><input v-model="draft.settings.autoCenter" type="checkbox" /> Auto-center</label>
    <label class="inline-checkbox"><input v-model="draft.settings.recordAutomation" type="checkbox" /> Record automation for this control</label>
  </div>
</template>
