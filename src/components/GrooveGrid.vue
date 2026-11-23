<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { canResizeGrid, copyControl, createControl, MAX_GRID_COLUMNS, MAX_GRID_ROWS, type Connection, type GridItem, type GridLayout, type GridItemType, type HeldNote, type ParameterOutput, type RepeatDivision } from '../grid'
import { createsCycle, inputs, outputs, selectedSelectorWire, selectorConnectionsCompatible } from '../parameters'
import { modulationOffset, normalizeSignal, numericSignal, selectorNumericValue, setConnectionMappingMode, signalSource } from '../modulation'
import { noteName } from '../music'
import * as Tone from 'tone'
import MPCPad from './MPCPad.vue'
import Knob from './Knob.vue'
import LFO from './LFO.vue'
import ModWheel from './ModWheel.vue'
import PianoRoll from './PianoRoll.vue'
import Arpeggiator from './Arpeggiator.vue'
import InstrumentPad from './InstrumentPad.vue'
import NumericSetting from './NumericSetting.vue'
import SettingsDialog from './SettingsDialog.vue'
import OutputSelector from './OutputSelector.vue'
import ConnectionMapping from './ConnectionMapping.vue'
import GridControlSettingsDialog from './GridControlSettingsDialog.vue'
import VolumeControl from './VolumeControl.vue'
import { controlTypes } from './gridControlTypes'
import { useGridInteraction } from './useGridInteraction'
import { BankEventBus, TransportClock } from '../sequencedLoop'
import type { Bank } from '../project'
import { useGridPlayback } from './useGridPlayback'

const props = defineProps<{
  layout: GridLayout
  editing: boolean
  wiring: boolean
  volumeMode?: boolean
  repeatDivision?: RepeatDivision
  settingsOpen: boolean
  bpm: number
  playing?: boolean
  transportClock?: TransportClock
  bankId?: string
  banks?: Bank[]
  bankEvents?: BankEventBus
  startOnInput?: (bankId: string) => Promise<boolean>
  transportStartImmediate?: boolean
  triggeredByInput?: boolean
}>()
const emit = defineEmits<{ closeSettings: []; output: [itemId: string, output: ParameterOutput] }>()

const grid = ref<HTMLElement | null>(null)
const message = ref('')
const columns = ref(props.layout.columns)
const rows = ref(props.layout.rows)
const selectedId = ref<string | null>(null)
const draft = ref<GridItem | null>(null)
const addPosition = ref<{ x: number; y: number } | null>(null)
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
const clock = props.transportClock ?? new TransportClock()
const bankId = props.bankId ?? ''
const bankEvents = props.bankEvents ?? new BankEventBus()
const {
  loopEngine, loopAutomation, liveControls, loopStatus, loopPlayheads, effectiveSignals, displayItems, startArmedLoops, loopGesture, loopKeyDown, toggleLoop,
  changeLoopIndex,
  recordedNotes, selectedLoopNotes, loopWantsPlayback, previewX, previewY, previewColor, loopPreviewCurves, armLoop,
  setLoopArmed, toggleLoopPlayback, clearLoopClip, beginInput, captureNote, controlActivity, markManualOverride, displayedAutomation,
} = useGridPlayback({
  layout: () => props.layout,
  banks: () => props.banks,
  bankId,
  bankEvents,
  clock,
  playing: () => props.playing,
  editing: () => props.editing,
  transportStartImmediate: () => props.transportStartImmediate,
  triggeredByInput: () => props.triggeredByInput,
  startOnInput: () => props.startOnInput,
  signals,
  routeNote,
})
void loopEngine
void loopAutomation
void toggleLoop
void changeLoopIndex
const renderedItems = computed(() => displayItems.value.map((item, index) => ({ item, original: props.layout.items[index]! })))
function volumeValue(item: GridItem) {
  if (item.type === 'instrument-pad') return (item.settings.instrumentParams.volume + 48) / 48
  if (item.type === 'sequenced-loop') return item.settings.volume ?? 1
  return 0
}
function setVolume(item: GridItem, value: number) {
  if (item.type === 'instrument-pad') item.settings.instrumentParams.volume = Math.round((-48 + value * 48) * 100) / 100
  else if (item.type === 'sequenced-loop') item.settings.volume = value
}
function toggleMute(item: GridItem) {
  if (item.type === 'instrument-pad' || item.type === 'sequenced-loop') item.settings.muted = !item.settings.muted
}
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
const cells = computed(() => Array.from({ length: props.layout.columns * props.layout.rows }, (_, index) => ({
  x: index % props.layout.columns,
  y: Math.floor(index / props.layout.columns),
})))

watch(() => props.editing, (editing) => {
  if (!editing) {
    selectedId.value = null
    draft.value = null
    addPosition.value = null
    interaction.value = null
    dropAction.value = null
    message.value = ''
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

const { interaction, dropAction, canCopyDrop, startInteraction, updateInteraction, endInteraction, completeDrop, itemStyle } =
  useGridInteraction({
    getLayout: () => props.layout,
    isEditing: () => props.editing,
    grid,
    message,
    openSettings,
    nextControlId,
  })

function changeType(type: GridItemType) {
  const item = draft.value
  if (!item || type === item.type) return
  const replacement = createControl(item.id, item.x, item.y, type)
  replacement.width = item.width
  replacement.height = item.height
  replacement.orientation = item.orientation
  if (item.label !== 'Pad' && item.label !== 'Knob') replacement.label = item.label
  draft.value = replacement
}

function saveItem(item: GridItem) {
  const index = props.layout.items.findIndex((entry) => entry.id === selectedId.value)
  if (index !== -1) props.layout.items[index] = item
  else props.layout.items.push(item)
  if (item.type === 'sequenced-loop' && item.settings.armed) setLoopArmed(item, true)
  selectedId.value = null
  draft.value = null
  message.value = ''
}

function handleOutput(item: GridItem, output: ParameterOutput, user = false) {
  const original = props.layout.items.find((entry) => entry.id === item.id)
  if (!original) return
  const inputAttack = user && ((original.type === 'pad' || original.type === 'instrument-pad') &&
    output.parameter === 'gate' && output.value > 0 ||
    original.type === 'piano-roll' && output.parameter === 'note' && output.on === true)
  if (inputAttack) {
    if (!props.playing) beginInput()
    else startArmedLoops()
  }
  const wasActive = liveControls.has(item.id)
  if (user && (original.type === 'pad' || original.type === 'instrument-pad') && output.parameter === 'gate') {
    controlActivity(item.id, output.value > 0)
  } else if (user && original.type === 'piano-roll' && output.parameter === 'pressure') {
    controlActivity(item.id, output.active !== false)
  }
  if (original.type === 'knob' && item.type === 'knob' && output.parameter === 'value') {
    const adjusted = original.settings.value + (output.delta ?? output.value - item.settings.value)
    original.settings.value = Math.max(original.settings.min, Math.min(original.settings.max, adjusted))
  }
  const sourceParameter = outputs(item).find((parameter) => parameter.id === output.parameter)
  const trackPressure = output.parameter !== 'pressure' ||
    props.layout.connections.some((connection) => connection.sourceId === item.id && connection.sourceParameter === 'pressure')
  const recordVelocity = output.parameter !== 'velocity' ||
    props.layout.connections.some((connection) => connection.sourceId === item.id && connection.sourceParameter === 'velocity')
  const recordGate = output.parameter !== 'gate' ||
    props.layout.connections.some((connection) => connection.sourceId === item.id && connection.sourceParameter === 'gate')
  if (output.on === undefined && output.parameter !== 'note' && trackPressure) {
    if (output.active === false) signals.delete(`${item.id}:${output.parameter}`)
    else signals.set(`${item.id}:${output.parameter}`, output.value)
  }
  const recordable = (original.type !== 'knob' && original.type !== 'mod-wheel') || original.settings.recordAutomation
  const touched = wasActive || liveControls.has(item.id) ||
    (user && output.parameter === 'velocity' && (original.type === 'pad' || original.type === 'instrument-pad' || original.type === 'piano-roll'))
  if (props.playing && !props.editing && recordable && trackPressure && recordVelocity && recordGate && touched &&
    (user || output.user) && (original.type !== 'knob' || output.pointer === true) && sourceParameter?.kind === 'number') {
    bankEvents.emit({ kind: 'live-automation', bankId, sourceId: item.id, parameter: output.parameter,
      value: original.type === 'knob' && output.parameter === 'value' ? original.settings.value : output.value, active: output.active,
      motion: output.parameter === 'pressure' || ((original.type === 'knob' || original.type === 'mod-wheel') && output.parameter === 'value') })
  }
  if (props.playing && trackPressure && (user || output.user) && sourceParameter?.kind === 'number' && !liveControls.has(item.id)) {
    markManualOverride(item.id, output.parameter)
  }
  emit('output', item.id, output)
  if (!sourceParameter || sourceParameter.kind !== 'note') return
  if (output.on) void Tone.start().catch((error: unknown) => console.error('Could not start audio:', error))
  if (user && original.type === 'piano-roll' && output.on !== undefined) {
    captureNote(original.id, output.value, output.on, output.velocity ?? 100, output.bend)
  }
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
  const signal = numericSignal(props.layout, wire, effectiveSignals.value, (id) => displayItems.value.find((entry) => entry.id === id))
  if (!signal) return undefined
  const offset = modulationOffset(wire, signal)
  return offset === undefined ? signal.value : selectorNumericValue(wire, signal, normalizeSignal(signal.value, signal.min, signal.max) * 127)
}

function selectorInputValue(wire: Connection) {
  const signal = numericSignal(props.layout, wire, effectiveSignals.value, (id) => displayItems.value.find((entry) => entry.id === id))
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

watch(() => props.layout.items.filter((item) => item.type === 'output-selector').map((item) => {
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
  if (item?.type !== 'arpeggiator') return
  const automated = effectiveSignals.value.get(`${id}:enabled`)
  item.settings.enabled = !(automated === undefined ? item.settings.enabled : automated >= 0.5)
  recordToggle(id, 'enabled', item.settings.enabled)
}

function recordToggle(id: string, parameter: 'enabled' | 'hold', value: boolean) {
  if (props.playing && !props.editing) {
    bankEvents.emit({ kind: 'live-automation', bankId, sourceId: id, parameter, value: Number(value) })
    markManualOverride(id, parameter)
  }
}

function lfoAutomationHold(id: string) {
  const value = effectiveSignals.value.get(`${id}:hold`)
  return value === undefined ? undefined : value >= 0.5
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
        :class="{ editing: editing || wiring || volumeMode }"
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

        <div v-for="{ item, original } in renderedItems" :key="item.id" class="grid-item" :style="itemStyle(original)">
          <div v-show="!editing && !wiring && !volumeMode" class="grid-item-component" :class="{ rotated: item.orientation === 'vertical' }">
            <MPCPad v-if="item.type === 'pad'" :label="item.label" :settings="item.settings" :rotated="item.orientation === 'vertical'" :wired-active="padActive(item.id)" :repeat-division="repeatDivision" :bpm="bpm" :playing="playing" :transport-clock="clock" @output="handleOutput(item, $event, true)" />
            <Knob v-else-if="item.type === 'knob'" :label="item.label" :settings="item.settings" :rotated="item.orientation === 'vertical'" emit-initial @output="handleOutput(item, $event)" @activity="controlActivity(item.id, $event)" />
            <LFO v-else-if="item.type === 'lfo'" :label="item.label" :settings="item.settings" :bpm="bpm" :automation-hold="lfoAutomationHold(item.id)" @output="handleOutput(item, $event)" @hold-change="recordToggle(item.id, 'hold', $event)" />
            <ModWheel v-else-if="item.type === 'mod-wheel'" :label="item.label" :settings="item.settings" :rotated="item.orientation === 'vertical'" :automation-value="displayedAutomation(item.id, 'value')" @output="handleOutput(item, $event)" @activity="controlActivity(item.id, $event)" />
            <PianoRoll v-else-if="item.type === 'piano-roll'" :label="item.label" :settings="item.settings" :rotated="item.orientation === 'vertical'" :repeat-division="repeatDivision" :bpm="bpm" :playing="playing" :transport-clock="clock" @output="handleOutput(item, $event, true)" />
            <InstrumentPad v-else-if="item.type === 'instrument-pad'" :label="item.label" :settings="item.settings" :rotated="item.orientation === 'vertical'" :notes="receivedNotes(item.id)" :loop-notes="recordedNotes(item.id)" :repeat-division="repeatDivision" :bpm="bpm" :playing="playing" :transport-clock="clock" @output="handleOutput(item, $event, true)" @live-note="(note, on, velocity, bend) => captureNote(item.id, note, on, velocity, bend)" />
            <OutputSelector v-else-if="item.type === 'output-selector'" :label="item.label"
              :destination="selectorDestination(item)" :value="selectorValue(item)"
              :flash-sequence="selectorFlash?.sourceId === item.id ? selectorFlash.sequence : 0"
              @advance="advanceSelector(item)" />
            <Arpeggiator v-else-if="item.type === 'arpeggiator'" :label="item.label" :settings="item.settings" :bpm="bpm" :notes="receivedNotes(item.id)" :playing="playing" :transport-clock="clock" @output="handleOutput(item, $event)" @toggle="toggleArpeggiator(item.id)" />
            <div v-else-if="item.type === 'sequenced-loop'" class="loop-control"
              role="group" :aria-label="`${item.label} controls`" tabindex="0"
              :style="{ '--loop-color': item.settings.color }"
              aria-keyshortcuts="ArrowUp ArrowDown"
              title="Use the buttons to arm or play; swipe up or down to change clips"
              @pointerdown="loopGesture(item.id).down" @pointermove="loopGesture(item.id).move" @pointerup="loopGesture(item.id).up"
              @pointercancel="loopGesture(item.id).cancel" @lostpointercapture="loopGesture(item.id).cancel"
              @click="loopGesture(item.id).click" @keydown="loopKeyDown($event, item.id)">
              <strong>{{ item.label }}</strong>
              <span class="loop-status">Clip {{ item.settings.clipIndex }} · {{ loopStatus.get(item.id)?.counting ? 'Count-in' : loopStatus.get(item.id)?.pending ? 'Waiting' : loopStatus.get(item.id)?.enabled ? 'On' : loopWantsPlayback(item) ? 'Ready' : 'Off' }}</span>
              <svg class="loop-preview" viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
                <path class="loop-preview-grid" d="M25 0v48 M50 0v48 M75 0v48 M0 12h100 M0 24h100 M0 36h100" />
                <path v-for="curve in loopPreviewCurves(item)" :key="curve.key" class="loop-preview-curve" :d="curve.path" :style="{ stroke: curve.color }" />
                <circle v-for="(note, index) in selectedLoopNotes(item)" :key="index" class="loop-preview-note"
                  :cx="previewX(note.position, Math.max(1, item.settings.barLength * 4))"
                  :cy="previewY(note.note, 36, 96)" r="1.5" :style="{ fill: previewColor(note.instrumentId, note.bankId) }" />
                <line v-if="loopPlayheads.has(item.id)" class="loop-preview-playhead"
                  :x1="loopPlayheads.get(item.id)" :x2="loopPlayheads.get(item.id)" y1="0" y2="48" />
              </svg>
              <div class="loop-actions">
                <button type="button" class="loop-action loop-arm" :class="{ armed: item.settings.armed }"
                  :aria-label="`${item.settings.armed ? 'Disarm' : 'Arm'} ${item.label} for recording`"
                  :aria-pressed="item.settings.armed" :title="item.settings.armed ? 'Disarm recording' : 'Arm for recording'"
                  @pointerdown.stop @pointermove.stop @pointerup.stop @pointercancel.stop @lostpointercapture.stop @click.stop="armLoop(item.id)">
                  <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6" /></svg>
                </button>
                <button type="button" class="loop-action loop-play" :aria-label="`${loopWantsPlayback(item) ? 'Pause' : 'Play'} ${item.label}${playing ? '' : ' when playback starts'}`"
                  :aria-pressed="loopWantsPlayback(item)"
                  :title="playing ? (loopWantsPlayback(item) ? 'Pause loop' : 'Play loop') : (loopWantsPlayback(item) ? 'Do not start this loop when playback starts' : 'Start this loop when playback starts')"
                  @pointerdown.stop @pointermove.stop @pointerup.stop @pointercancel.stop @lostpointercapture.stop @click.stop="toggleLoopPlayback(item.id)">
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path v-if="loopWantsPlayback(item)" d="M5 4h4v12H5z M11 4h4v12h-4z" />
                    <path v-else d="M6 3.5 17 10 6 16.5z" />
                  </svg>
                </button>
                <button type="button" class="loop-action loop-clear"
                  :aria-label="`Clear clip ${item.settings.clipIndex} in ${item.label}`"
                  :title="`Clear clip ${item.settings.clipIndex}`"
                  @pointerdown.stop @pointermove.stop @pointerup.stop @pointercancel.stop @lostpointercapture.stop @click.stop="clearLoopClip(item.id)">
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6h10l-.8 11H5.8L5 6Zm2-3h6l1 2H6l1-2Zm1 5v6m4-6v6" /></svg>
                </button>
              </div>
            </div>
          </div>
          <VolumeControl v-if="volumeMode && (original.type === 'instrument-pad' || original.type === 'sequenced-loop')"
            :label="original.label" :color="original.settings.color" :value="volumeValue(original)" :muted="!!original.settings.muted"
            @change="setVolume(original, $event)" @mute="toggleMute(original)" />
          <div v-else-if="volumeMode" class="grid-item-main">{{ original.label }}</div>
          <button
            v-if="editing"
            type="button"
            class="grid-item-main editing"
            :class="{ 'has-color': 'color' in original.settings }"
            :style="'color' in original.settings ? { '--item-color': original.settings.color } : undefined"
            :aria-label="`Edit or move ${original.label}`"
            @pointerdown="startInteraction($event, original, 'move')"
            @pointermove="updateInteraction"
            @pointerup="endInteraction($event)"
            @pointercancel="endInteraction($event, true)"
            @click="editing && $event.detail === 0 && openSettings(original)"
          ><span :class="{ 'vertical-edit-label': original.orientation === 'vertical' }">{{ original.label }}</span></button>
          <span v-if="!editing && selectorFlash?.targetId === item.id" :key="selectorFlash.sequence"
            class="selector-receiver-flash" aria-hidden="true"></span>
          <button
            v-if="editing && !wiring"
            type="button"
            class="resize-handle"
            :aria-label="`Resize ${item.label}; or use control settings`"
            @pointerdown.stop="startInteraction($event, original, 'resize')"
            @pointermove="updateInteraction"
            @pointerup="endInteraction($event)"
            @pointercancel="endInteraction($event, true)"
            @click="$event.detail === 0 && openSettings(original)"
          ><span aria-hidden="true">◢</span></button>
          <button v-if="wiring" type="button" class="wire-control" :class="{ selected: wireFirst === item.id }"
            :data-wire-id="item.id" :aria-label="`Wire ${item.label}`"
            @pointerdown="wirePointerDown($event, original)" @pointermove="wirePointerMove"
            @pointerup="wirePointerEnd($event)" @pointercancel="wirePointerEnd($event, true)"
            @lostpointercapture="wirePointerEnd($event, true)"
            @click="$event.detail === 0 && keyboardWire(original)">
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

    <GridControlSettingsDialog v-if="draft" :draft="draft" :selected-id="selectedId" :layout="layout" :bpm="bpm" :banks="banks" :bank-id="bankId"
      :message="message" @update:message="message = $event"
      @close="draft = null; selectedId = null; message = ''" @save="saveItem"
      @remove="removeItem" @remove-wire="removeWire" @change-type="changeType" />
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

