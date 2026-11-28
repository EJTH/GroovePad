<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch, type Ref } from 'vue'
import type { LoopAutomation, LoopNote, LoopRow } from '../../grid'
import { rowKey as loopRowKey } from '../../loopRows'
import { noteName } from '../../music'
import SettingsDialog from '../UI/SettingsDialog.vue'
import SequencePlayhead from './SequencePlayhead.vue'

interface Source { id: string; bankId?: string; label: string; color?: string }
type Row = LoopRow

const props = defineProps<{
  modelValue: LoopNote[]
  automation: LoopAutomation[]
  instruments: Source[]
  sources: Source[]
  barLength: number
  bankId?: string
  clipIndex: number
  playhead?: number
  playheadSource?: { position: Readonly<Ref<number | undefined>> }
  startFullscreen?: boolean
  mutedRows: LoopRow[]
  clipboardRow?: LoopRow
  canPaste: boolean
  canClone: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [notes: LoopNote[]]; 'update:automation': [events: LoopAutomation[]];
  'toggle-mute': [row: Row]; 'remove-row': [row: Row, all: boolean]; 'copy-row': [row: Row]; 'paste-row': []; 'clone-sequence': []; 'exit-fullscreen': [] }>()
const fallbackPlayheadSource = { position: toRef(props, 'playhead') }
const stepLength = 0.25
const stepWidth = ref(28)
const instrumentId = ref('')
const pitch = ref(60)
const extraRows = ref<{ bankId?: string; instrumentId: string; note: number }[]>([])
const selected = ref<{ kind: 'note' | 'automation'; index: number } | null>(null)
const menuRow = ref<Row | null>(null)
const menuOpen = ref(false)
const addingRow = ref(false)
const fullscreen = ref(false)
const fullscreenDialog = ref<HTMLDialogElement | null>(null)
const fullscreenButton = ref<HTMLButtonElement | null>(null)
function showMenu(row: Row | null = null) {
  menuRow.value = row
  addingRow.value = false
  menuOpen.value = true
}
function closeMenu() {
  menuOpen.value = false
  menuRow.value = null
  addingRow.value = false
}
async function toggleFullscreen() {
  const dialog = fullscreenDialog.value
  if (!dialog) return
  if (!fullscreen.value) {
    dialog.showModal()
    fullscreen.value = true
    await nextTick()
    fullscreenButton.value?.focus()
  } else {
    fullscreen.value = false
    await nextTick()
    dialog.close()
    if (props.startFullscreen) emit('exit-fullscreen')
    else fullscreenButton.value?.focus()
  }
}
onMounted(() => { if (props.startFullscreen) void toggleFullscreen() })
let pressTimer: ReturnType<typeof setTimeout> | undefined
let pressPosition: { x: number; y: number } | undefined
let suppressClick = false
function cancelPress() {
  if (pressTimer !== undefined) clearTimeout(pressTimer)
  pressTimer = undefined
  pressPosition = undefined
}
function beginPress(event: PointerEvent, row: Row) {
  if (event.button !== 0) return
  cancelPress()
  suppressClick = false
  pressPosition = { x: event.clientX, y: event.clientY }
  pressTimer = setTimeout(() => { showMenu(row); suppressClick = true; cancelPress() }, 600)
}
function movePress(event: PointerEvent) {
  if (pressPosition && Math.hypot(event.clientX - pressPosition.x, event.clientY - pressPosition.y) > 10) cancelPress()
}
function openMenu(row: Row) {
  if (suppressClick) { suppressClick = false; return }
  showMenu(row)
}
function removeMenuRow(all: boolean) {
  const row = menuRow.value
  if (!row) return
  extraRows.value = extraRows.value.filter((entry) => rowKey({ kind: 'note', ...entry }) !== rowKey(row))
  selected.value = null
  emit('remove-row', row, all)
  closeMenu()
}
function paste() {
  const row = props.clipboardRow
  selected.value = null
  emit('paste-row')
  if (row?.kind === 'note' && !rows.value.some((entry) => rowKey(entry) === rowKey(row))) extraRows.value.push({ ...row })
  closeMenu()
}
function isMuted(row: Row) { return props.mutedRows.some((entry) => rowKey(entry) === rowKey(row)) }
onBeforeUnmount(cancelPress)
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
  for (const row of props.mutedRows) {
    if (!result.some((entry) => rowKey(entry) === rowKey(row))) result.push({ ...row })
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
watch(() => props.clipIndex, () => {
  extraRows.value = []
  selected.value = null
  closeMenu()
})

function effectiveBank(bankId?: string) { return bankId ?? props.bankId ?? '' }
function sameBank(first?: string, second?: string) { return effectiveBank(first) === effectiveBank(second) }
function sourceKey(bankId: string | undefined, id: string) { return JSON.stringify([effectiveBank(bankId), id]) }
function source(id: string, bankId?: string) { return props.sources.find((item) => item.id === id && sameBank(item.bankId, bankId)) }
function rowLabel(row: Row) {
  return row.kind === 'note'
    ? `${source(row.instrumentId, row.bankId)?.label ?? `Missing source (${effectiveBank(row.bankId)} / ${row.instrumentId})`} · ${noteName(row.note)}`
    : `${source(row.sourceId, row.bankId)?.label ?? `Missing control (${effectiveBank(row.bankId)} / ${row.sourceId})`} · ${row.parameter.replace(/^setting:(?:instrument-pad:[^:]+|[^:]+):/, '')}`
}
function rowColor(row: Row) {
  return source(row.kind === 'note' ? row.instrumentId : row.sourceId, row.bankId)?.color ?? '#83c9bb'
}
function rowKey(row: Row) {
  return loopRowKey(row, props.bankId)
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
    closeMenu()
  }
}
const rowExists = computed(() => {
  const instrument = props.instruments.find((item) => sourceKey(item.bankId, item.id) === instrumentId.value)
  return !!instrument && rows.value.some((row) => row.kind === 'note' && sameBank(row.bankId, instrument.bankId) &&
    row.instrumentId === instrument.id && row.note === pitch.value)
})
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
  <dialog ref="fullscreenDialog" class="sequence-fullscreen" aria-label="Full screen sequence editor"
    @cancel.prevent.stop="toggleFullscreen" />
  <Teleport :to="fullscreenDialog ?? 'body'" :disabled="!fullscreen">
  <div class="sequence-editor" :class="{ 'is-fullscreen': fullscreen }">
    <div class="sequence-zoom">
      <span>Clip {{ clipIndex }} · 1/16 steps · scroll horizontally to pan</span>
      <button class="icon-button" type="button" aria-label="Sequence actions" title="Sequence actions" @click="showMenu()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
      </button>
      <button class="icon-button" type="button" aria-label="Zoom out timeline" title="Zoom out timeline" :disabled="stepWidth <= 16" @click="stepWidth = Math.max(16, stepWidth - 8)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="M14.5 14.5 20 20M7 10h6" /></svg>
      </button>
      <button class="icon-button" type="button" aria-label="Zoom in timeline" title="Zoom in timeline" :disabled="stepWidth >= 64" @click="stepWidth = Math.min(64, stepWidth + 8)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="M14.5 14.5 20 20M7 10h6M10 7v6" /></svg>
      </button>
      <button ref="fullscreenButton" class="icon-button" type="button" :aria-label="fullscreen ? 'Exit full screen' : 'Full screen'"
        :title="fullscreen ? 'Exit full screen' : 'Full screen'" :aria-pressed="fullscreen" @click="toggleFullscreen">
        <svg v-if="fullscreen" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
      </button>
    </div>
    <SettingsDialog v-if="menuOpen" :title="addingRow ? 'Add row' : menuRow ? rowLabel(menuRow) : 'Sequence actions'" @close="closeMenu">
      <div v-if="addingRow" class="sequence-add-row" @keydown.enter.prevent="addRow">
        <label>Source <select v-model="instrumentId" :disabled="!instruments.length">
          <option v-for="item in instruments" :key="sourceKey(item.bankId, item.id)" :value="sourceKey(item.bankId, item.id)">{{ item.label }}</option>
        </select></label>
        <label>Note <input v-model.number="pitch" type="number" min="0" max="127" step="1"></label>
        <p v-if="rowExists" role="status">This row already exists.</p>
        <div class="settings-actions">
          <button type="button" @click="addingRow = false">Back</button>
          <button type="button" :disabled="!instrumentId || !Number.isSafeInteger(pitch) || pitch < 0 || pitch > 127 || rowExists" @click="addRow">Add row</button>
        </div>
      </div>
      <div v-else class="row-menu settings-actions">
        <button type="button" @click="addingRow = true">Add row</button>
        <template v-if="menuRow">
          <button type="button" @click="emit('toggle-mute', menuRow); closeMenu()">{{ isMuted(menuRow) ? 'Unmute' : 'Mute' }}</button>
          <button type="button" @click="removeMenuRow(false)">Remove from sequence</button>
          <button type="button" @click="removeMenuRow(true)">Remove from all sequences</button>
          <button type="button" @click="emit('copy-row', menuRow); closeMenu()">Copy</button>
        </template>
        <button v-if="canPaste" type="button" @click="paste">Paste</button>
        <button type="button" :disabled="!canClone" :title="canClone ? '' : 'All clip indices are in use'" @click="emit('clone-sequence'); closeMenu()">Clone sequence</button>
      </div>
    </SettingsDialog>
    <div v-if="steps" class="sequence-scroll" tabindex="0" aria-label="Sequence timeline">
      <div class="sequence-track" :style="{ '--step-width': `${stepWidth}px`, '--step-count': steps }">
        <SequencePlayhead :source="playheadSource ?? fallbackPlayheadSource" :steps="steps" :step-width="stepWidth" />
        <div class="sequence-label header">Bar</div>
        <div class="sequence-steps">
          <div v-for="step in steps" :key="step" class="time-step" :class="{ bar: (step - 1) % 16 === 0 }">{{ (step - 1) % 16 === 0 ? (step - 1) / 16 + 1 : '' }}</div>
        </div>
        <template v-for="row in rows" :key="rowKey(row)">
          <button type="button" class="sequence-label row-label" :class="{ muted: isMuted(row) }" :style="{ borderLeftColor: rowColor(row) }"
            :title="`${rowLabel(row)} — row actions`" :aria-label="`${rowLabel(row)}${isMuted(row) ? ', muted' : ''}, row actions`"
            @pointerdown="beginPress($event, row)" @pointermove="movePress" @pointerup="cancelPress" @pointercancel="cancelPress" @pointerleave="cancelPress"
            @contextmenu.prevent="cancelPress(); showMenu(row)" @click="openMenu(row)">{{ rowLabel(row) }}{{ isMuted(row) ? ' (muted)' : '' }}</button>
          <div class="sequence-steps" :class="{ muted: isMuted(row) }">
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
    <p v-if="!rows.length">No events yet. Use Sequence actions to add a note row, or record into this clip.</p>
    <p v-else>Tap, long-press or right-click a row label for actions. Choose an event to edit it; tap a single event again to delete it. Recorded timing is preserved until edited.</p>
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
  </Teleport>
</template>

<style scoped>
.sequence-zoom, .sequence-details { display: flex; flex-wrap: wrap; align-items: end; gap: 6px; margin: 8px 0; }
.sequence-details label:first-child { flex: 1 1 120px; }
.sequence-details label { flex: 1 1 90px; }
.sequence-details button { min-height: 40px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: inherit; cursor: pointer; }
.sequence-zoom .icon-button { width: 38px; height: 38px; padding: 8px; }
.sequence-zoom .icon-button:disabled { opacity: 0.45; cursor: not-allowed; }
.sequence-zoom span { flex: 1; color: #b7bab1; font-size: 11px; }
.sequence-fullscreen { width: 100%; max-width: none; height: 100%; max-height: none; margin: 0; padding: 0; border: 0; background: #32342f; color: #ecece8; }
.sequence-fullscreen[open] { display: flex; }
.sequence-fullscreen::backdrop { background: #171816; }
.sequence-editor.is-fullscreen { display: flex; flex: 1; flex-direction: column; min-width: 0; padding: 16px; overflow-y: auto; }
.is-fullscreen .sequence-scroll { flex: 1 1 auto; min-height: 120px; max-height: none; }
.sequence-scroll { max-width: 100%; max-height: 280px; overflow: auto; border: 1px solid #565850; background: #171816; }
.sequence-track { position: relative; display: grid; grid-template-columns: 130px max-content; width: max-content; }
.sequence-label { position: sticky; left: 0; z-index: 2; width: 130px; padding: 6px; overflow: hidden; border-left: 4px solid #83c9bb; background: #30322e; color: #ecece8; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.sequence-label.header { border-left-color: transparent; }
.row-label { border-top: 0; border-right: 0; border-bottom: 0; text-align: left; cursor: pointer; touch-action: pan-y; }
.row-label:focus-visible { outline: 2px solid white; outline-offset: -2px; }
.muted { opacity: 0.5; }
.row-menu { flex-direction: column; }
.row-menu button { text-align: left; }
.row-menu button:disabled, .sequence-add-row button:disabled { opacity: 0.5; cursor: not-allowed; }
.sequence-add-row { display: grid; gap: 8px; }
.sequence-add-row label { display: grid; gap: 4px; }
.sequence-add-row input { width: 100%; min-height: 40px; padding: 6px 8px; border: 1px solid #565850; border-radius: 4px; background: #171816; color: inherit; font: inherit; }
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
