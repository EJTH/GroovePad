<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { defaultLoopWidgetButtons, gridScopes, LOOP_WIDGET_BUTTONS, loopWidgetButtonVisible, MAX_LOOP_CLIP_INDEX, type GridItem, type GridLayout, type LoopAutomation, type LoopNote, type LoopRow, type LoopWidgetButton } from '../../grid'
import { cloneClip, copyRow, nextUnusedClipIndex, pasteRow, removeRow, rowKey, type RowClipboard } from '../../loopRows'
import NumericSetting from '../UI/NumericSetting.vue'
import SequenceEditor from './SequenceEditor.vue'
import type { Bank } from '../../project'

const props = defineProps<{ draft: Extract<GridItem, { type: 'sequenced-loop' }>; layout: GridLayout; banks?: Bank[]; bankId?: string; playhead?: number; editorOnly?: boolean; editorClipIndex?: number }>()
const emit = defineEmits<{ 'arm-change': [armed: boolean]; 'update:editor-clip-index': [index: number]; 'close-editor': [] }>()
const clipIndex = computed(() => props.editorOnly ? props.editorClipIndex ?? props.draft.settings.clipIndex : props.draft.settings.clipIndex)
const clipboard = ref<RowClipboard | null>(null)
const message = ref('')
const mutedRows = computed(() => props.draft.settings.mutedRows?.[clipIndex.value] ?? [])
const canClone = computed(() => nextUnusedClipIndex(props.draft.settings) !== undefined)
function setWidgetButton(id: LoopWidgetButton, checked: boolean) {
  const buttons = props.draft.settings.widgetButtons ??= defaultLoopWidgetButtons()
  buttons[id] = checked
}
function toggleMute(row: LoopRow) {
  const settings = props.draft.settings
  const index = clipIndex.value
  const key = rowKey(row, props.bankId)
  const rows = mutedRows.value
  ;(settings.mutedRows ??= {})[index] = rows.some((entry) => rowKey(entry, props.bankId) === key)
    ? rows.filter((entry) => rowKey(entry, props.bankId) !== key) : [...rows, { ...row }]
}
function remove(row: LoopRow, all: boolean) {
  const settings = props.draft.settings
  const indices = all ? new Set([...Object.keys(settings.clips), ...Object.keys(settings.automation), ...Object.keys(settings.mutedRows ?? {})].map(Number))
    : new Set([clipIndex.value])
  for (const index of indices) removeRow(settings, index, row, props.bankId)
}
function copy(row: LoopRow) { clipboard.value = copyRow(props.draft.settings, clipIndex.value, row, props.bankId) }
function paste() {
  if (clipboard.value) pasteRow(props.draft.settings, clipIndex.value, clipboard.value, props.bankId)
}
function clone() {
  const index = cloneClip(props.draft.settings, clipIndex.value)
  if (index === undefined) { message.value = 'No unused clip index is available.'; return }
  props.draft.settings.clipIndex = index
  if (props.editorOnly) emit('update:editor-clip-index', index)
  message.value = `Sequence cloned to clip ${index}.`
}
const validIndex = computed(() => Number.isSafeInteger(clipIndex.value) &&
  clipIndex.value >= 0 && clipIndex.value <= MAX_LOOP_CLIP_INDEX)
watch(clipIndex, (index) => {
  if (!validIndex.value) return
  props.draft.settings.clips[String(index)] ??= []
  props.draft.settings.automation[String(index)] ??= []
}, { immediate: true })
watch(() => props.draft.settings.barLength, (barLength) => {
  for (const notes of Object.values(props.draft.settings.clips)) for (const note of notes) {
    note.position %= barLength * 4
    note.duration = Math.min(note.duration, barLength * 4)
  }
  for (const events of Object.values(props.draft.settings.automation)) for (const event of events) event.position %= barLength * 4
}, { flush: 'sync' })
const notes = computed({
  get: () => props.draft.settings.clips[String(clipIndex.value)] ?? [],
  set: (value: LoopNote[]) => { if (validIndex.value) props.draft.settings.clips[String(clipIndex.value)] = value },
})
const automation = computed({
  get: () => props.draft.settings.automation[String(clipIndex.value)] ?? [],
  set: (value: LoopAutomation[]) => { if (validIndex.value) props.draft.settings.automation[String(clipIndex.value)] = value },
})
const sources = computed(() => {
  const banks = gridScopes(props.banks ?? [{ id: props.bankId ?? '', title: '', layout: props.layout }])
  return banks.flatMap((bank) => bank.layout.items.map((item) => ({
    id: item.id, bankId: bank.id, label: banks.length > 1 ? `${bank.title} / ${item.label}` : item.label,
    color: 'color' in item.settings ? item.settings.color : undefined,
    instrument: item.type === 'instrument-pad' || item.type === 'piano-roll',
  })))
})
const instruments = computed(() => sources.value.filter((source) => source.instrument))
</script>

<template>
  <div class="settings-section" :class="{ 'settings-form': editorOnly }">
    <h3 v-if="!editorOnly">Loop sequencer settings</h3>
    <div v-if="!editorOnly" class="loop-settings-row">
      <NumericSetting v-model="draft.settings.barLength" label="Bar length" :min="1" :max="64" integer />
      <NumericSetting v-model="draft.settings.clipIndex" label="Clip index" :min="0" :max="MAX_LOOP_CLIP_INDEX" integer />
    </div>
    <label v-if="!editorOnly">Record quantize <select v-model="draft.settings.quantize">
      <option value="off">Off</option><option value="1/4">1/4</option><option value="1/8">1/8</option>
      <option value="1/16">1/16</option><option value="1/32">1/32</option>
    </select></label>
    <SequenceEditor v-if="validIndex" v-model="notes" v-model:automation="automation"
      :bar-length="draft.settings.barLength" :instruments="instruments" :sources="sources" :bank-id="bankId"
      :clip-index="clipIndex" :start-fullscreen="editorOnly"
      :playhead="playhead"
      :muted-rows="mutedRows" :clipboard-row="clipboard?.row" :can-paste="!!clipboard" :can-clone="canClone"
      @toggle-mute="toggleMute" @remove-row="remove" @copy-row="copy" @paste-row="paste" @clone-sequence="clone" @exit-fullscreen="editorOnly && emit('close-editor')" />
    <p v-if="message && !editorOnly" role="status">{{ message }}</p>
    <fieldset v-if="!editorOnly" class="loop-widget-buttons">
      <legend>Widget buttons</legend>
      <label v-for="button in LOOP_WIDGET_BUTTONS" :key="button.id" class="inline-checkbox">
        <input type="checkbox" :checked="loopWidgetButtonVisible(draft.settings, button.id)"
          @change="setWidgetButton(button.id, ($event.target as HTMLInputElement).checked)"> {{ button.label }}
      </label>
    </fieldset>
    <label v-if="!editorOnly" class="inline-checkbox"><input :checked="draft.settings.armed" type="checkbox" @change="emit('arm-change', ($event.target as HTMLInputElement).checked)"> Armed for record</label>
    <label v-if="!editorOnly" class="inline-checkbox"><input v-model="draft.settings.countIn" type="checkbox"> One-bar count-in before recording</label>
    <label v-if="!editorOnly">Record from <select v-model="draft.settings.recordScope">
      <option value="bank">Current bank</option><option value="all">All banks</option>
    </select></label>
    <label v-if="!editorOnly">Sync mode <select v-model="draft.settings.syncMode">
      <option value="immediate">Immediate</option><option value="sync">Sync to clip length</option>
    </select></label>
  </div>
</template>

<style scoped>
.loop-settings-row { display: flex; flex-wrap: wrap; gap: 8px; }
.loop-settings-row > * { flex: 1 1 150px; }
.loop-widget-buttons { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 4px 12px; margin: 12px 0; padding: 8px; border: 1px solid var(--border); }
.loop-widget-buttons legend { color: var(--muted); font-size: 12px; }
</style>
