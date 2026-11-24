<script setup lang="ts">
import type { GridItem } from '../grid'
import NumericSetting from './NumericSetting.vue'

const props = defineProps<{
  draft: Extract<GridItem, { type: 'knob' }>
  baseDraft?: Extract<GridItem, { type: 'knob' }>
}>()
const emit = defineEmits<{ 'default-value-change': [value: number] }>()

function setRange(field: 'min' | 'max', value: number) {
  const settings = props.draft.settings
  const base = props.baseDraft?.settings ?? settings
  if (field === 'min') {
    const gap = Math.max(Number.MIN_VALUE, Math.abs(settings.max) * Number.EPSILON)
    const min = Math.min(value, settings.max - gap)
    if (base.max <= min) base.max = settings.max
    settings.min = min
  } else {
    const gap = Math.max(Number.MIN_VALUE, Math.abs(settings.min) * Number.EPSILON)
    const max = Math.max(value, settings.min + gap)
    if (base.min >= max) base.min = settings.min
    settings.max = max
  }
  base.step = Math.min(base.step, base.max - base.min)
  base.defaultValue = Math.max(base.min, Math.min(base.max, base.defaultValue))
  base.value = Math.max(base.min, Math.min(base.max, base.value))
}
</script>

<template>
  <div class="settings-section">
    <h3>Knob Settings</h3>
    <NumericSetting :model-value="draft.settings.min" label="Minimum" :step="0.1" @update:model-value="setRange('min', $event)" />
    <NumericSetting :model-value="draft.settings.max" label="Maximum" :step="0.1" @update:model-value="setRange('max', $event)" />
    <NumericSetting v-model="draft.settings.step" label="Step" :min="Number.MIN_VALUE" :max="draft.settings.max - draft.settings.min" :step="0.01" />
    <NumericSetting :model-value="draft.settings.defaultValue" label="Default value" :min="draft.settings.min" :max="draft.settings.max" :step="0.1"
      @update:model-value="emit('default-value-change', $event)" />
    <NumericSetting v-model="draft.settings.value" label="Current value" :min="draft.settings.min" :max="draft.settings.max" :step="0.1" />
    <label>Unit <input v-model="draft.settings.unit" type="text" maxlength="10" /></label>
    <label class="inline-checkbox"><input v-model="draft.settings.recordAutomation" type="checkbox" /> Record automation for this control</label>
  </div>
</template>
