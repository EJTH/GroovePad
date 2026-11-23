<script setup lang="ts">
import { computed, watch } from 'vue'
import { MAX_LOOP_CLIP_INDEX, type GridItem, type GridLayout, type LoopAutomation, type LoopNote } from '../grid'
import NumericSetting from './NumericSetting.vue'
import SequenceEditor from './SequenceEditor.vue'
import type { Bank } from '../project'

const props = defineProps<{ draft: Extract<GridItem, { type: 'sequenced-loop' }>; layout: GridLayout; banks?: Bank[]; bankId?: string }>()
const validIndex = computed(() => Number.isSafeInteger(props.draft.settings.clipIndex) &&
  props.draft.settings.clipIndex >= 0 && props.draft.settings.clipIndex <= MAX_LOOP_CLIP_INDEX)
watch(() => props.draft.settings.clipIndex, (index) => {
  if (!validIndex.value) return
  props.draft.settings.clips[String(index)] ??= []
  props.draft.settings.automation[String(index)] ??= []
}, { immediate: true })
const notes = computed({
  get: () => props.draft.settings.clips[String(props.draft.settings.clipIndex)] ?? [],
  set: (value: LoopNote[]) => { if (validIndex.value) props.draft.settings.clips[String(props.draft.settings.clipIndex)] = value },
})
const automation = computed({
  get: () => props.draft.settings.automation[String(props.draft.settings.clipIndex)] ?? [],
  set: (value: LoopAutomation[]) => { if (validIndex.value) props.draft.settings.automation[String(props.draft.settings.clipIndex)] = value },
})
const sources = computed(() => {
  const banks = props.banks ?? [{ id: props.bankId ?? '', title: '', layout: props.layout }]
  return banks.flatMap((bank) => bank.layout.items.map((item) => ({
    id: item.id, bankId: bank.id, label: banks.length > 1 ? `${bank.title} / ${item.label}` : item.label,
    color: 'color' in item.settings ? item.settings.color : undefined, instrument: item.type === 'instrument-pad',
  })))
})
const instruments = computed(() => sources.value.filter((source) => source.instrument))
</script>

<template>
  <div class="settings-section">
    <h3>Sequenced Loop Settings</h3>
    <div class="loop-settings-row">
      <NumericSetting v-model="draft.settings.barLength" label="Bar length" :min="1" :max="64" />
      <NumericSetting v-model="draft.settings.clipIndex" label="Clip index" :min="0" :max="MAX_LOOP_CLIP_INDEX" />
    </div>
    <SequenceEditor v-if="validIndex" :key="draft.settings.clipIndex" v-model="notes" v-model:automation="automation" v-model:quantize="draft.settings.quantize"
      :bar-length="draft.settings.barLength" :instruments="instruments" :sources="sources" :bank-id="bankId" />
    <label class="inline-checkbox"><input v-model="draft.settings.armed" type="checkbox"> Armed for record</label>
    <label class="inline-checkbox"><input v-model="draft.settings.countIn" type="checkbox"> One-bar count-in before recording</label>
    <label class="inline-checkbox"><input v-model="draft.settings.metronome" type="checkbox"> Metronome while armed</label>
    <label>Record from <select v-model="draft.settings.recordScope">
      <option value="bank">Current bank</option><option value="all">All banks</option>
    </select></label>
    <label>Sync mode <select v-model="draft.settings.syncMode">
      <option value="immediate">Immediate</option><option value="sync">Sync to clip length</option>
    </select></label>
  </div>
</template>

<style scoped>
.loop-settings-row { display: flex; flex-wrap: wrap; gap: 8px; }
.loop-settings-row > * { flex: 1 1 150px; }
</style>
