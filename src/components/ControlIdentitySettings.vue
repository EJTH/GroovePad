<script setup lang="ts">
import { ref } from 'vue'
import type { GridItem, GridItemType } from '../grid'
import NumericSetting from './NumericSetting.vue'

defineProps<{
  draft: GridItem
  columns: number
  rows: number
  controlTypes: { type: GridItemType; label: string }[]
}>()
defineEmits<{ 'change-type': [event: Event] }>()
const details = ref<HTMLDetailsElement | null>(null)

function open() {
  if (details.value) details.value.open = true
}

defineExpose({ open })
</script>

<template>
  <details ref="details" class="control-panel control-details" @invalid.capture="open">
    <summary>
      <span class="color-swatch" :class="{ 'no-color': !('color' in draft.settings) }"
        :style="{ backgroundColor: 'color' in draft.settings ? draft.settings.color : 'transparent' }"
        :title="'color' in draft.settings ? 'Control color' : 'No configurable color'" aria-hidden="true"></span>
      <strong class="control-name">{{ draft.label || 'Unnamed control' }}</strong>
      <span class="control-size">{{ draft.width }} × {{ draft.height }}</span>
    </summary>
    <div class="control-details-fields">
      <h3>Control</h3>
      <label>
        Type
        <select :value="draft.type" required @change="$emit('change-type', $event)">
          <option v-for="control in controlTypes" :key="control.type" :value="control.type">{{ control.label }}</option>
        </select>
      </label>
      <label>Name <input v-model="draft.label" maxlength="40" required /></label>
      <label v-if="draft.type === 'pad' || draft.type === 'instrument-pad' || draft.type === 'knob' || draft.type === 'piano-roll'">
        Color <input v-model="draft.settings.color" type="color" required />
      </label>
      <h3 class="layout-heading">Layout</h3>
      <div class="settings-dimensions">
        <NumericSetting :model-value="draft.x + 1" label="Column" :min="1" :max="columns" @update:model-value="draft.x = $event - 1" />
        <NumericSetting :model-value="draft.y + 1" label="Row" :min="1" :max="rows" @update:model-value="draft.y = $event - 1" />
        <NumericSetting v-model="draft.width" label="Width" :min="1" :max="columns" />
        <NumericSetting v-model="draft.height" label="Height" :min="1" :max="rows" />
      </div>
    </div>
  </details>
</template>

<style scoped>
summary { display: flex; align-items: center; gap: 10px; min-height: 32px; cursor: pointer; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::after { content: '▸'; margin-left: auto; color: var(--muted); }
details[open] summary::after { content: '▾'; }
.color-swatch { flex: 0 0 20px; height: 20px; border: 1px solid #777; border-radius: 2px; }
.color-swatch.no-color { background: linear-gradient(135deg, transparent 47%, #777 48%, #777 52%, transparent 53%); }
.control-name { min-width: 0; overflow-wrap: anywhere; }
.control-size { color: var(--muted); white-space: nowrap; }
.control-details-fields { padding-top: 12px; }
.control-details-fields > label + label { margin-top: 8px; }
.control-details-fields .layout-heading { margin-top: 16px; }
</style>
