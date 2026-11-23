<script setup lang="ts">
import type { GridItem } from '../grid'
import NumericSetting from './NumericSetting.vue'

defineProps<{ draft: Extract<GridItem, { type: 'knob' }> }>()
const emit = defineEmits<{ 'default-value-change': [value: number] }>()
</script>

<template>
  <div class="settings-section">
    <h3>Knob Settings</h3>
    <NumericSetting v-model="draft.settings.min" label="Minimum" :step="0.1" />
    <NumericSetting v-model="draft.settings.max" label="Maximum" :step="0.1" />
    <NumericSetting v-model="draft.settings.step" label="Step" :step="0.01" />
    <NumericSetting :model-value="draft.settings.defaultValue" label="Default value" :step="0.1"
      @update:model-value="emit('default-value-change', $event)" />
    <NumericSetting v-model="draft.settings.value" label="Current value" :step="0.1" />
    <label>Unit <input v-model="draft.settings.unit" type="text" maxlength="10" /></label>
  </div>
</template>
