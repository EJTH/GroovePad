<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { canResizeGrid, canSwapItems, copyControl, createControl, isValidPlacement, MAX_GRID_COLUMNS, MAX_GRID_ROWS, type Connection, type GridItem, type GridLayout, type GridItemType, type HeldNote, type ParameterOutput } from '../grid'
import { createsCycle, inputs, isCompatible, outputs } from '../parameters'
import { effectiveControls } from '../modulation'
import MPCPad from './MPCPad.vue'
import Knob from './Knob.vue'
import LFO from './LFO.vue'
import ModWheel from './ModWheel.vue'
import PianoRoll from './PianoRoll.vue'
import Arpeggiator from './Arpeggiator.vue'
import NumericSetting from './NumericSetting.vue'
import SettingsDialog from './SettingsDialog.vue'

const props = defineProps<{
  layout: GridLayout
  editing: boolean
  wiring: boolean
  settingsOpen: boolean
  bpm: number
}>()
const emit = defineEmits<{ closeSettings: []; output: [itemId: string, output: ParameterOutput] }>()

const grid = ref<HTMLElement | null>(null)
const message = ref('')
const columns = ref(props.layout.columns)
const rows = ref(props.layout.rows)
const selectedId = ref<string | null>(null)
const draft = ref<GridItem | null>(null)
const dropAction = ref<{ original: GridItem; candidate: GridItem; swapId?: string } | null>(null)
const canCopyDrop = computed(() => {
  const drop = dropAction.value
  return !!drop && isValidPlacement(props.layout, copyControl(drop.candidate, nextControlId()))
})
const wireFirst = ref<string | null>(null)
const wireDrag = ref<{ pointerId: number; sourceId: string; x: number; y: number } | null>(null)
const wirePair = ref<{ sourceId: string; targetId: string } | null>(null)
const wireOutput = ref('')
const wireInput = ref('')
const activeNotes = reactive(new Map<string, { count: number; velocity: number }>())
const signals = reactive(new Map<string, number>())
const displayItems = computed(() => props.editing ? props.layout.items : effectiveControls(props.layout, signals))
const sourceItem = computed(() => props.layout.items.find((item) => item.id === wirePair.value?.sourceId))
const targetItem = computed(() => props.layout.items.find((item) => item.id === wirePair.value?.targetId))
const availableOutputs = computed(() => sourceItem.value && targetItem.value
  ? outputs(sourceItem.value).filter((output) => availableInputs(output.id).length > 0) : [])
const availableTargets = computed(() => availableInputs(wireOutput.value))

function availableInputs(outputId: string) {
  const source = sourceItem.value
  const target = targetItem.value
  if (!source || !target || createsCycle(props.layout.connections, source.id, target.id)) return []
  return inputs(target).filter((input) => isCompatible(source, outputId, target, input.id) &&
    !props.layout.connections.some((connection) => connection.sourceId === source.id &&
      connection.sourceParameter === outputId && connection.targetId === target.id && connection.targetParameter === input.id))
}
const interaction = ref<{
  pointerId: number
  mode: 'move' | 'resize'
  startX: number
  startY: number
  original: GridItem
  candidate: GridItem
  moved: boolean
} | null>(null)

const cells = computed(() => Array.from({ length: props.layout.columns * props.layout.rows }, (_, index) => ({
  x: index % props.layout.columns,
  y: Math.floor(index / props.layout.columns),
})))

watch(() => props.editing, (editing) => {
  if (editing) signals.clear()
  if (!editing) {
    selectedId.value = null
    draft.value = null
    interaction.value = null
    dropAction.value = null
    message.value = ''
    activeNotes.clear()
  }
})

watch(() => props.wiring, (wiring) => {
  if (!wiring) {
    wireFirst.value = null
    wireDrag.value = null
    wirePair.value = null
    message.value = ''
  }
})

watch(wireOutput, () => { wireInput.value = '' })

watch(() => props.settingsOpen, (open) => {
  if (open) {
    columns.value = props.layout.columns
    rows.value = props.layout.rows
    message.value = ''
  }
})

function resizeGrid() {
  if (!canResizeGrid(props.layout, columns.value, rows.value)) {
    message.value = 'Use up to 8 columns and 10 rows, and keep all controls inside the grid.'
    return
  }
  props.layout.columns = columns.value
  props.layout.rows = rows.value
  message.value = ''
  emit('closeSettings')
}

function nextControlId() {
  let number = 1
  while (props.layout.items.some((item) => item.id === `control-${number}`)) number++
  return `control-${number}`
}

function addItem(x: number, y: number) {
  selectedId.value = null
  draft.value = createControl(nextControlId(), x, y, 'pad')
  message.value = ''
}

function isOccupied(x: number, y: number) {
  return props.layout.items.some((item) =>
    x >= item.x && x < item.x + item.width && y >= item.y && y < item.y + item.height,
  )
}

function openSettings(item: GridItem) {
  selectedId.value = item.id
  draft.value = copyControl(item, item.id)
  message.value = ''
}

function changeType(event: Event) {
  const target = event.target
  const item = draft.value
  if (!(target instanceof HTMLSelectElement) || !item) return
  const type = target.value as GridItemType
  if (type === item.type) return
  const replacement = createControl(item.id, item.x, item.y, type)
  replacement.width = item.width
  replacement.height = item.height
  if (item.label !== 'Pad' && item.label !== 'Knob') replacement.label = item.label
  draft.value = replacement
}

function saveItem() {
  const item = draft.value
  if (!item) return
  if (!item.label.trim()) {
    message.value = 'Enter a control name.'
    return
  }
  if (!isValidPlacement(props.layout, item)) {
    message.value = 'The control must fit inside the grid without overlapping another control.'
    return
  }
  if (item.type === 'knob') {
    const { min, max, step, defaultValue, value } = item.settings
    if (![min, max, step, defaultValue, value].every(Number.isFinite) || min >= max || step <= 0 ||
      step > max - min || defaultValue < min || defaultValue > max || value < min || value > max) {
      message.value = 'Use a valid range and positive step; default and current values must be inside the range.'
      return
    }
    if (selectedId.value && props.layout.connections.some((connection) => {
      const source = connection.sourceId === item.id ? item : props.layout.items.find((entry) => entry.id === connection.sourceId)
      const target = connection.targetId === item.id ? item : props.layout.items.find((entry) => entry.id === connection.targetId)
      return !source || !target || !isCompatible(source, connection.sourceParameter, target, connection.targetParameter)
    })) {
      message.value = 'Remove incompatible wires before changing the control type.'
      return
    }
  }
  const index = props.layout.items.findIndex((entry) => entry.id === selectedId.value)
  if (index !== -1) props.layout.items[index] = { ...item, label: item.label.trim() }
  else props.layout.items.push({ ...item, label: item.label.trim() })
  selectedId.value = null
  draft.value = null
  message.value = ''
}

function handleOutput(item: GridItem, output: ParameterOutput) {
  const original = props.layout.items.find((entry) => entry.id === item.id)
  if (!original) return
  if (original.type === 'knob' && item.type === 'knob' && output.parameter === 'value') {
    const adjusted = original.settings.value + output.value - item.settings.value
    original.settings.value = Math.max(original.settings.min, Math.min(original.settings.max, adjusted))
  } else if (output.on === undefined) {
    signals.set(`${item.id}:${output.parameter}`, output.value)
  }
  emit('output', item.id, output)
  const sourceParameter = outputs(item).find((parameter) => parameter.id === output.parameter)
  if (!sourceParameter || sourceParameter.kind !== 'note') return
  for (const connection of props.layout.connections) {
    if (connection.sourceId !== item.id || connection.sourceParameter !== output.parameter) continue
    const target = props.layout.items.find((entry) => entry.id === connection.targetId)
    const targetParameter = target && inputs(target).find((parameter) => parameter.id === connection.targetParameter)
    if (!target || !targetParameter) continue
    if (targetParameter.kind === 'note' && (target.type === 'pad' || target.type === 'arpeggiator')) {
      const key = `${connection.id}:${output.value}`
      const previous = activeNotes.get(key)
      const count = previous?.count ?? 0
      if (output.on) activeNotes.set(key, { count: count + 1, velocity: output.velocity ?? 100 })
      else if (count > 1) activeNotes.set(key, { count: count - 1, velocity: previous!.velocity })
      else activeNotes.delete(key)
      if (target.type === 'pad') emit('output', target.id, { parameter: 'note', value: output.value, on: output.on, velocity: output.velocity })
    }
  }
}

function padActive(id: string) {
  return props.layout.connections.some((connection) => connection.targetId === id &&
    [...activeNotes.keys()].some((key) => key.startsWith(`${connection.id}:`)))
}

function receivedNotes(id: string): HeldNote[] {
  const notes = new Map<number, HeldNote>()
  for (const connection of props.layout.connections) {
    if (connection.targetId !== id || connection.targetParameter !== 'note') continue
    const prefix = `${connection.id}:`
    for (const [key, active] of activeNotes) {
      if (!key.startsWith(prefix)) continue
      const note = Number(key.slice(prefix.length))
      const previous = notes.get(note)
      notes.set(note, { note, count: (previous?.count ?? 0) + active.count, velocity: active.velocity })
    }
  }
  return [...notes.values()].sort((a, b) => a.note - b.note)
}

function toggleArpeggiator(id: string) {
  const item = props.layout.items.find((entry) => entry.id === id)
  if (item?.type === 'arpeggiator') item.settings.enabled = !item.settings.enabled
}
function connectWire() {
  const source = sourceItem.value
  const target = targetItem.value
  if (!target || !source || !wireOutput.value || !wireInput.value ||
    !isCompatible(source, wireOutput.value, target, wireInput.value) ||
    createsCycle(props.layout.connections, source.id, target.id) ||
    !availableInputs(wireOutput.value).some((option) => option.id === wireInput.value)) {
    message.value = 'Choose a compatible source that does not create a cycle or duplicate wire.'
    return
  }
  let number = 1
  while (props.layout.connections.some((connection) => connection.id === `wire-${number}`)) number++
  props.layout.connections.push({ id: `wire-${number}`, sourceId: source.id, sourceParameter: wireOutput.value,
    targetId: target.id, targetParameter: wireInput.value })
  wirePair.value = null
  message.value = ''
}

function selectWirePair(sourceId: string, targetId: string) {
  if (sourceId === targetId) {
    wireFirst.value = sourceId
    return
  }
  wirePair.value = { sourceId, targetId }
  wireFirst.value = null
  wireOutput.value = ''
  wireInput.value = ''
  message.value = ''
}

function wirePointerDown(event: PointerEvent, item: GridItem) {
  if (event.button !== 0 || wireDrag.value) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement) || !grid.value) return
  event.preventDefault()
  target.setPointerCapture(event.pointerId)
  const rect = grid.value.getBoundingClientRect()
  wireDrag.value = { pointerId: event.pointerId, sourceId: wireFirst.value ?? item.id,
    x: (event.clientX - rect.left) / rect.width * 100, y: (event.clientY - rect.top) / rect.height * 100 }
}

function wirePointerMove(event: PointerEvent) {
  if (!wireDrag.value || wireDrag.value.pointerId !== event.pointerId || !grid.value) return
  const rect = grid.value.getBoundingClientRect()
  wireDrag.value.x = (event.clientX - rect.left) / rect.width * 100
  wireDrag.value.y = (event.clientY - rect.top) / rect.height * 100
}

function wirePointerEnd(event: PointerEvent, cancelled = false) {
  const drag = wireDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  wireDrag.value = null
  if (cancelled) return
  const element = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-wire-id]')
  const targetId = element instanceof HTMLElement && grid.value?.contains(element) ? element.dataset.wireId : undefined
  if (targetId) selectWirePair(drag.sourceId, targetId)
}

function keyboardWire(item: GridItem) {
  if (!wireFirst.value) wireFirst.value = item.id
  else selectWirePair(wireFirst.value, item.id)
}

function wireStartPosition(id: string) {
  const item = props.layout.items.find((entry) => entry.id === id)!
  return { x: (item.x + item.width / 2) / props.layout.columns * 100,
    y: (item.y + item.height / 2) / props.layout.rows * 100 }
}

function removeWire(connection: Connection) {
  props.layout.connections.splice(props.layout.connections.indexOf(connection), 1)
  for (const key of activeNotes.keys()) if (key.startsWith(`${connection.id}:`)) activeNotes.delete(key)
}

function connectionLabel(connection: Connection) {
  const source = props.layout.items.find((item) => item.id === connection.sourceId)
  const target = props.layout.items.find((item) => item.id === connection.targetId)
  return `${source?.label} / ${source && outputs(source).find((parameter) => parameter.id === connection.sourceParameter)?.label} → ${target?.label} / ${target && inputs(target).find((parameter) => parameter.id === connection.targetParameter)?.label}`
}

function wireLine(connection: Connection) {
  const source = props.layout.items.find((item) => item.id === connection.sourceId)!
  const target = props.layout.items.find((item) => item.id === connection.targetId)!
  return { x1: (source.x + source.width / 2) / props.layout.columns * 100,
    y1: (source.y + source.height / 2) / props.layout.rows * 100,
    x2: (target.x + target.width / 2) / props.layout.columns * 100,
    y2: (target.y + target.height / 2) / props.layout.rows * 100 }
}

function removeItem() {
  const index = props.layout.items.findIndex((item) => item.id === selectedId.value)
  if (index !== -1) props.layout.items.splice(index, 1)
  for (const connection of [...props.layout.connections]) {
    if (connection.sourceId === selectedId.value || connection.targetId === selectedId.value) removeWire(connection)
  }
  selectedId.value = null
  draft.value = null
  message.value = ''
}

function startInteraction(event: PointerEvent, item: GridItem, mode: 'move' | 'resize') {
  if (!props.editing || interaction.value || event.button !== 0) return
  event.preventDefault()
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  target.setPointerCapture(event.pointerId)
  interaction.value = {
    pointerId: event.pointerId,
    mode,
    startX: event.clientX,
    startY: event.clientY,
    original: { ...item },
    candidate: { ...item },
    moved: false,
  }
}

function updateInteraction(event: PointerEvent) {
  const current = interaction.value
  if (!current || current.pointerId !== event.pointerId || !grid.value) return
  const style = window.getComputedStyle(grid.value)
  const columnGap = parseFloat(style.columnGap) || 0
  const rowGap = parseFloat(style.rowGap) || 0
  const rect = grid.value.getBoundingClientRect()
  const stepX = (rect.width + columnGap) / props.layout.columns
  const stepY = (rect.height + rowGap) / props.layout.rows
  const dx = event.clientX - current.startX
  const dy = event.clientY - current.startY
  current.moved ||= Math.abs(dx) > 5 || Math.abs(dy) > 5
  const deltaX = Math.round(dx / stepX)
  const deltaY = Math.round(dy / stepY)
  current.candidate = current.mode === 'move'
    ? { ...current.original, x: current.original.x + deltaX, y: current.original.y + deltaY }
    : { ...current.original, width: current.original.width + deltaX, height: current.original.height + deltaY }
}

function endInteraction(event: PointerEvent, cancelled = false) {
  const current = interaction.value
  if (!current || current.pointerId !== event.pointerId) return
  if (!cancelled) updateInteraction(event)
  interaction.value = null
  if (cancelled) return
  if (!current.moved && current.mode === 'move') {
    openSettings(current.original)
  } else if (current.moved && current.mode === 'move') {
    if (!grid.value) return
    const rect = grid.value.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) {
      message.value = 'Drop the control inside the grid.'
      return
    }
    const x = Math.floor((event.clientX - rect.left) / rect.width * props.layout.columns)
    const y = Math.floor((event.clientY - rect.top) / rect.height * props.layout.rows)
    const target = props.layout.items.find((item) => item.id !== current.original.id &&
      x >= item.x && x < item.x + item.width && y >= item.y && y < item.y + item.height)
    if (target) {
      if (!canSwapItems(props.layout, current.original, target)) {
        message.value = 'These controls cannot be swapped without overlapping or leaving the grid.'
        return
      }
      dropAction.value = { original: current.original, candidate: current.candidate, swapId: target.id }
    } else if (current.candidate.x !== current.original.x || current.candidate.y !== current.original.y) {
      if (!isValidPlacement(props.layout, current.candidate)) {
        message.value = 'The control must fit inside the grid without overlapping another control.'
        return
      }
      dropAction.value = { original: current.original, candidate: current.candidate }
    }
    message.value = ''
  } else if (current.moved) {
    if (isValidPlacement(props.layout, current.candidate)) {
      const index = props.layout.items.findIndex((item) => item.id === current.original.id)
      if (index !== -1) props.layout.items[index] = current.candidate
      message.value = ''
    } else {
      message.value = 'The control must fit inside the grid without overlapping another control.'
    }
  }
}

function completeDrop(action: 'move' | 'copy' | 'swap') {
  const drop = dropAction.value
  if (!drop) return
  const index = props.layout.items.findIndex((item) => item.id === drop.original.id)
  if (index < 0) {
    message.value = 'The control no longer exists.'
  } else if (action === 'swap') {
    const otherIndex = props.layout.items.findIndex((item) => item.id === drop.swapId)
    const first = props.layout.items[index]
    const other = props.layout.items[otherIndex]
    if (!first || !other || !canSwapItems(props.layout, first, other)) {
      message.value = 'These controls cannot be swapped without overlapping or leaving the grid.'
    } else {
      props.layout.items[index] = { ...first, x: other.x, y: other.y }
      props.layout.items[otherIndex] = { ...other, x: first.x, y: first.y }
      message.value = ''
    }
  } else {
    const candidate = action === 'copy' ? copyControl(drop.candidate, nextControlId()) : drop.candidate
    if (!isValidPlacement(props.layout, candidate)) {
      message.value = 'The control must fit inside the grid without overlapping another control.'
    } else if (action === 'copy') {
      props.layout.items.push(candidate)
      message.value = ''
    } else {
      props.layout.items[index] = candidate
      message.value = ''
    }
  }
  dropAction.value = null
}

function itemStyle(item: GridItem) {
  const candidate = interaction.value?.original.id === item.id ? interaction.value.candidate : item
  // Keep an invalid preview in its original position rather than expanding the CSS grid.
  const position = isValidPlacement(props.layout, candidate) ? candidate : item
  return {
    gridColumn: `${position.x + 1} / span ${position.width}`,
    gridRow: `${position.y + 1} / span ${position.height}`,
  }
}
</script>

<template>
  <div class="grid-editor">
    <p v-if="editing && !wiring" class="edit-hint">Tap + to add a control. Tap a control to edit it.</p>
    <p v-if="wiring" class="edit-hint">{{ wireFirst ? 'Choose a destination control.' : 'Drag from a source to a destination, or tap each in order.' }}</p>
    <p v-if="message && !draft && !settingsOpen" class="grid-message" role="alert">{{ message }}</p>

    <div class="grid-area">
      <div
        ref="grid"
        class="groove-grid"
        :style="{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))` }"
      >
        <svg v-if="wiring && (layout.connections.length || wireDrag)" class="wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line v-for="connection in layout.connections" :key="connection.id" v-bind="wireLine(connection)" vector-effect="non-scaling-stroke" />
          <line v-if="wireDrag" :x1="wireStartPosition(wireDrag.sourceId).x" :y1="wireStartPosition(wireDrag.sourceId).y" :x2="wireDrag.x" :y2="wireDrag.y" vector-effect="non-scaling-stroke" />
        </svg>
        <button
          v-for="cell in cells"
          :key="`${cell.x}-${cell.y}`"
          type="button"
          class="grid-cell"
          :class="{ editable: editing && !wiring }"
          :style="{ gridColumn: cell.x + 1, gridRow: cell.y + 1 }"
          :disabled="!editing || wiring || isOccupied(cell.x, cell.y)"
          :aria-label="`Add control at column ${cell.x + 1}, row ${cell.y + 1}`"
          @click="addItem(cell.x, cell.y)"
        ><span v-if="editing && !wiring" aria-hidden="true">+</span></button>

        <div v-for="item in displayItems" :key="item.id" class="grid-item" :style="itemStyle(item)">
          <div v-if="!editing" class="grid-item-component">
            <MPCPad v-if="item.type === 'pad'" :label="item.label" :settings="item.settings" :wired-active="padActive(item.id)" @output="handleOutput(item, $event)" />
            <Knob v-else-if="item.type === 'knob'" :label="item.label" :settings="item.settings" emit-initial @output="handleOutput(item, $event)" />
            <LFO v-else-if="item.type === 'lfo'" :label="item.label" :settings="item.settings" :bpm="bpm" @output="handleOutput(item, $event)" />
            <ModWheel v-else-if="item.type === 'mod-wheel'" :label="item.label" :settings="item.settings" @output="handleOutput(item, $event)" />
            <PianoRoll v-else-if="item.type === 'piano-roll'" :label="item.label" :settings="item.settings" @output="handleOutput(item, $event)" />
            <Arpeggiator v-else :label="item.label" :settings="item.settings" :bpm="bpm" :notes="receivedNotes(item.id)" @output="handleOutput(item, $event)" @toggle="toggleArpeggiator(item.id)" />
          </div>
          <button
            v-else
            type="button"
            class="grid-item-main editing"
            :aria-label="`Edit or move ${item.label}`"
            @pointerdown="startInteraction($event, item, 'move')"
            @pointermove="updateInteraction"
            @pointerup="endInteraction($event)"
            @pointercancel="endInteraction($event, true)"
            @click="editing && $event.detail === 0 && openSettings(item)"
          >{{ item.label }}</button>
          <button
            v-if="editing && !wiring"
            type="button"
            class="resize-handle"
            :aria-label="`Resize ${item.label}; or use control settings`"
            @pointerdown.stop="startInteraction($event, item, 'resize')"
            @pointermove="updateInteraction"
            @pointerup="endInteraction($event)"
            @pointercancel="endInteraction($event, true)"
            @click="$event.detail === 0 && openSettings(item)"
          ><span aria-hidden="true">◢</span></button>
          <button v-if="wiring" type="button" class="wire-control" :class="{ selected: wireFirst === item.id }"
            :data-wire-id="item.id" :aria-label="`Wire ${item.label}`"
            @pointerdown="wirePointerDown($event, item)" @pointermove="wirePointerMove"
            @pointerup="wirePointerEnd($event)" @pointercancel="wirePointerEnd($event, true)"
            @lostpointercapture="wirePointerEnd($event, true)"
            @click="$event.detail === 0 && keyboardWire(item)">
            {{ item.label }}
          </button>
        </div>
      </div>
    </div>

    <SettingsDialog v-if="dropAction" title="Place control" @close="dropAction = null">
      <p v-if="dropAction.swapId">Swap these controls?</p>
      <p v-else>Move or copy this control? Copies do not include wires.</p>
      <div class="settings-actions">
        <button v-if="dropAction.swapId" type="button" @click="completeDrop('swap')">Swap</button>
        <template v-else>
          <button type="button" @click="completeDrop('move')">Move</button>
          <button type="button" :disabled="!canCopyDrop" @click="completeDrop('copy')">Copy</button>
        </template>
        <button type="button" @click="dropAction = null">Cancel</button>
      </div>
      <p v-if="!dropAction.swapId && !canCopyDrop" class="grid-message">There is not enough separate space to copy here.</p>
    </SettingsDialog>

    <SettingsDialog v-if="settingsOpen" title="Grid settings" @close="emit('closeSettings')">
      <form class="settings-form" @submit.prevent="resizeGrid">
        <div class="settings-dimensions grid-dimensions">
          <NumericSetting v-model="columns" label="Columns" :min="1" :max="MAX_GRID_COLUMNS" />
          <NumericSetting v-model="rows" label="Rows" :min="1" :max="MAX_GRID_ROWS" />
        </div>
        <p v-if="message" class="grid-message" role="alert">{{ message }}</p>
        <div class="settings-actions">
          <button type="submit">Apply</button>
          <button type="button" @click="emit('closeSettings')">Cancel</button>
        </div>
      </form>
    </SettingsDialog>

    <SettingsDialog v-if="draft" title="Control settings" @close="draft = null; selectedId = null; message = ''">
      <form v-if="draft" class="settings-form" @submit.prevent="saveItem">
        <label>
          Type
          <select :value="draft.type" required @change="changeType">
            <option value="pad">MPC Pad</option>
            <option value="knob">Knob</option>
            <option value="lfo">LFO</option>
            <option value="mod-wheel">Mod Wheel</option>
            <option value="piano-roll">Piano Roll</option>
            <option value="arpeggiator">Arpeggiator</option>
          </select>
        </label>
        <label>Name <input v-model="draft.label" maxlength="40" required /></label>
        
        <template v-if="draft.type === 'pad'">
          <div class="settings-section">
            <h3>Pad Settings</h3>
            <label>Color <input v-model="draft.settings.color" type="color" required /></label>
          </div>
        </template>
        
        <template v-else-if="draft.type === 'knob'">
          <div class="settings-section">
            <h3>Knob Settings</h3>
            <NumericSetting v-model="draft.settings.min" label="Minimum" :step="0.1" />
            <NumericSetting v-model="draft.settings.max" label="Maximum" :step="0.1" />
            <NumericSetting v-model="draft.settings.step" label="Step" :step="0.01" />
            <NumericSetting :model-value="draft.settings.defaultValue" label="Default value" :step="0.1" @update:model-value="draft.settings.defaultValue = $event; if (!selectedId) draft.settings.value = $event" />
            <NumericSetting v-model="draft.settings.value" label="Current value" :step="0.1" />
            <label>Unit <input v-model="draft.settings.unit" type="text" maxlength="10" /></label>
            <label>Color <input v-model="draft.settings.color" type="color" required /></label>
          </div>
        </template>
        <div v-else-if="draft.type === 'lfo'" class="settings-section">
          <h3>LFO Settings</h3>
          <label>Waveform <select v-model="draft.settings.waveform"><option value="sine">Sine</option><option value="saw">Saw</option><option value="square">Square</option><option value="random">Random</option></select></label>
          <label>Rate mode <select v-model="draft.settings.rateMode"><option value="free">Hz</option><option value="sync">Cycles per beat</option></select></label>
          <NumericSetting v-model="draft.settings.rate" label="Rate" :min="0.01" :max="20" :step="0.01" />
          <NumericSetting v-model="draft.settings.depth" label="Depth" :min="0" :max="1" :step="0.01" />
          <NumericSetting v-model="draft.settings.offset" label="Offset" :min="-1" :max="1" :step="0.01" />
          <NumericSetting v-model="draft.settings.smoothness" label="Smoothness" :min="0" :max="0.99" :step="0.01" />
        </div>
        <div v-else-if="draft.type === 'mod-wheel'" class="settings-section">
          <h3>Mod Wheel Settings</h3>
          <NumericSetting v-model="draft.settings.depth" label="Depth" :min="0" :max="1" :step="0.01" />
          <label class="inline-checkbox"><input v-model="draft.settings.autoCenter" type="checkbox" /> Auto-center</label>
        </div>
        <div v-else-if="draft.type === 'piano-roll'" class="settings-section">
          <h3>Piano Roll Settings</h3>
          <NumericSetting v-model="draft.settings.octaves" label="Octaves" :min="1" :max="3" />
          <NumericSetting v-model="draft.settings.transpose" label="Transpose" :min="-36" :max="36" />
          <label>Scale <select v-model="draft.settings.scale"><option value="chromatic">Chromatic</option><option value="major">Major</option><option value="minor">Minor</option><option value="pentatonic">Pentatonic</option></select></label>
          <label>Orientation <select v-model="draft.settings.orientation"><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select></label>
        </div>
        <div v-else class="settings-section">
          <h3>Arpeggiator Settings</h3>
          <label>Style <select v-model="draft.settings.style"><option value="up">Up</option><option value="down">Down</option><option value="up-down">Up-down</option><option value="random">Random</option></select></label>
          <label>Rate <select v-model="draft.settings.rate"><option value="1/1">1/1</option><option value="3/4">3/4</option><option value="1/2">1/2</option><option value="1/4">1/4</option><option value="1/8">1/8</option><option value="1/16">1/16</option><option value="1/32">1/32</option></select></label>
          <NumericSetting v-model="draft.settings.distance" label="Distance (st)" :min="-24" :max="24" />
          <NumericSetting v-model="draft.settings.steps" label="Steps" :min="1" :max="16" />
          <NumericSetting v-model="draft.settings.gate" label="Gate" :min="0.05" :max="1" :step="0.05" />
          <label>Scale <select v-model="draft.settings.scale"><option value="chromatic">Chromatic</option><option value="major">Major</option><option value="minor">Minor</option><option value="pentatonic">Pentatonic</option></select></label>
        </div>

        <div v-if="selectedId && layout.connections.some((connection) => connection.sourceId === selectedId || connection.targetId === selectedId)" class="settings-section">
          <h3>Connections</h3>
          <div v-for="connection in layout.connections.filter((entry) => entry.sourceId === selectedId || entry.targetId === selectedId)" :key="connection.id" class="wire-entry">
            <span>{{ connectionLabel(connection) }}</span>
            <button type="button" class="wire-button" @click="removeWire(connection)">Remove wire</button>
          </div>
        </div>

        <div class="settings-dimensions">
          <NumericSetting :model-value="draft.x + 1" label="Column" :min="1" :max="layout.columns" @update:model-value="draft.x = $event - 1" />
          <NumericSetting :model-value="draft.y + 1" label="Row" :min="1" :max="layout.rows" @update:model-value="draft.y = $event - 1" />
          <NumericSetting v-model="draft.width" label="Width" :min="1" :max="layout.columns" />
          <NumericSetting v-model="draft.height" label="Height" :min="1" :max="layout.rows" />
        </div>
        <p v-if="message" class="grid-message" role="alert">{{ message }}</p>
        <div class="settings-actions">
          <button type="submit">Save</button>
          <button type="button" @click="draft = null; selectedId = null; message = ''">Cancel</button>
          <button v-if="selectedId" type="button" class="remove-button" @click="removeItem">Remove</button>
        </div>
      </form>
    </SettingsDialog>
    <SettingsDialog v-if="wirePair && sourceItem && targetItem" title="Connect controls" @close="wirePair = null; message = ''">
      <form class="settings-form" @submit.prevent="connectWire">
        <p>{{ sourceItem.label }} → {{ targetItem.label }}</p>
        <label>Source output
          <select v-model="wireOutput" required>
            <option value="">Choose an output</option>
            <option v-for="parameter in availableOutputs" :key="parameter.id" :value="parameter.id">{{ parameter.label }}</option>
          </select>
        </label>
        <label>Destination input
          <select v-model="wireInput" required :disabled="!wireOutput">
            <option value="">Choose an input</option>
            <option v-for="parameter in availableTargets" :key="parameter.id" :value="parameter.id">{{ parameter.label }}</option>
          </select>
        </label>
        <p v-if="!availableOutputs.length" class="grid-message">No compatible connection is available between these controls.</p>
        <p v-if="message" class="grid-message" role="alert">{{ message }}</p>
        <div class="settings-actions">
          <button type="submit" :disabled="!wireInput">Connect</button>
          <button type="button" @click="wirePair = null; message = ''">Cancel</button>
        </div>
      </form>
    </SettingsDialog>
  </div>
</template>
