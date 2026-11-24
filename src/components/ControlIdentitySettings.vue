<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { isValidPlacement, type GridItem, type GridItemType, type GridLayout } from '../grid'
import NumericSetting from './NumericSetting.vue'

const props = defineProps<{
  draft: GridItem
  layout?: GridLayout
  columns: number
  rows: number
  controlTypes: { type: GridItemType; label: string }[]
}>()
defineEmits<{ 'change-type': [event: Event] }>()
const details = ref<HTMLDetailsElement | null>(null)
const inlineNameInput = ref<HTMLInputElement | null>(null)
const editingName = ref(false)

function open() {
  if (details.value) details.value.open = true
}

function editName() {
  editingName.value = true
  void nextTick(() => {
    inlineNameInput.value?.focus()
    inlineNameInput.value?.select()
  })
}

function updateName(event: Event, finish = false) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  if (input.value.trim()) props.draft.label = finish ? input.value.trim() : input.value
  if (finish) input.value = props.draft.label
}

function setDimension(field: 'x' | 'y' | 'width' | 'height', value: number) {
  const { draft, layout } = props
  if (!layout) {
    draft[field] = value
    return
  }
  const limit = field === 'x' || field === 'width' ? layout.columns : layout.rows
  const start = field === 'x' || field === 'y' ? 0 : 1
  const candidates = Array.from({ length: limit }, (_, index) => index + start)
  candidates.sort((a, b) => Math.abs(a - value) - Math.abs(b - value))
  const nearest = candidates.find((candidate) => isValidPlacement(layout, { ...draft, [field]: candidate }))
  if (nearest !== undefined) draft[field] = nearest
}

defineExpose({ open })
</script>

<template>
  <details ref="details" class="control-panel control-details" @invalid.capture="open">
    <summary>
      <label v-if="'color' in draft.settings" class="color-picker">
        <span class="color-swatch" :style="{ backgroundColor: draft.settings.color }" aria-hidden="true"></span>
        <input v-model="draft.settings.color" type="color" aria-label="Choose control color" />
      </label>
      <span v-else class="color-swatch no-color" title="No configurable color" aria-hidden="true"></span>
      <input v-if="editingName" ref="inlineNameInput" :value="draft.label" class="control-name-input"
        aria-label="Control name" maxlength="40" @click.stop
        @keydown.enter.prevent.stop="editingName = false"
        @keydown.esc.prevent.stop="editingName = false"
        @input="updateName($event)" @blur="updateName($event, true); editingName = false" />
      <button v-else type="button" class="control-name" @click.stop.prevent="editName">
        {{ draft.label || 'Unnamed control' }}
      </button>
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
      <label>Name <input :value="draft.label" maxlength="40" required @input="updateName($event)" @blur="updateName($event, true)" /></label>
      <h3 class="layout-heading">Layout</h3>
      <label>Control orientation
        <select v-model="draft.orientation">
          <option value="horizontal">Horizontal</option>
          <option value="vertical">Vertical (rotate clockwise)</option>
        </select>
      </label>
      <div class="settings-dimensions">
        <NumericSetting :model-value="draft.x + 1" label="Column" :min="1" :max="columns" integer @update:model-value="setDimension('x', $event - 1)" />
        <NumericSetting :model-value="draft.y + 1" label="Row" :min="1" :max="rows" integer @update:model-value="setDimension('y', $event - 1)" />
        <NumericSetting :model-value="draft.width" label="Width" :min="1" :max="columns" integer @update:model-value="setDimension('width', $event)" />
        <NumericSetting :model-value="draft.height" label="Height" :min="1" :max="rows" integer @update:model-value="setDimension('height', $event)" />
      </div>
    </div>
  </details>
</template>

<style scoped>
summary { display: flex; align-items: center; gap: 10px; min-height: 32px; cursor: pointer; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::after { content: '▸'; margin-left: auto; color: var(--muted); }
details[open] summary::after { content: '▾'; }
.color-picker { position: relative; display: block; flex: 0 0 40px; width: 40px; height: 40px; margin: 0; cursor: pointer; }
.color-picker input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; opacity: 0; cursor: pointer; }
.color-picker:focus-within .color-swatch { outline: 2px solid var(--accent); outline-offset: 2px; }
.color-swatch { position: absolute; inset: 0; width: 100%; height: 100%; border: 1px solid #777; border-radius: 2px; }
.color-swatch.no-color { position: static; flex: 0 0 40px; width: 40px; height: 40px; background: linear-gradient(135deg, transparent 47%, #777 48%, #777 52%, transparent 53%); }
.control-name { min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; font-weight: 700; text-align: left; overflow-wrap: anywhere; cursor: text; }
.control-name-input { flex: 1 1 8rem; width: 100%; min-width: 0; padding: 2px 4px; border: 1px solid var(--accent); border-radius: 2px; background: #171816; color: #ecece8; font: inherit; font-weight: 700; }
.control-size { color: var(--muted); white-space: nowrap; }
.control-details-fields { padding-top: 12px; }
.control-details-fields > label + label { margin-top: 8px; }
.control-details-fields .layout-heading { margin-top: 16px; }
</style>
