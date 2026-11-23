<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { canResizeGrid, canSwapItems, copyControl, createControl, isValidPlacement, MAX_GRID_COLUMNS, MAX_GRID_ROWS, validPianoRollSettings, type Connection, type GridItem, type GridLayout, type GridItemType, type HeldNote, type ParameterOutput } from '../grid'
import { createsCycle, inputs, isCompatible, outputs, selectedSelectorWire, selectorConnectionsCompatible } from '../parameters'
import { effectiveControls, modulationOffset, normalizeSignal, numericSignal, selectorNumericValue, setConnectionMappingMode, signalSource } from '../modulation'
import { noteName } from '../music'
import * as Tone from 'tone'
import { InstrumentFactory, type InstrumentInstance } from '../instruments'
import MPCPad from './MPCPad.vue'
import Knob from './Knob.vue'
import LFO from './LFO.vue'
import ModWheel from './ModWheel.vue'
import PianoRoll from './PianoRoll.vue'
import Arpeggiator from './Arpeggiator.vue'
import InstrumentPad from './InstrumentPad.vue'
import InstrumentPadSettingsPanel from './instruments/InstrumentPadSettingsPanel.vue'
import KnobSettingsPanel from './KnobSettingsPanel.vue'
import LFOSettingsPanel from './LFOSettingsPanel.vue'
import ModWheelSettingsPanel from './ModWheelSettingsPanel.vue'
import PianoRollSettingsPanel from './PianoRollSettingsPanel.vue'
import ArpeggiatorSettingsPanel from './ArpeggiatorSettingsPanel.vue'
import NumericSetting from './NumericSetting.vue'
import ControlIdentitySettings from './ControlIdentitySettings.vue'
import SettingsDialog from './SettingsDialog.vue'
import OutputSelector from './OutputSelector.vue'
import ConnectionMapping from './ConnectionMapping.vue'

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
const controlIdentity = ref<InstanceType<typeof ControlIdentitySettings> | null>(null)
const addPosition = ref<{ x: number; y: number } | null>(null)
const controlTypes: { type: GridItemType; label: string; description: string; icon: string }[] = [
  { type: 'instrument-pad', label: 'Instrument Pad', description: 'Play a sound', icon: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M9 13l2 2 4-6' },
  { type: 'pad', label: 'Pad', description: 'Trigger a control', icon: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M12 8v8 M8 12h8' },
  { type: 'knob', label: 'Knob', description: 'Adjust a value', icon: 'M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9z M12 12l4-4' },
  { type: 'lfo', label: 'LFO', description: 'Modulate with a wave', icon: 'M2 12c2.5 0 2.5-7 5-7s2.5 14 5 14 2.5-14 5-14 2.5 7 5 7' },
  { type: 'mod-wheel', label: 'Mod Wheel', description: 'Control modulation', icon: 'M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M7 11h10 M7 14h10' },
  { type: 'piano-roll', label: 'Piano Roll', description: 'Play notes', icon: 'M3 5h18v14H3z M9 5v14 M15 5v14 M6 5v7 M12 5v7 M18 5v7' },
  { type: 'arpeggiator', label: 'Arpeggiator', description: 'Sequence held notes', icon: 'M4 19h3v-4H4z M10 19h3V9h-3z M16 19h3V4h-3z' },
  { type: 'output-selector', label: 'Output Selector', description: 'Route a signal', icon: 'M3 12h7 M10 12l5-6h6 M10 12l5 6h6 M18 3l3 3-3 3 M18 15l3 3-3 3' },
]
const sampleLoading = ref(false)
let preview: InstrumentInstance | undefined
let previewGeneration = 0
let previewVelocity = 100

function stopPreview() {
  previewGeneration++
  preview?.dispose()
  preview = undefined
}

async function previewInstrument(velocity: number) {
  const item = draft.value
  if (!item || item.type !== 'instrument-pad') return
  if (sampleLoading.value) {
    message.value = 'Wait for the sample to finish loading.'
    return
  }
  const generation = ++previewGeneration
  preview?.release()
  try {
    await Tone.start()
    if (generation !== previewGeneration) return
    preview ??= InstrumentFactory.create(item.settings.instrumentType, item.settings.instrumentParams)
    await preview.trigger(velocity, 60)
    if (generation !== previewGeneration) return
    message.value = ''
  } catch (error) {
    if (generation === previewGeneration) {
      message.value = `Preview error: ${error instanceof Error ? error.message : String(error)}`
      console.error(message.value, error)
    }
  }
}

function handlePreviewOutput(output: ParameterOutput) {
  if (output.parameter === 'velocity') previewVelocity = output.value
  if (output.parameter === 'gate') {
    if (output.value > 0) void previewInstrument(previewVelocity)
    else {
      previewGeneration++
      preview?.release()
    }
  }
}

watch(() => draft.value?.type === 'instrument-pad'
  ? [draft.value.settings.instrumentType, draft.value.settings.instrumentParams] : null,
stopPreview, { deep: true, flush: 'sync' })
onBeforeUnmount(stopPreview)
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
const wireDraft = ref<Connection | null>(null)
const activeNotes = reactive(new Map<string, { count: number; velocity: number; bend?: number }>())
const signals = reactive(new Map<string, number>())
const selectorNotes = reactive(new Map<string, number>())
const selectorFlash = ref<{ sourceId: string; targetId: string; sequence: number } | null>(null)
let selectorFlashSequence = 0
let selectorFlashTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(selectorFlashTimer))
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
  return inputs(target).filter((input) => selectorConnectionsCompatible(props.layout.items, props.layout.connections,
    { id: '', sourceId: source.id, sourceParameter: outputId, targetId: target.id, targetParameter: input.id }) &&
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
  if (editing) { signals.clear(); selectorNotes.clear() }
  if (!editing) {
    selectedId.value = null
    draft.value = null
    addPosition.value = null
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

watch(wireOutput, () => { wireInput.value = '' }, { flush: 'sync' })
watch([wirePair, wireOutput, wireInput], ([pair, output, input]) => {
  wireDraft.value = pair && output && input
    ? { id: '', sourceId: pair.sourceId, sourceParameter: output, targetId: pair.targetId, targetParameter: input }
    : null
  message.value = ''
}, { flush: 'sync' })

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
  addPosition.value = { x, y }
  message.value = ''
}

function chooseControlType(type: GridItemType) {
  const position = addPosition.value
  if (!position) return
  addPosition.value = null
  draft.value = createControl(nextControlId(), position.x, position.y, type)
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
  replacement.orientation = item.orientation
  if (item.label !== 'Pad' && item.label !== 'Knob') replacement.label = item.label
  draft.value = replacement
}

function saveItem() {
  const item = draft.value
  if (!item) return
  if (sampleLoading.value) {
    message.value = 'Wait for the sample to finish loading.'
    return
  }
  if (!item.label.trim()) {
    controlIdentity.value?.open()
    message.value = 'Enter a control name.'
    return
  }
  if (!isValidPlacement(props.layout, item)) {
    controlIdentity.value?.open()
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
  }
  if (item.type === 'piano-roll' && !validPianoRollSettings(item.settings)) {
    message.value = 'Use valid piano roll settings and keep the note range within MIDI notes 0 to 127.'
    return
  }
  if (item.type === 'arpeggiator' && (!Number.isSafeInteger(item.settings.steps) ||
    item.settings.steps < 0 || item.settings.steps > 16)) {
    message.value = 'Arpeggiator steps must be a whole number from 0 to 16.'
    return
  }
  if (item.type === 'instrument-pad' && item.settings.instrumentType === 'sample-hit' &&
    (!Number.isSafeInteger(item.settings.instrumentParams.polyphony) ||
      item.settings.instrumentParams.polyphony < 1 || item.settings.instrumentParams.polyphony > 16)) {
    message.value = 'Polyphony must be a whole number from 1 to 16.'
    return
  }
  if (selectedId.value && props.layout.connections.some((connection) => {
    const source = connection.sourceId === item.id ? item : props.layout.items.find((entry) => entry.id === connection.sourceId)
    const target = connection.targetId === item.id ? item : props.layout.items.find((entry) => entry.id === connection.targetId)
    const items = props.layout.items.map((entry) => entry.id === item.id ? item : entry)
    return !source || !target || !isCompatible(source, connection.sourceParameter, target, connection.targetParameter) ||
      !selectorConnectionsCompatible(items, props.layout.connections, connection)
  })) {
    message.value = 'Remove incompatible wires before changing the control type.'
    return
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
    const adjusted = original.settings.value + (output.delta ?? output.value - item.settings.value)
    original.settings.value = Math.max(original.settings.min, Math.min(original.settings.max, adjusted))
  } else if (output.on === undefined && output.parameter !== 'note') {
    if (output.active === false) signals.delete(`${item.id}:${output.parameter}`)
    else signals.set(`${item.id}:${output.parameter}`, output.value)
  }
  emit('output', item.id, output)
  const sourceParameter = outputs(item).find((parameter) => parameter.id === output.parameter)
  if (!sourceParameter || sourceParameter.kind !== 'note') return
  if (output.on) void Tone.start().catch((error: unknown) => console.error('Could not start audio:', error))
  routeNote(item.id, output)
}

function routeNote(sourceId: string, output: ParameterOutput) {
  const source = props.layout.items.find((entry) => entry.id === sourceId)
  if (!source) return
  const selected = source.type === 'output-selector' ? selectedSelectorWire(props.layout.connections, source) : undefined
  for (const connection of props.layout.connections) {
    if (connection.sourceId !== sourceId || connection.sourceParameter !== output.parameter ||
      (source.type === 'output-selector' && connection.id !== selected?.id)) continue
    const target = props.layout.items.find((entry) => entry.id === connection.targetId)
    const targetParameter = target && inputs(target).find((parameter) => parameter.id === connection.targetParameter)
    if (!target || !targetParameter) continue
    if (targetParameter.kind === 'note' && (target.type === 'pad' || target.type === 'instrument-pad' || target.type === 'arpeggiator' || target.type === 'output-selector')) {
      const key = `${connection.id}:${output.value}`
      const previous = activeNotes.get(key)
      const count = previous?.count ?? 0
      if (output.on === undefined) {
        if (previous && output.bend !== undefined) activeNotes.set(key, { ...previous, bend: output.bend })
        else continue
      } else if (output.on) activeNotes.set(key, { count: count + 1, velocity: output.velocity ?? 100, bend: output.bend })
      else if (count > 1) activeNotes.set(key, { ...previous!, count: count - 1 })
      else activeNotes.delete(key)
      if (output.on && (target.type === 'pad' || target.type === 'instrument-pad')) {
        handleOutput(target, { parameter: 'velocity', value: output.velocity ?? 100 })
      }
      if (target.type === 'pad') emit('output', target.id, { parameter: 'note', value: output.value, on: output.on, velocity: output.velocity })
      if (target.type === 'output-selector') {
        if (output.on) selectorNotes.set(target.id, output.value)
        emit('output', target.id, output)
        routeNote(target.id, output)
      }
    }
  }
}

function selectorDestination(item: GridItem) {
  const wire = selectedSelectorWire(props.layout.connections, item)
  const target = wire && props.layout.items.find((entry) => entry.id === wire.targetId)
  const input = target && inputs(target).find((parameter) => parameter.id === wire?.targetParameter)
  return target && input ? `${target.label} / ${input.label}` : 'No destination'
}

function numericWireValue(wire: Connection) {
  const signal = numericSignal(props.layout, wire, signals, (id) => displayItems.value.find((entry) => entry.id === id))
  if (!signal) return undefined
  const offset = modulationOffset(wire, signal)
  return offset === undefined ? signal.value : selectorNumericValue(wire, signal, normalizeSignal(signal.value, signal.min, signal.max) * 127)
}

function selectorInputValue(wire: Connection) {
  const signal = numericSignal(props.layout, wire, signals, (id) => displayItems.value.find((entry) => entry.id === id))
  if (!signal) return undefined
  const target = props.layout.items.find((item) => item.id === wire.targetId)
  const count = props.layout.connections.filter((connection) => connection.sourceId === wire.targetId).length
  const base = target?.type === 'output-selector' && count
    ? ((target.settings.baseIndex ?? target.settings.index) % count + 0.5) * 128 / count : 0
  return selectorNumericValue(wire, signal, base)
}

function selectorValue(item: GridItem) {
  const incoming = props.layout.connections.find((wire) => wire.targetId === item.id && wire.targetParameter !== 'selection')
  if (!incoming) return 'No signal'
  if (incoming.targetParameter === 'note') {
    const note = selectorNotes.get(item.id)
    return note === undefined ? 'No signal' : noteName(note)
  }
  const value = numericWireValue(incoming)
  return value === undefined ? 'No signal' : Number(value.toPrecision(10)).toString()
}

function setSelectorIndex(item: GridItem, index: number, userInitiated = false) {
  if (item.type !== 'output-selector') return
  const count = props.layout.connections.filter((wire) => wire.sourceId === item.id).length
  if (userInitiated && count) item.settings.baseIndex = index
  if (!count || item.settings.index % count === index) return
  const notes = receivedNotes(item.id)
  for (const note of notes) for (let i = 0; i < note.count; i++) {
    routeNote(item.id, { parameter: 'note', value: note.note, on: false, velocity: note.velocity })
  }
  item.settings.index = index
  const selected = selectedSelectorWire(props.layout.connections, item)
  if (selected && userInitiated) {
    selectorFlash.value = { sourceId: item.id, targetId: selected.targetId, sequence: ++selectorFlashSequence }
    clearTimeout(selectorFlashTimer)
    selectorFlashTimer = setTimeout(() => { selectorFlash.value = null }, 900)
  } else if (!userInitiated && selectorFlash.value?.sourceId === item.id) {
    clearTimeout(selectorFlashTimer)
    selectorFlash.value = null
  }
  for (const note of notes) for (let i = 0; i < note.count; i++) {
    routeNote(item.id, { parameter: 'note', value: note.note, on: true, velocity: note.velocity, bend: note.bend })
  }
}

function advanceSelector(item: GridItem) {
  const original = props.layout.items.find((entry) => entry.id === item.id)
  if (!original || original.type !== 'output-selector') return
  const count = props.layout.connections.filter((wire) => wire.sourceId === item.id).length
  if (count < 2) return
  setSelectorIndex(original, (original.settings.index + 1) % count, true)
}

watch(() => props.editing ? [] : props.layout.items.filter((item) => item.type === 'output-selector').map((item) => {
  const wire = props.layout.connections.find((entry) => entry.targetId === item.id && entry.targetParameter === 'selection')
  const origin = wire && signalSource(props.layout, wire)
  return { id: item.id, wireId: wire?.id, originId: origin?.id, value: wire && selectorInputValue(wire) }
}), (current, previous) => {
  for (const selection of current) {
    const old = previous?.find((entry) => entry.id === selection.id)
    if (old && old.wireId === selection.wireId && old.originId === selection.originId && old.value === selection.value) continue
    const item = props.layout.items.find((entry) => entry.id === selection.id)
    const count = props.layout.connections.filter((wire) => wire.sourceId === selection.id).length
    if (!item || item.type !== 'output-selector' || !count) continue
    const wire = props.layout.connections.find((entry) => entry.id === selection.wireId)
    if (selection.value === undefined || !Number.isFinite(selection.value)) {
      if (wire?.mappingMode === 'mod' && item.settings.baseIndex !== undefined) {
        setSelectorIndex(item, item.settings.baseIndex % count)
      }
      continue
    }
    if (wire?.mappingMode === 'mod' && item.settings.baseIndex === undefined) item.settings.baseIndex = item.settings.index
    const value = Math.max(0, Math.min(127, selection.value))
    setSelectorIndex(item, Math.min(count - 1, Math.floor(value * count / 128)))
  }
}, { immediate: true })

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
      notes.set(note, { note, count: (previous?.count ?? 0) + active.count, velocity: active.velocity, bend: active.bend })
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
  const pending = wireDraft.value
  if (!target || !source || !pending || !wireOutput.value || !wireInput.value ||
    !selectorConnectionsCompatible(props.layout.items, props.layout.connections,
      { id: '', sourceId: source.id, sourceParameter: wireOutput.value, targetId: target.id, targetParameter: wireInput.value }) ||
    createsCycle(props.layout.connections, source.id, target.id) ||
    !availableInputs(wireOutput.value).some((option) => option.id === wireInput.value)) {
    message.value = 'Choose a compatible source that does not create a cycle or duplicate wire.'
    return
  }
  let number = 1
  while (props.layout.connections.some((connection) => connection.id === `wire-${number}`)) number++
  const connection = { ...pending, id: `wire-${number}` }
  if (connection.mappingMode === 'mod') setConnectionMappingMode(props.layout, connection, 'mod')
  props.layout.connections.push(connection)
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
  const choices = availableOutputs.value
  if (!choices.length) {
    wirePair.value = null
    message.value = 'No compatible connection is available between these controls.'
  } else if (choices.length === 1) {
    const output = choices[0]!
    const targets = availableInputs(output.id)
    if (targets.length === 1) {
      wireOutput.value = output.id
      wireInput.value = targets[0]!.id
      if (output.kind !== 'number') connectWire()
    }
  }
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

function canSetModulationAmount(connection: Connection) {
  const source = props.layout.items.find((item) => item.id === connection.sourceId)
  const target = props.layout.items.find((item) => item.id === connection.targetId)
  return source && target &&
    outputs(source).some((output) => output.id === connection.sourceParameter && output.kind === 'number') &&
    inputs(target).some((input) => input.id === connection.targetParameter && input.kind === 'number')
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
  if (!current.moved) {
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
        :class="{ editing }"
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
          <div v-if="!editing" class="grid-item-component" :class="{ rotated: item.orientation === 'vertical' }">
            <MPCPad v-if="item.type === 'pad'" :label="item.label" :settings="item.settings" :rotated="item.orientation === 'vertical'" :wired-active="padActive(item.id)" @output="handleOutput(item, $event)" />
            <Knob v-else-if="item.type === 'knob'" :label="item.label" :settings="item.settings" :rotated="item.orientation === 'vertical'" emit-initial @output="handleOutput(item, $event)" />
            <LFO v-else-if="item.type === 'lfo'" :label="item.label" :settings="item.settings" :bpm="bpm" @output="handleOutput(item, $event)" />
            <ModWheel v-else-if="item.type === 'mod-wheel'" :label="item.label" :settings="item.settings" :rotated="item.orientation === 'vertical'" @output="handleOutput(item, $event)" />
            <PianoRoll v-else-if="item.type === 'piano-roll'" :label="item.label" :settings="item.settings" :rotated="item.orientation === 'vertical'" @output="handleOutput(item, $event)" />
            <InstrumentPad v-else-if="item.type === 'instrument-pad'" :label="item.label" :settings="item.settings" :rotated="item.orientation === 'vertical'" :notes="receivedNotes(item.id)" @output="handleOutput(item, $event)" />
            <OutputSelector v-else-if="item.type === 'output-selector'" :label="item.label"
              :destination="selectorDestination(item)" :value="selectorValue(item)"
              :flash-sequence="selectorFlash?.sourceId === item.id ? selectorFlash.sequence : 0"
              @advance="advanceSelector(item)" />
            <Arpeggiator v-else :label="item.label" :settings="item.settings" :bpm="bpm" :notes="receivedNotes(item.id)" @output="handleOutput(item, $event)" @toggle="toggleArpeggiator(item.id)" />
          </div>
          <button
            v-else
            type="button"
            class="grid-item-main editing"
            :class="{ 'has-color': 'color' in item.settings }"
            :style="'color' in item.settings ? { '--item-color': item.settings.color } : undefined"
            :aria-label="`Edit or move ${item.label}`"
            @pointerdown="startInteraction($event, item, 'move')"
            @pointermove="updateInteraction"
            @pointerup="endInteraction($event)"
            @pointercancel="endInteraction($event, true)"
            @click="editing && $event.detail === 0 && openSettings(item)"
          ><span :class="{ 'vertical-edit-label': item.orientation === 'vertical' }">{{ item.label }}</span></button>
          <span v-if="!editing && selectorFlash?.targetId === item.id" :key="selectorFlash.sequence"
            class="selector-receiver-flash" aria-hidden="true"></span>
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
            <span :class="{ 'vertical-edit-label': item.orientation === 'vertical' }">{{ item.label }}</span>
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
      </div>
      <p v-if="!dropAction.swapId && !canCopyDrop" class="grid-message">There is not enough separate space to copy here.</p>
    </SettingsDialog>

    <SettingsDialog v-if="settingsOpen" title="Grid settings" :showSaveButton="true" @close="emit('closeSettings')" @save="resizeGrid">
      <form class="settings-form" @submit.prevent="resizeGrid">
        <div class="settings-dimensions grid-dimensions">
          <NumericSetting v-model="columns" label="Columns" :min="1" :max="MAX_GRID_COLUMNS" />
          <NumericSetting v-model="rows" label="Rows" :min="1" :max="MAX_GRID_ROWS" />
        </div>
        <p v-if="message" class="grid-message" role="alert">{{ message }}</p>
      </form>
    </SettingsDialog>

    <SettingsDialog v-if="addPosition" title="Add control" @close="addPosition = null">
      <p class="control-picker-hint">Choose a control to add to your grid.</p>
      <div class="control-picker">
        <button v-for="control in controlTypes" :key="control.type" type="button" class="control-picker-button"
          @click="chooseControlType(control.type)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="control.icon" /></svg>
          <span><strong>{{ control.label }}</strong><small>{{ control.description }}</small></span>
        </button>
      </div>
    </SettingsDialog>

    <SettingsDialog v-if="draft" title="Control settings" :showSaveButton="true" @close="draft = null; selectedId = null; message = ''" @save="saveItem">
      <template #header-actions>
        <MPCPad v-if="draft.type === 'instrument-pad'" class="preview-pad" label="Play"
          :settings="draft.settings" @output="handlePreviewOutput" />
      </template>
      <form v-if="draft" class="settings-form control-settings" @submit.prevent="saveItem">
        <ControlIdentitySettings ref="controlIdentity" :draft="draft" :columns="layout.columns" :rows="layout.rows"
          :control-types="controlTypes" @change-type="changeType" />

        <section v-if="draft.type !== 'pad' && draft.type !== 'output-selector'" class="control-parameters">
        <template v-if="draft.type === 'instrument-pad'">
          <InstrumentPadSettingsPanel :draft="draft" @loading-change="sampleLoading = $event" />
        </template>
        <KnobSettingsPanel v-else-if="draft.type === 'knob'" :draft="draft"
          @default-value-change="draft.settings.defaultValue = $event; if (!selectedId) draft.settings.value = $event" />
        <LFOSettingsPanel v-else-if="draft.type === 'lfo'" :draft="draft">
          <template #preview>
            <LFO label="Preview" :settings="draft.settings" :bpm="bpm" />
          </template>
        </LFOSettingsPanel>
        <ModWheelSettingsPanel v-else-if="draft.type === 'mod-wheel'" :draft="draft" />
        <PianoRollSettingsPanel v-else-if="draft.type === 'piano-roll'" :draft="draft" />
        <ArpeggiatorSettingsPanel v-else-if="draft.type === 'arpeggiator'" :draft="draft" />
        </section>

        <div v-if="selectedId && layout.connections.some((connection) => connection.sourceId === selectedId || connection.targetId === selectedId)" class="control-parameters settings-section">
          <h3>Connections</h3>
          <div v-for="connection in layout.connections.filter((entry) => entry.sourceId === selectedId || entry.targetId === selectedId)" :key="connection.id" class="wire-entry">
            <div class="wire-entry-heading">
              <span class="wire-entry-label">{{ connectionLabel(connection) }}</span>
              <ConnectionMapping v-if="canSetModulationAmount(connection)" :layout="layout" :connection="connection"
                :label="connectionLabel(connection)" @error="message = $event" />
              <button type="button" class="wire-button" :aria-label="`Remove wire: ${connectionLabel(connection)}`"
                title="Remove wire" @click="removeWire(connection)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>
              </button>
            </div>
          </div>
        </div>

        <p v-if="message" class="grid-message" role="alert">{{ message }}</p>
        <div class="settings-actions">
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
        <div v-if="wireDraft && canSetModulationAmount(wireDraft)" class="wire-entry">
          <div class="wire-entry-heading">
            <span class="wire-entry-label">Mapping</span>
            <ConnectionMapping :layout="layout" :connection="wireDraft" :label="connectionLabel(wireDraft)"
              draft @error="message = $event" />
          </div>
        </div>
        <p v-if="!availableOutputs.length" class="grid-message">No compatible connection is available between these controls.</p>
        <p v-if="message" class="grid-message" role="alert">{{ message }}</p>
        <div class="settings-actions">
          <button type="submit" :disabled="!wireInput">Connect</button>
        </div>
      </form>
    </SettingsDialog>
  </div>
</template>
