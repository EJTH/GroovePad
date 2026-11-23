<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LoopAutomation, LoopNote, LoopQuantize } from '../grid'
import { noteName } from '../music'

interface Source { id: string; bankId?: string; label: string; color?: string }
type Row = { kind: 'note'; bankId?: string; instrumentId: string; note: number } |
  { kind: 'automation'; bankId?: string; sourceId: string; parameter: string }

const props = defineProps<{
  modelValue: LoopNote[]
  automation: LoopAutomation[]
  instruments: Source[]
  sources: Source[]
  barLength: number
  quantize: LoopQuantize
  bankId?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [notes: LoopNote[]]; 'update:automation': [events: LoopAutomation[]]; 'update:quantize': [value: LoopQuantize] }>()
const stepLength = 0.25
const stepWidth = ref(28)
const instrumentId = ref('')
const pitch = ref(60)
const extraRows = ref<{ bankId?: string; instrumentId: string; note: number }[]>([])
const selected = ref<{ kind: 'note' | 'automation'; index: number } | null>(null)
const steps = computed(() => Number.isSafeInteger(props.barLength) && props.barLength >= 1 && props.barLength <= 64
  ? props.barLength * 16 : 0)
const length = computed(() => steps.value * stepLength)
const rows = computed<Row[]>(() => {
  const result: Row[] = []
  for (const note of [...props.modelValue, ...extraRows.value]) {
    if (!result.some((row) => row.kind === 'note' && sameBank(row.bankId, note.bankId) && row.instrumentId === note.instrumentId && row.note === note.note)) {
      result.push({ kind: 'note', bankId: note.bankId, instrumentId: note.instrumentId, note: note.note })
    }
  }
  for (const event of props.automation) {
    if (!result.some((row) => row.kind === 'automation' && sameBank(row.bankId, event.bankId) && row.sourceId === event.sourceId && row.parameter === event.parameter)) {
      result.push({ kind: 'automation', bankId: event.bankId, sourceId: event.sourceId, parameter: event.parameter })
    }
  }
  return result
})
const selectedNote = computed(() => selected.value?.kind === 'note' ? props.modelValue[selected.value.index] : undefined)
const selectedAutomation = computed(() => selected.value?.kind === 'automation' ? props.automation[selected.value.index] : undefined)
watch(() => props.instruments, (items) => {
  if (!items.some((item) => sourceKey(item.bankId, item.id) === instrumentId.value)) {
    instrumentId.value = items[0] ? sourceKey(items[0].bankId, items[0].id) : ''
  }
}, { immediate: true })

function effectiveBank(bankId?: string) { return bankId ?? props.bankId ?? '' }
function sameBank(first?: string, second?: string) { return effectiveBank(first) === effectiveBank(second) }
function sourceKey(bankId: string | undefined, id: string) { return JSON.stringify([effectiveBank(bankId), id]) }
function source(id: string, bankId?: string) { return props.sources.find((item) => item.id === id && sameBank(item.bankId, bankId)) }
function rowLabel(row: Row) {
  return row.kind === 'note'
    ? `${source(row.instrumentId, row.bankId)?.label ?? `Missing source (${effectiveBank(row.bankId)} / ${row.instrumentId})`} · ${noteName(row.note)}`
    : `${source(row.sourceId, row.bankId)?.label ?? `Missing control (${effectiveBank(row.bankId)} / ${row.sourceId})`} · ${row.parameter}`
}
function rowColor(row: Row) {
  return source(row.kind === 'note' ? row.instrumentId : row.sourceId, row.bankId)?.color ?? '#83c9bb'
}
function rowKey(row: Row) {
  return row.kind === 'note' ? JSON.stringify(['note', effectiveBank(row.bankId), row.instrumentId, row.note])
    : JSON.stringify(['automation', effectiveBank(row.bankId), row.sourceId, row.parameter])
}
const indexedEvents = computed(() => {
  const index = new Map<string, Map<number, { index: number; value: number }[]>>()
  function add(row: Row, position: number, entry: { index: number; value: number }) {
    const key = rowKey(row)
    let cells = index.get(key)
    if (!cells) { cells = new Map(); index.set(key, cells) }
    const step = Math.floor(position / stepLength)
    const entries = cells.get(step) ?? []
    entries.push(entry)
    cells.set(step, entries)
  }
  props.modelValue.forEach((note, i) => add({ kind: 'note', bankId: note.bankId, instrumentId: note.instrumentId, note: note.note }, note.position, { index: i, value: note.velocity }))
  props.automation.forEach((event, i) => add({ kind: 'automation', bankId: event.bankId, sourceId: event.sourceId, parameter: event.parameter }, event.position, { index: i, value: event.value }))
  return index
})
function entries(row: Row, step: number) { return indexedEvents.value.get(rowKey(row))?.get(step) ?? [] }
const selectedPeers = computed(() => {
  const note = selectedNote.value
  if (note) return entries({ kind: 'note', bankId: note.bankId, instrumentId: note.instrumentId, note: note.note }, Math.floor(note.position / stepLength))
  const event = selectedAutomation.value
  if (event) return entries({ kind: 'automation', bankId: event.bankId, sourceId: event.sourceId, parameter: event.parameter }, Math.floor(event.position / stepLength))
  return []
})
function addRow() {
  if (!instrumentId.value || !Number.isSafeInteger(pitch.value) || pitch.value < 0 || pitch.value > 127) return
  const instrument = props.instruments.find((item) => sourceKey(item.bankId, item.id) === instrumentId.value)
  if (!instrument) return
  if (!rows.value.some((row) => row.kind === 'note' && sameBank(row.bankId, instrument.bankId) && row.instrumentId === instrument.id && row.note === pitch.value)) {
    extraRows.value.push({ bankId: sameBank(instrument.bankId, props.bankId) ? undefined : instrument.bankId, instrumentId: instrument.id, note: pitch.value })
  }
}
function addNote(row: Extract<Row, { kind: 'note' }>, step: number) {
  const notes = [...props.modelValue, { bankId: row.bankId, instrumentId: row.instrumentId, note: row.note, velocity: 100,
    position: step * stepLength, duration: stepLength }]
  emit('update:modelValue', notes)
  selected.value = { kind: 'note', index: notes.length - 1 }
}
function changeNote(key: 'instrumentId' | 'note' | 'velocity' | 'position' | 'duration', event: Event) {
  const target = event.target
  const selection = selected.value
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement) || selection?.kind !== 'note') return
  const note = props.modelValue[selection.index]
  if (!note) return
  if (key === 'instrumentId') {
    const instrument = props.instruments.find((item) => sourceKey(item.bankId, item.id) === target.value)
    if (!instrument) return
    emit('update:modelValue', props.modelValue.map((entry, index) => index === selection.index
      ? { ...entry, instrumentId: instrument.id, bankId: sameBank(instrument.bankId, props.bankId) ? undefined : instrument.bankId } : entry))
    return
  }
  if (!target.value.trim()) return
  const value = Number(target.value)
  if (!Number.isFinite(value)) return
  const next = key === 'note' ? Math.max(0, Math.min(127, Math.round(value)))
    : key === 'velocity' ? Math.max(0, Math.min(127, Math.round(value)))
      : key === 'position' ? Math.max(0, Math.min(length.value - stepLength, Math.round(value / stepLength) * stepLength))
        : Math.max(stepLength, Math.min(length.value, Math.round(value / stepLength) * stepLength))
  emit('update:modelValue', props.modelValue.map((entry, index) => index === selection.index ? { ...entry, [key]: next } : entry))
}
function changeAutomation(key: 'position' | 'value', event: Event) {
  const target = event.target
  const selection = selected.value
  if (!(target instanceof HTMLInputElement) || selection?.kind !== 'automation' || !Number.isFinite(target.valueAsNumber)) return
  const value = key === 'position'
    ? Math.max(0, Math.min(length.value - stepLength, Math.round(target.valueAsNumber / stepLength) * stepLength))
    : target.valueAsNumber
  emit('update:automation', props.automation.map((entry, index) => index === selection.index ? { ...entry, [key]: value } : entry))
}
function removeSelected() {
  const selection = selected.value
  if (!selection) return
  if (selection.kind === 'note') emit('update:modelValue', props.modelValue.filter((_, index) => index !== selection.index))
  else emit('update:automation', props.automation.filter((_, index) => index !== selection.index))
  selected.value = null
}
function chooseEvent(kind: 'note' | 'automation', index: number) {
  if (selected.value?.kind === kind && selected.value.index === index) removeSelected()
  else selected.value = { kind, index }
}
function chooseCell(row: Row, step: number) {
  const events = entries(row, step)
  if (!events.length) return
  if (events.length === 1) chooseEvent(row.kind, events[0]!.index)
  else selected.value = { kind: row.kind, index: events[0]!.index }
}
</script>

<template>
  <div class="sequence-editor">
    <label>Record quantize <select :value="quantize" @change="emit('update:quantize', ($event.target as HTMLSelectElement).value as LoopQuantize)">
      <option value="off">Off</option><option value="1/4">1/4</option><option value="1/8">1/8</option>
      <option value="1/16">1/16</option><option value="1/32">1/32</option>
    </select></label>
    <div class="sequence-tools">
      <label>Source <select v-model="instrumentId" :disabled="!instruments.length">
        <option v-for="item in instruments" :key="sourceKey(item.bankId, item.id)" :value="sourceKey(item.bankId, item.id)">{{ item.label }}</option>
      </select></label>
      <label>Note <input v-model.number="pitch" type="number" min="0" max="127" step="1"></label>
      <button type="button" :disabled="!instrumentId || !Number.isSafeInteger(pitch) || pitch < 0 || pitch > 127" @click="addRow">Add row</button>
    </div>
    <div class="sequence-zoom">
      <span>1/16 steps · scroll horizontally to pan</span>
      <button type="button" aria-label="Zoom out timeline" :disabled="stepWidth <= 16" @click="stepWidth = Math.max(16, stepWidth - 8)">−</button>
      <button type="button" aria-label="Zoom in timeline" :disabled="stepWidth >= 64" @click="stepWidth = Math.min(64, stepWidth + 8)">+</button>
    </div>
    <div v-if="steps" class="sequence-scroll" tabindex="0" aria-label="Sequence timeline">
      <div class="sequence-track" :style="{ '--step-width': `${stepWidth}px`, '--step-count': steps }">
        <div class="sequence-label header">Bar</div>
        <div class="sequence-steps">
          <div v-for="step in steps" :key="step" class="time-step" :class="{ bar: (step - 1) % 16 === 0 }">{{ (step - 1) % 16 === 0 ? (step - 1) / 16 + 1 : '' }}</div>
        </div>
        <template v-for="row in rows" :key="rowKey(row)">
          <div class="sequence-label" :style="{ borderLeftColor: rowColor(row) }" :title="rowLabel(row)">{{ rowLabel(row) }}</div>
          <div class="sequence-steps">
            <div v-for="step in steps" :key="step" class="sequence-cell" :class="{ bar: (step - 1) % 16 === 0 }">
              <button v-if="entries(row, step - 1).length" type="button" class="sequence-event"
                :class="{ selected: selected?.kind === row.kind && entries(row, step - 1).some((entry) => selected?.index === entry.index) }"
                :style="{ '--event-color': rowColor(row) }"
                :aria-label="`${rowLabel(row)}, step ${step}, ${entries(row, step - 1).length} events`"
                @click="chooseCell(row, step - 1)">{{ entries(row, step - 1).length > 1 ? `${entries(row, step - 1).length}×` : Number(entries(row, step - 1)[0]!.value.toPrecision(3)) }}</button>
              <button v-if="row.kind === 'note' && !entries(row, step - 1).length" type="button" class="sequence-empty"
                :aria-label="`Add ${rowLabel(row)} at step ${step}`" @click="addNote(row, step - 1)"></button>
            </div>
          </div>
        </template>
      </div>
    </div>
    <p v-if="!rows.length">No events yet. Add a note row or record into this clip.</p>
    <p v-else>Choose an event to edit it. A single event can be tapped again to delete it. Recorded timing is preserved until edited.</p>
    <label v-if="selected && selectedPeers.length > 1">Event in step
      <select :value="selected.index" @change="selected = { kind: selected!.kind, index: Number(($event.target as HTMLSelectElement).value) }">
        <option v-for="(entry, order) in selectedPeers" :key="entry.index" :value="entry.index">{{ order + 1 }}: {{ Number(entry.value.toPrecision(4)) }}</option>
      </select>
    </label>
    <div v-if="selectedNote" class="sequence-details">
      <label>Source <select :value="sourceKey(selectedNote.bankId, selectedNote.instrumentId)" @change="changeNote('instrumentId', $event)">
        <option v-if="!instruments.some((item) => item.id === selectedNote!.instrumentId && sameBank(item.bankId, selectedNote!.bankId))" :value="sourceKey(selectedNote.bankId, selectedNote.instrumentId)">Missing source</option>
        <option v-for="item in instruments" :key="sourceKey(item.bankId, item.id)" :value="sourceKey(item.bankId, item.id)">{{ item.label }}</option>
      </select></label>
      <label>Note <input :value="selectedNote.note" type="number" min="0" max="127" @change="changeNote('note', $event)"></label>
      <label>Velocity <input :value="selectedNote.velocity" type="number" min="0" max="127" @change="changeNote('velocity', $event)"></label>
      <label>Position (beats) <input :value="Number(selectedNote.position.toPrecision(10))" type="number" min="0" :max="length - stepLength" step="0.25" @change="changeNote('position', $event)"></label>
      <label>Duration (beats) <input :value="Number(selectedNote.duration.toPrecision(10))" type="number" min="0.25" :max="length" step="0.25" @change="changeNote('duration', $event)"></label>
      <button type="button" @click="removeSelected">Delete note</button>
    </div>
    <div v-else-if="selectedAutomation" class="sequence-details">
      <label>Position (beats) <input :value="Number(selectedAutomation.position.toPrecision(10))" type="number" min="0" :max="length - stepLength" step="0.25" @change="changeAutomation('position', $event)"></label>
      <label>Value <input :value="selectedAutomation.value" type="number" step="any" @change="changeAutomation('value', $event)"></label>
      <button type="button" @click="removeSelected">Delete automation event</button>
    </div>
  </div>
</template>

<style scoped>
.sequence-tools, .sequence-zoom, .sequence-details { display: flex; flex-wrap: wrap; align-items: end; gap: 6px; margin: 8px 0; }
.sequence-tools label:first-child, .sequence-details label:first-child { flex: 1 1 120px; }
.sequence-tools label:nth-child(2) { width: 70px; }
.sequence-details label { flex: 1 1 90px; }
.sequence-tools button, .sequence-zoom button, .sequence-details button { min-height: 36px; padding: 5px 8px; }
.sequence-zoom span { flex: 1; color: #b7bab1; font-size: 11px; }
.sequence-scroll { max-width: 100%; max-height: 280px; overflow: auto; border: 1px solid #565850; background: #171816; }
.sequence-track { display: grid; grid-template-columns: 130px max-content; width: max-content; }
.sequence-label { position: sticky; left: 0; z-index: 1; width: 130px; padding: 6px; overflow: hidden; border-left: 4px solid #83c9bb; background: #30322e; color: #ecece8; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.sequence-label.header { border-left-color: transparent; }
.sequence-steps { display: grid; grid-template-columns: repeat(var(--step-count), var(--step-width)); }
.time-step { height: 24px; padding: 3px; border-left: 1px solid #41433e; color: #ccc; font-size: 11px; }
.sequence-cell { min-height: 30px; display: flex; border-left: 1px solid #333630; border-top: 1px solid #333630; }
.sequence-cell.bar, .time-step.bar { border-left-color: #9da694; }
.sequence-cell button { flex: 1; min-width: 0; padding: 0; border: 0; cursor: pointer; }
.sequence-empty { background: transparent; }
.sequence-empty:hover, .sequence-empty:focus-visible { background: #ffffff30; }
.sequence-event { overflow: hidden; background: var(--event-color); color: #151715; font-size: 9px; }
.sequence-event.selected { outline: 2px solid white; outline-offset: -2px; }
.sequence-editor p { color: #b7bab1; font-size: 11px; }
</style>
