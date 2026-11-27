<script setup lang="ts">
import { computed, onBeforeMount, onBeforeUnmount, onMounted, onUnmounted, reactive, ref, shallowReactive, shallowRef, triggerRef, watch } from 'vue'
import { createControl, nextLoopQuantize, MAX_GRID_COLUMNS, MAX_GRID_ROWS, type Connection, type GridItem, type GridLayout, type GridItemType, type HeldNote, type ParameterOutput, type RepeatDivision, type SubGridSettings } from '../grid'
import { createsCycle, inputs, outputs, selectedSelectorWire, selectorConnectionsCompatible, selectorRoutingCompatible } from '../parameters'
import { modulationOffset, normalizeSignal, numericSignal, selectorNumericValue, setConnectionMappingMode, signalSource, type BoundaryNumeric, type NumericSignal } from '../modulation'
import { noteName } from '../music'
import * as Tone from 'tone'
import MPCPad from './widgets/MPCPad.vue'
import Knob from './UI/Knob.vue'
import LFO from './widgets/LFO.vue'
import ModWheel from './widgets/ModWheel.vue'
import PianoRoll from './widgets/PianoRoll.vue'
import Arpeggiator from './widgets/Arpeggiator.vue'
import InstrumentPad from './widgets/tone/InstrumentPad.vue'
import ToneOscillator from './widgets/tone/ToneOscillator.vue'
import ToneNoise from './widgets/tone/ToneNoise.vue'
import ToneElement from './widgets/tone/ToneElement.vue'
import ADSREnvelopeEditor from './UI/ADSREnvelopeEditor.vue'
import ChannelMixer from './widgets/tone/ChannelMixer.vue'
import { BankAudio, type BoundaryAudio } from '../audio/bankAudio'
import { audioBoundaryKey, audioOutput, AudioRouteError, validateAudioRoutes } from '../audio/audioRoutes'
import { oscillatorPitch } from '../audio/toneOscillator'
import NumericSetting from './UI/NumericSetting.vue'
import SettingsDialog from './UI/SettingsDialog.vue'
import OutputSelector from './widgets/OutputSelector.vue'
import ConnectionMapping from './ConnectionMapping.vue'
import GridControlSettingsDialog from './GridControlSettingsDialog.vue'
import SequencedLoopSettingsPanel from './widgets/SequencedLoopSettingsPanel.vue'
import SequencedLoop from './widgets/SequencedLoop.vue'
import SubGrid from './widgets/SubGrid.vue'
import VolumeControl from './widgets/VolumeControl.vue'
import { controlTypes } from './gridControlTypes'
import { useGridInteraction } from './useGridInteraction'
import { BankEventBus, TransportClock } from '../sequencedLoop'
import type { Bank } from '../project'
import { useGridPlayback } from './useGridPlayback'
import { cloneClip } from '../loopRows'
import { pasteSubGridLayout, type SubGridClipboard } from '../subGridClipboard'
import SubGridConfigDialog from './SubGridConfigDialog.vue'
import type { ADSREnvelope } from '../instruments/types'

interface BoundaryNote {
  id: string
  portId: string
  note: number
  count: number
  velocity: number
  bend?: number
}

const props = defineProps<{
  layout: GridLayout
  rootLayout?: GridLayout
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
  parentAudioInput?: Tone.ToneAudioNode
  parentAudioOutput?: Tone.InputNode
  parentAudioPorts?: BoundaryAudio[]
  subGridClipboard?: SubGridClipboard | null
  surfaceTarget?: HTMLElement
  ownerSettings?: SubGridSettings
  configurationMode?: boolean
  protectedPorts?: string[]
  connectedPorts?: string[]
  boundaryNotes?: BoundaryNote[]
  boundaryNumeric?: BoundaryNumeric[]
}>()
const emit = defineEmits<{ closeSettings: []; output: [itemId: string, output: ParameterOutput]; audioError: [message: string];
  boundaryOutput: [portId: string, output: ParameterOutput]; boundaryNumeric: [portId: string, signal: NumericSignal | undefined] }>()

const grid = ref<HTMLElement | null>(null)
const message = ref('')
const audioError = ref('')
const processorError = ref('')
const nestedAudioErrors = reactive(new Map<string, string>())
const displayedAudioError = computed(() => [audioError.value, processorError.value, ...nestedAudioErrors.values()].filter(Boolean).join(' '))
watch(displayedAudioError, (error) => emit('audioError', error))
watch(() => props.layout.items.map((item) => item.id), (ids) => {
  for (const id of nestedAudioErrors.keys()) if (!ids.includes(id)) nestedAudioErrors.delete(id)
  for (const map of [padDisplays, instrumentPadDisplays, padDisplayRefs, instrumentPadDisplayRefs,
    controlOutputHandlers, controlOutputListenerSets, instrumentLiveNoteHandlers, instrumentPadListenerSets]) {
    for (const id of map.keys()) if (!ids.includes(id)) map.delete(id)
  }
})
function setNestedAudioError(id: string, error: string) {
  if (error) nestedAudioErrors.set(id, error)
  else nestedAudioErrors.delete(id)
}
function changeEnvelope(item: Extract<GridItem, { type: 'tone-element' }>, parameter: keyof ADSREnvelope, output: ParameterOutput) {
  const original = props.layout.items.find((entry) => entry.id === item.id)
  if (original?.type !== 'tone-element' || original.settings.elementType !== 'envelope') return
  const input = inputs(original).find((entry) => entry.id === parameter)
  if (input?.min === undefined || input.max === undefined) return
  const previous = original.settings[parameter]
  const next = Math.max(input.min, Math.min(input.max, previous + (output.delta ?? output.value - item.settings[parameter])))
  if (next === previous && output.value === item.settings[parameter]) return
  original.settings[parameter] = next
  recordSettingChange(item.id, { id: `setting:tone-element:${parameter}`, value: next, continuous: true })
}
const audioGraph = shallowRef<BankAudio>()
onBeforeMount(() => {
  try {
    audioGraph.value = new BankAudio((error) => {
      processorError.value = error
      console.error(error)
    }, props.parentAudioInput, props.parentAudioOutput)
    audioGraph.value.update(props.layout, props.parentAudioPorts, {
      bpm: props.bpm,
      toneSettings: effectiveToneSettings(),
      baseItems: automationItems.value,
      signals: effectiveSignals.value,
      boundaryInputs: modulationBoundaryInputs(),
      wheelPositions,
      automatedWheels: automatedModWheels(),
    })
  } catch (error) {
    audioError.value = `Audio routing error: ${error instanceof Error ? error.message : String(error)}`
    console.error(audioError.value, error)
  }
})
onUnmounted(() => audioGraph.value?.dispose())
const selectedId = ref<string | null>(null)
const openSubgridId = ref<string | null>(null)
const subgridSettingsOpen = ref(false)
const subgridConfig = ref(false)
const configuringId = ref<string | null>(null)
const configuringItem = computed(() => props.layout.items.find((item) => item.id === configuringId.value))
const surfaceTargets = shallowReactive(new Map<string, HTMLElement>())
function setSurfaceTarget(id: string, element: unknown) {
  if (element instanceof HTMLElement) surfaceTargets.set(id, element)
  else surfaceTargets.delete(id)
}
function boundsForSurface(settings?: SubGridSettings) {
  const items = settings?.layout.items.filter((item) => settings.surfaceItemIds.includes(item.id)) ?? []
  if (!items.length) return undefined
  const x = Math.min(...items.map((item) => item.x))
  const y = Math.min(...items.map((item) => item.y))
  return { x, y, columns: Math.max(...items.map((item) => item.x + item.width)) - x,
    rows: Math.max(...items.map((item) => item.y + item.height)) - y }
}
const surfaceBounds = computed(() => boundsForSurface(props.ownerSettings))
function subgridSurfaceStyle(item: Extract<GridItem, { type: 'sub-grid' }>) {
  const bounds = boundsForSurface(item.settings)
  if (!bounds) return { display: 'none' }
  return { gridTemplateColumns: `repeat(${bounds.columns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${bounds.rows}, minmax(0, 1fr))`,
    aspectRatio: `${bounds.columns} / ${bounds.rows}`, '--surface-ratio': bounds.columns / bounds.rows }
}
function surfaceStyle(item: GridItem) {
  const bounds = surfaceBounds.value
  if (!bounds) return itemStyle(item)
  return { gridColumn: `${item.x - bounds.x + 1} / span ${item.width}`, gridRow: `${item.y - bounds.y + 1} / span ${item.height}` }
}
const openSubgrid = computed(() => props.layout.items.find((item) => item.id === openSubgridId.value && item.type === 'sub-grid'))
watch(openSubgrid, (item) => { if (!item) openSubgridId.value = null })
const widgetEditor = ref<{ id: string; index: number } | null>(null)
const widgetEditorLoop = computed(() => {
  const item = props.layout.items.find((entry) => entry.id === widgetEditor.value?.id)
  return item?.type === 'sequenced-loop' ? item : undefined
})
const selectedControl = computed(() => props.layout.items.find((item) => item.id === selectedId.value) ?? null)
const newControl = ref(false)
const addPosition = ref<{ x: number; y: number } | null>(null)
const wireFirst = ref<string | null>(null)
const wireDrag = ref<{ pointerId: number; sourceId: string; x: number; y: number } | null>(null)
const wirePair = ref<{ sourceId: string; targetId: string } | null>(null)
const wireOutput = ref('')
const wireInput = ref('')
const wireDraft = ref<Connection | null>(null)
const activeNotes = reactive(new Map<string, { count: number; velocity: number; bend?: number; sequence: number }>())
const boundaryActiveNotes = reactive(new Map<string, BoundaryNote & { targetId: string; targetParameter: string; sequence: number }>())
let noteSequence = 0
const signals = reactive(new Map<string, number>())
const wheelPositions = reactive(new Map<string, number>())
const boundaryOutputSignals = reactive(new Map<string, NumericSignal>())
const envelopeOutputs = computed(() => props.layout.items.filter((item) =>
  item.type === 'tone-element' && item.settings.elementType === 'envelope' &&
  (props.layout.connections.some((wire) => wire.sourceId === item.id && wire.sourceParameter === 'value') ||
    props.ownerSettings?.exposedPorts.some((port) => port.itemId === item.id && port.parameterId === 'value' &&
      port.direction === 'output' && port.kind === 'numeric'))).map((item) => item.id))
let envelopeFrame: number | undefined
let envelopeMonitoring = false
function sampleEnvelopes() {
  envelopeFrame = undefined
  for (const id of envelopeOutputs.value) {
    const value = audioGraph.value?.getEnvelopeValue(id)
    const key = `${id}:value`
    if (value === undefined) signals.delete(key)
    else if (signals.get(key) !== value) signals.set(key, value)
  }
  if (envelopeMonitoring && envelopeOutputs.value.length) envelopeFrame = requestAnimationFrame(sampleEnvelopes)
}
watch(envelopeOutputs, (current, previous) => {
  for (const id of previous ?? []) if (!current.includes(id)) signals.delete(`${id}:value`)
  if (!current.length && envelopeFrame !== undefined) {
    cancelAnimationFrame(envelopeFrame)
    envelopeFrame = undefined
  } else if (current.length && envelopeMonitoring && envelopeFrame === undefined) {
    envelopeFrame = requestAnimationFrame(sampleEnvelopes)
  }
})
onMounted(() => {
  envelopeMonitoring = true
  if (envelopeOutputs.value.length) envelopeFrame = requestAnimationFrame(sampleEnvelopes)
})
onBeforeUnmount(() => {
  envelopeMonitoring = false
  if (envelopeFrame !== undefined) cancelAnimationFrame(envelopeFrame)
})
const selectorNotes = reactive(new Map<string, number>())
const selectorFlash = ref<{ sourceId: string; targetId: string; sequence: number } | null>(null)
let selectorFlashSequence = 0
let selectorFlashTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(selectorFlashTimer))
const clock = props.transportClock ?? new TransportClock()
const bankId = props.bankId ?? ''
const bankEvents = props.bankEvents ?? new BankEventBus()
const selectorPortWires = computed(() => {
  const used = new Set(props.layout.connections.map((wire) => wire.id))
  return (props.ownerSettings?.exposedPorts ?? []).flatMap((port) => {
    const item = props.layout.items.find((entry) => entry.id === port.itemId)
    if (item?.type !== 'output-selector' || port.direction !== 'output' || !port.parameterId ||
      !props.connectedPorts?.includes(port.id)) return []
    let id = `exposed:${port.id}`
    while (used.has(id)) id += ':'
    used.add(id)
    return [{ id, sourceId: item.id, sourceParameter: port.parameterId, targetId: '', targetParameter: port.id }]
  })
})
const modulationLayout = computed(() => ({ ...props.layout, connections: [...props.layout.connections, ...selectorPortWires.value] }))
const {
  loopEngine, loopAutomation, liveControls, loopStatus, loopPlayheads, loopEditorPlayheads, effectiveSignals, automationItems, displayItems, startArmedLoops, loopGesture, loopKeyDown, toggleLoop,
  changeLoopIndex,
  recordedNotes, selectedLoopNotes, loopWantsPlayback, previewX, previewY, previewColor, loopPreviewCurves, armLoop,
  setLoopArmed, toggleLoopPlayback, clearLoopClip, beginInput, captureNote, controlActivity, markManualOverride, displayedAutomation,
  recordSettingChange, finishSettingChanges, setSettingGesture,
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
  boundaryNumeric: resolvedBoundaryNumeric,
  boundaryOutputs: boundaryOutputSignals,
  modulationLayout: () => modulationLayout.value,
})
void loopEngine
void loopAutomation
void toggleLoop
void changeLoopIndex
const renderedItems = computed(() => displayItems.value.map((item, index) => ({ item, original: props.layout.items[index]! })))
function effectiveToneSettings() {
  return new Map(displayItems.value.flatMap((item) =>
    item.type === 'tone-element' ? [[item.id, item.settings] as const] : []))
}
const latchedOscillatorNotes = new Map<string, HeldNote>()
watch(() => renderedItems.value.flatMap(({ item, original }) => {
  if (item.type !== 'tone-element' || item.settings.elementType !== 'oscillator' || original.type !== 'tone-element') return []
  const notes = receivedToneNotes(item.id)
  const current = oscillatorPitch(item.settings, original.settings.frequency, notes)
  if (item.settings.noteMode !== 'always-on') latchedOscillatorNotes.delete(item.id)
  else if (current.note) latchedOscillatorNotes.set(item.id, current.note)
  const latched = item.settings.noteMode === 'always-on' && !current.note ? latchedOscillatorNotes.get(item.id) : undefined
  return [{ id: item.id, value: latched
    ? oscillatorPitch(item.settings, original.settings.frequency, [latched]).frequency : current.frequency }]
}), (current, previous) => {
  for (const entry of previous ?? []) {
    if (!current.some((item) => item.id === entry.id)) {
      signals.delete(`${entry.id}:frequency`)
      latchedOscillatorNotes.delete(entry.id)
    }
  }
  for (const entry of current) {
    const key = `${entry.id}:frequency`
    if (signals.get(key) !== entry.value) signals.set(key, entry.value)
  }
}, { immediate: true })
function resolvedBoundaryNumeric(): BoundaryNumeric[] {
  return (props.boundaryNumeric ?? []).flatMap((entry) => {
    const port = props.ownerSettings?.exposedPorts.find((candidate) =>
      candidate.id === entry.portId && candidate.kind === 'numeric' && candidate.direction === 'input')
    return port?.itemId && port.parameterId
      ? [{ ...entry, wire: { ...entry.wire, targetId: port.itemId, targetParameter: port.parameterId } }] : []
  })
}
function modulationBoundaryInputs() {
  return new Set(resolvedBoundaryNumeric().map(({ wire }) => `${wire.targetId}:${wire.targetParameter}`))
}
function automatedModWheels() {
  return new Set(props.layout.items.filter((item) => item.type === 'mod-wheel' &&
    displayedAutomation(item.id, 'value') !== undefined).map((item) => item.id))
}
function setBoundaryOutput(id: string, port: string, signal?: NumericSignal) {
  const key = `${id}:${port}`
  if (!signal) {
    boundaryOutputSignals.delete(key)
    signals.delete(key)
  } else {
    boundaryOutputSignals.set(key, signal)
    signals.set(key, signal.value)
  }
}
function boundaryNumericForSubGrid(id: string): BoundaryNumeric[] {
  const result = resolvedBoundaryNumeric().filter((entry) => entry.wire.targetId === id)
    .map((entry) => ({ ...entry, portId: entry.wire.targetParameter }))
  const target = props.layout.items.find((item) => item.id === id)
  if (!target) return result
  for (const wire of props.layout.connections) {
    if (wire.targetId !== id || !inputs(target).some((port) => port.id === wire.targetParameter && port.kind === 'number')) continue
    const signal = numericSignal(modulationLayout.value, wire, effectiveSignals.value,
      (sourceId) => displayItems.value.find((item) => item.id === sourceId), resolvedBoundaryNumeric(), boundaryOutputSignals)
    if (signal) result.push({ portId: wire.targetParameter, wire, signal })
  }
  return result
}
watch(() => (props.ownerSettings?.exposedPorts ?? []).filter((port) => port.kind === 'numeric' &&
  port.direction === 'output' && port.itemId && port.parameterId).map((port) => {
  const item = props.layout.items.find((entry) => entry.id === port.itemId)
  const wire: Connection | undefined = item?.type === 'output-selector'
    ? selectorPortWires.value.find((entry) => entry.targetParameter === port.id)
    : { id: '', sourceId: port.itemId!, sourceParameter: port.parameterId!, targetId: '', targetParameter: '' }
  const signal = wire && numericSignal(modulationLayout.value, wire, effectiveSignals.value,
    (id) => displayItems.value.find((item) => item.id === id), resolvedBoundaryNumeric(), boundaryOutputSignals)
  return { id: port.id, signal }
}), (current, previous) => {
  for (const entry of previous ?? []) if (!current.some((port) => port.id === entry.id)) emit('boundaryNumeric', entry.id, undefined)
  for (const entry of current) {
    if (!previous || !previous.some((port) => port.id === entry.id && port.signal?.value === entry.signal?.value &&
      port.signal?.min === entry.signal?.min && port.signal?.max === entry.signal?.max)) {
      emit('boundaryNumeric', entry.id, entry.signal)
    }
  }
}, { immediate: true })
function updateAudioGraph(layout: GridLayout) {
  if (!audioGraph.value) return
  audioOnlyLfoCache.clear()
  try {
    const rerouted = audioGraph.value.update(layout, props.parentAudioPorts, {
      bpm: props.bpm, toneSettings: effectiveToneSettings(), baseItems: automationItems.value,
      signals: effectiveSignals.value, boundaryInputs: modulationBoundaryInputs(),
      wheelPositions, automatedWheels: automatedModWheels(),
    })
    for (const item of layout.items) if (item.type === 'tone-element' && item.settings.elementType === 'envelope') {
      audioGraph.value.setNotes(item.id, receivedToneNotes(item.id))
    }
    if (rerouted) triggerRef(audioGraph)
    audioError.value = ''
  } catch (error) {
    audioError.value = `Audio routing error: ${error instanceof Error ? error.message : String(error)}`
    console.error(audioError.value, error)
  }
}

function audioGraphSignalInputs() {
  const excluded = new Set(props.layout.items.flatMap((item) => {
    if (item.type === 'lfo' || (item.type === 'tone-element' && item.settings.elementType === 'envelope')) {
      return [`${item.id}:value`]
    }
    if (item.type === 'mod-wheel' && wheelPositions.has(item.id) && !automatedModWheels().has(item.id)) {
      return [`${item.id}:value`]
    }
    return []
  }))
  return JSON.stringify([...effectiveSignals.value].filter(([key]) => !excluded.has(key)))
}
function unmanagedToneSettings() {
  const parameters = ['cutoff', 'gain', 'delayTime', 'feedback', 'attack', 'decay', 'sustain', 'release'] as const
  return JSON.stringify([...effectiveToneSettings()].map(([id, settings]) =>
    [id, ...parameters.map((parameter) => audioGraph.value?.isModulationDriven(id, parameter) ? null : settings[parameter])]))
}
watch(() => ({ ...props.layout, items: props.layout.items }), updateAudioGraph, { deep: true })
watch([
  () => props.bpm,
  unmanagedToneSettings,
  () => JSON.stringify(automationItems.value.filter((item) => item.type === 'tone-element' || item.type === 'lfo' ||
    item.type === 'knob' || item.type === 'mod-wheel').map((item) => [item.id, item.settings])),
  audioGraphSignalInputs,
  () => JSON.stringify(resolvedBoundaryNumeric()),
  () => JSON.stringify([...wheelPositions]),
  () => JSON.stringify([...automatedModWheels()]),
], () => updateAudioGraph({ ...props.layout, items: props.layout.items }), { flush: 'post' })
watch(() => props.parentAudioPorts?.map(({ port, node }) => [node, port.id, port.direction, port.itemId, port.parameterId] as const),
  (current, previous) => {
    if (current?.length === previous?.length && current?.every((entry, index) =>
      entry.every((value, part) => value === previous?.[index]?.[part]))) return
    updateAudioGraph({ ...props.layout, items: props.layout.items })
  }, { flush: 'post' })
watch([activeNotes, boundaryActiveNotes], () => {
  for (const item of props.layout.items) if (item.type === 'tone-element' && item.settings.elementType === 'envelope') {
    audioGraph.value?.setNotes(item.id, receivedToneNotes(item.id))
  }
}, { deep: true, flush: 'sync' })
function playbackWidgetStates(): Array<
  | { type: 'pad'; id: string; active: boolean }
  | { type: 'instrument-pad'; id: string; notes: HeldNote[]; loopNotes: HeldNote[] }
> {
  const states: Array<
    | { type: 'pad'; id: string; active: boolean }
    | { type: 'instrument-pad'; id: string; notes: HeldNote[]; loopNotes: HeldNote[] }
  > = []
  for (const item of props.layout.items) {
    if (item.type === 'pad') states.push({ type: 'pad', id: item.id, active: padActive(item.id) })
    else if (item.type === 'instrument-pad') states.push({
      type: 'instrument-pad', id: item.id, notes: receivedNotes(item.id), loopNotes: recordedNotes(item.id),
    })
  }
  return states
}
interface PadDisplay {
  setWiredActive(active: boolean): void
}
interface InstrumentPadDisplay {
  setPlaybackNotes(notes: HeldNote[], loopNotes: HeldNote[]): void
  setDisplaySettings(settings: Extract<GridItem, { type: 'instrument-pad' }>['settings']): void
  choke(): void
}
const padDisplays = new Map<string, PadDisplay>()
const instrumentPadDisplays = new Map<string, InstrumentPadDisplay>()
function isPadDisplay(instance: unknown): instance is PadDisplay {
  return typeof instance === 'object' && instance !== null && 'setWiredActive' in instance &&
    typeof instance.setWiredActive === 'function'
}
function isInstrumentPadDisplay(instance: unknown): instance is InstrumentPadDisplay {
  return typeof instance === 'object' && instance !== null && 'setPlaybackNotes' in instance &&
    typeof instance.setPlaybackNotes === 'function' && 'setDisplaySettings' in instance &&
    typeof instance.setDisplaySettings === 'function' && 'choke' in instance &&
    typeof instance.choke === 'function'
}
function setPadDisplay(id: string, instance: unknown) {
  if (!isPadDisplay(instance)) { padDisplays.delete(id); return }
  padDisplays.set(id, instance)
  instance.setWiredActive(padActive(id))
}
const padDisplayRefs = new Map<string, (instance: unknown) => void>()
function padDisplayRef(id: string) {
  let handler = padDisplayRefs.get(id)
  if (!handler) {
    handler = (instance) => setPadDisplay(id, instance)
    padDisplayRefs.set(id, handler)
  }
  return handler
}
function setInstrumentPadDisplay(id: string, instance: unknown) {
  if (!isInstrumentPadDisplay(instance)) { instrumentPadDisplays.delete(id); return }
  instrumentPadDisplays.set(id, instance)
  const item = displayItems.value.find((entry) => entry.id === id)
  if (item?.type !== 'instrument-pad') return
  instance.setDisplaySettings(item.settings)
  instance.setPlaybackNotes(receivedNotes(id), recordedNotes(id))
}
const instrumentPadDisplayRefs = new Map<string, (instance: unknown) => void>()
function instrumentPadDisplayRef(id: string) {
  let handler = instrumentPadDisplayRefs.get(id)
  if (!handler) {
    handler = (instance) => setInstrumentPadDisplay(id, instance)
    instrumentPadDisplayRefs.set(id, handler)
  }
  return handler
}
watch(playbackWidgetStates, (states) => {
  for (const state of states) {
    if (state.type === 'pad') padDisplays.get(state.id)?.setWiredActive(state.active)
    else instrumentPadDisplays.get(state.id)?.setPlaybackNotes(state.notes, state.loopNotes)
  }
}, { deep: true, immediate: true, flush: 'sync' })
watch(() => renderedItems.value.flatMap(({ item }) =>
  item.type === 'instrument-pad' ? [{ id: item.id, settings: item.settings }] : []),
  (items) => {
    for (const item of items) instrumentPadDisplays.get(item.id)?.setDisplaySettings(item.settings)
  }, { immediate: true, flush: 'sync' })
const selectedDisplay = computed(() => displayItems.value.find((item) => item.id === selectedId.value))
const selectedLoopPlayhead = computed(() => {
  const item = selectedControl.value
  if (item?.type !== 'sequenced-loop') return undefined
  const playhead = loopEditorPlayheads.value.get(item.id)
  return playhead?.index === item.settings.clipIndex ? playhead.position : undefined
})
const widgetEditorPlayhead = computed(() => {
  const editor = widgetEditor.value
  const displayed = displayItems.value.find((item) => item.id === editor?.id)
  if (!editor || displayed?.type !== 'sequenced-loop' || displayed.settings.clipIndex !== editor.index) return undefined
  const position = loopPlayheads.value.get(editor.id)
  return position === undefined ? undefined : position / 100
})
function mixerChannelLabel(key: string) {
  const source = props.layout.items.find((item) =>
    outputs(item).some((port) => port.kind === 'audio' && audioOutput(item.id, port.id) === key))
  if (source) return source.label
  const boundary = props.parentAudioPorts?.find(({ port }) => audioBoundaryKey(port) === key)
  if (boundary) return boundary.port.name
  const bankLabels: Record<string, string> = {
    'bank-pre': 'Bank input',
    'bank-post': 'Bank output',
    'main-pre': 'Main input',
    'main-post': 'Main output',
  }
  return bankLabels[key] ?? 'Audio input'
}
function mixerChannelControls(item: Extract<GridItem, { type: 'tone-element' }>) {
  if (item.settings.elementType !== 'mixer') return []
  return (audioGraph.value?.getMixerInputs(item.id) ?? []).map((id) => {
    const channel = item.settings.mixerChannels?.[id]
    return { id, label: mixerChannelLabel(id), volume: channel?.volume ?? 0, pan: channel?.pan ?? 0, solo: channel?.solo ?? false }
  })
}
function changeMixerChannel(
  item: Extract<GridItem, { type: 'tone-element' }>,
  id: string,
  parameter: 'volume' | 'pan' | 'solo',
  value: number | boolean,
) {
  if (item.settings.elementType !== 'mixer') return
  item.settings.mixerChannels ??= {}
  const channel = item.settings.mixerChannels[id] ??= { volume: 0, pan: 0, solo: false }
  if (parameter === 'solo') {
    if (typeof value === 'boolean') channel.solo = value
  } else if (typeof value === 'number') {
    channel[parameter] = parameter === 'volume'
      ? Math.max(-60, Math.min(6, value))
      : Math.max(-1, Math.min(1, value))
  }
}
function cloneWidgetClip(item: Extract<GridItem, { type: 'sequenced-loop' }>, index: number) {
  const target = cloneClip(item.settings, index)
  if (target === undefined) { message.value = 'No unused clip index is available.'; return }
  item.settings.clipIndex = target
}
function cycleQuantize(item: Extract<GridItem, { type: 'sequenced-loop' }>) {
  item.settings.quantize = nextLoopQuantize(item.settings.quantize)
}
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
    selectorRoutingCompatible(props.rootLayout ?? props.layout, { layout: props.layout, connections: [...props.layout.connections,
      { id: '', sourceId: source.id, sourceParameter: outputId, targetId: target.id, targetParameter: input.id }] }) &&
    !props.layout.connections.some((connection) => connection.sourceId === source.id &&
      connection.sourceParameter === outputId && connection.targetId === target.id && connection.targetParameter === input.id))
}
const cells = computed(() => Array.from({ length: props.layout.columns * props.layout.rows }, (_, index) => ({
  x: index % props.layout.columns,
  y: Math.floor(index / props.layout.columns),
})))

watch(() => props.editing, (editing) => {
  if (editing) widgetEditor.value = null
  if (!editing) {
    selectedId.value = null
    newControl.value = false
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
    message.value = ''
  }
})

function resizeGrid() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  message.value = ''
  emit('closeSettings')
}

function nextControlId() {
  let number = 1
  while (props.layout.items.some((item) => item.id === `control-${number}`)) number++
  return `control-${number}`
}

function audioItemsCompatible(items: GridItem[]) {
  try {
    validateAudioRoutes(props.rootLayout ?? props.layout, { layout: props.layout, items })
    return true
  } catch (error) {
    if (!(error instanceof AudioRouteError)) throw error
    message.value = error.message
    return false
  }
}

function addItem(x: number, y: number) {
  selectedId.value = null
  addPosition.value = { x, y }
  message.value = ''
}

function chooseControlType(type: GridItemType) {
  const position = addPosition.value
  if (!position) return
  const item = createControl(nextControlId(), position.x, position.y, type)
  if (!audioItemsCompatible([...props.layout.items, item])) return
  addPosition.value = null
  props.layout.items.push(item)
  selectedId.value = item.id
  newControl.value = true
}

function pasteSubGrid() {
  const position = addPosition.value
  const clipboard = props.subGridClipboard
  if (!position || !clipboard) return
  const id = nextControlId()
  const item = createControl(id, position.x, position.y, 'sub-grid')
  if (item.type !== 'sub-grid') return
  item.label = clipboard.title
  item.settings.layout = pasteSubGridLayout(clipboard, `${bankId}/${id}`)
  if (!audioItemsCompatible([...props.layout.items, item])) return
  props.layout.items.push(item)
  addPosition.value = null
  selectedId.value = item.id
  newControl.value = true
}

function enterSubgrid(id: string) {
  if (!props.layout.items.some((item) => item.id === id && item.type === 'sub-grid')) return
  selectedId.value = null
  newControl.value = false
  message.value = ''
  openSubgridId.value = id
}

function leaveSubgrid() {
  openSubgridId.value = null
  subgridSettingsOpen.value = false
  subgridConfig.value = false
  if (props.settingsOpen) emit('closeSettings')
}

function isOccupied(x: number, y: number) {
  return props.layout.items.some((item) =>
    x >= item.x && x < item.x + item.width && y >= item.y && y < item.y + item.height,
  )
}

function openSettings(item: GridItem) {
  selectedId.value = item.id
  newControl.value = false
  message.value = ''
}

const { interaction, dropAction, canCopyDrop, startInteraction, updateInteraction, endInteraction, clickInteraction, completeDrop, itemStyle } =
  useGridInteraction({
    getLayout: () => props.layout,
    isEditing: () => props.editing,
    grid,
    message,
    openSettings,
    nextControlId,
    validateCopy: (item) => audioItemsCompatible([...props.layout.items, item]),
  })

function changeType(type: GridItemType) {
  const item = selectedControl.value
  if (!item || type === item.type) return
  const replacement = createControl(item.id, item.x, item.y, type)
  replacement.width = item.width
  replacement.height = item.height
  replacement.orientation = item.orientation
  if (item.label !== 'Pad' && item.label !== 'Knob') replacement.label = item.label
  const index = props.layout.items.findIndex((entry) => entry.id === item.id)
  if (index !== -1) props.layout.items[index] = replacement
}

function saveItem(item: GridItem) {
  finishSettingChanges()
  if (item.type === 'sequenced-loop' && item.settings.armed) setLoopArmed(item, true)
  selectedId.value = null
  newControl.value = false
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
  if (original.type === 'mod-wheel' && output.parameter === 'value' && output.wheelPosition !== undefined &&
    wheelPositions.get(item.id) !== output.wheelPosition) {
    wheelPositions.set(item.id, output.wheelPosition)
  }
  const sourceParameter = outputs(item).find((parameter) => parameter.id === output.parameter)
  const exposedOutputInUse = (parameter: string) => !!props.ownerSettings?.exposedPorts.some((port) =>
    port.direction === 'output' && port.itemId === item.id && port.parameterId === parameter &&
    props.connectedPorts?.includes(port.id))
  const trackPressure = output.parameter !== 'pressure' ||
    props.layout.connections.some((connection) => connection.sourceId === item.id && connection.sourceParameter === 'pressure') ||
    !!props.ownerSettings?.exposedPorts.some((port) => port.direction === 'output' &&
      port.itemId === item.id && port.parameterId === 'pressure')
  const recordVelocity = output.parameter !== 'velocity' ||
    props.layout.connections.some((connection) => connection.sourceId === item.id && connection.sourceParameter === 'velocity') ||
    exposedOutputInUse('velocity')
  const recordGate = output.parameter !== 'gate' ||
    props.layout.connections.some((connection) => connection.sourceId === item.id && connection.sourceParameter === 'gate') ||
    exposedOutputInUse('gate')
  const trackSignal = output.parameter === 'pressure' ? trackPressure
    : output.parameter === 'velocity' ? recordVelocity
      : output.parameter === 'gate' ? recordGate : true
  if (output.on === undefined && output.parameter !== 'note' && trackSignal) {
    if (output.active === false) signals.delete(`${item.id}:${output.parameter}`)
    else signals.set(`${item.id}:${output.parameter}`,
      original.type === 'knob' && output.parameter === 'value' ? original.settings.value : output.value)
  }
  const recordable = (original.type !== 'knob' && original.type !== 'mod-wheel') || original.settings.recordAutomation
  const touched = wasActive || liveControls.has(item.id) ||
    (user && output.parameter === 'velocity' && (original.type === 'pad' || original.type === 'instrument-pad' || original.type === 'piano-roll'))
  const recordPressure = output.parameter !== 'pressure' ||
    props.layout.connections.some((connection) => connection.sourceId === item.id && connection.sourceParameter === 'pressure') ||
    exposedOutputInUse('pressure')
  if (props.playing && !props.editing && recordable && recordPressure && recordVelocity && recordGate && touched &&
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

const controlOutputHandlers = new Map<string, (output: ParameterOutput) => void>()
const controlOutputListenerSets = new Map<string, { output: (output: ParameterOutput) => void }>()
function controlOutputHandler(id: string) {
  let handler = controlOutputHandlers.get(id)
  if (!handler) {
    handler = (output) => {
      const item = displayItems.value.find((entry) => entry.id === id) ??
        props.layout.items.find((entry) => entry.id === id)
      if (item) handleOutput(item, output, true)
    }
    controlOutputHandlers.set(id, handler)
  }
  return handler
}
function controlOutputListeners(id: string) {
  let listeners = controlOutputListenerSets.get(id)
  if (!listeners) {
    listeners = { output: controlOutputHandler(id) }
    controlOutputListenerSets.set(id, listeners)
  }
  return listeners
}
const instrumentLiveNoteHandlers = new Map<string, (note: number, on: boolean, velocity: number, bend?: number) => void>()
const instrumentPadListenerSets = new Map<string, {
  output: (output: ParameterOutput) => void
  liveNote: (note: number, on: boolean, velocity: number, bend?: number) => void
  choke: (group: number) => void
}>()
function instrumentLiveNoteHandler(id: string) {
  let handler = instrumentLiveNoteHandlers.get(id)
  if (!handler) {
    handler = (note, on, velocity, bend) => captureNote(id, note, on, velocity, bend)
    instrumentLiveNoteHandlers.set(id, handler)
  }
  return handler
}
function instrumentPadListeners(id: string) {
  let listeners = instrumentPadListenerSets.get(id)
  if (!listeners) {
    listeners = {
      output: controlOutputHandler(id),
      liveNote: instrumentLiveNoteHandler(id),
      choke: (group) => {
        for (const item of props.layout.items) {
          if (item.type === 'instrument-pad' && item.id !== id && item.settings.chokeGroup === group) {
            instrumentPadDisplays.get(item.id)?.choke()
          }
        }
      },
    }
    instrumentPadListenerSets.set(id, listeners)
  }
  return listeners
}
const padSignalParameters = ['velocity', 'pressure', 'gate'] as const
function routedPadSignalKeys() {
  const keys: string[] = []
  for (const item of props.layout.items) {
    if (item.type !== 'pad' && item.type !== 'instrument-pad') continue
    for (const parameter of padSignalParameters) {
      const wired = props.layout.connections.some((connection) =>
        connection.sourceId === item.id && connection.sourceParameter === parameter)
      const exposed = props.ownerSettings?.exposedPorts.some((port) =>
        port.direction === 'output' && port.itemId === item.id && port.parameterId === parameter &&
        (parameter === 'pressure' || props.connectedPorts?.includes(port.id)))
      if (wired || exposed) keys.push(`${item.id}:${parameter}`)
    }
  }
  return keys
}
watch(routedPadSignalKeys, (keys) => {
  const routed = new Set(keys)
  for (const item of props.layout.items) {
    if (item.type !== 'pad' && item.type !== 'instrument-pad') continue
    for (const parameter of padSignalParameters) {
      const key = `${item.id}:${parameter}`
      if (!routed.has(key)) signals.delete(key)
    }
  }
}, { immediate: true, flush: 'sync' })

function routeNote(sourceId: string, output: ParameterOutput, selectedOverride?: Connection | null) {
  const source = props.layout.items.find((entry) => entry.id === sourceId)
  if (!source) return
  const selected = source.type === 'output-selector'
    ? selectedOverride === undefined ? selectedSelectorWire(modulationLayout.value.connections, source) : selectedOverride
    : undefined
  for (const port of props.ownerSettings?.exposedPorts ?? []) {
    if (port.kind === 'note' && port.direction === 'output' && port.itemId === sourceId && port.parameterId === output.parameter) {
      if (source.type === 'output-selector' && !(selected?.targetId === '' && selected.targetParameter === port.id)) continue
      emit('boundaryOutput', port.id, output)
    }
  }
  for (const connection of props.layout.connections) {
    if (connection.sourceId !== sourceId || connection.sourceParameter !== output.parameter ||
      (source.type === 'output-selector' && connection.id !== selected?.id)) continue
    const target = props.layout.items.find((entry) => entry.id === connection.targetId)
    const targetParameter = target && inputs(target).find((parameter) => parameter.id === connection.targetParameter)
    if (!target || !targetParameter) continue
    if (targetParameter.kind === 'note' && (target.type === 'pad' || target.type === 'instrument-pad' || target.type === 'arpeggiator' || target.type === 'output-selector' || target.type === 'tone-element' || target.type === 'sub-grid')) {
      const key = `${connection.id}:${output.value}`
      const previous = activeNotes.get(key)
      const count = previous?.count ?? 0
      if (output.on === undefined) {
        if (previous && output.bend !== undefined) activeNotes.set(key, { ...previous, bend: output.bend })
        else continue
      } else if (output.on) activeNotes.set(key, { count: count + 1, velocity: output.velocity ?? 100, bend: output.bend, sequence: ++noteSequence })
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

function boundaryNotesForSubGrid(id: string): BoundaryNote[] {
  const notes: BoundaryNote[] = []
  for (const connection of props.layout.connections) {
    if (connection.targetId !== id) continue
    const prefix = `${connection.id}:`
    for (const [key, active] of activeNotes) {
      if (!key.startsWith(prefix)) continue
      notes.push({ id: JSON.stringify(['wire', connection.id, key.slice(prefix.length)]),
        portId: connection.targetParameter, note: Number(key.slice(prefix.length)), count: active.count,
        velocity: active.velocity, bend: active.bend })
    }
  }
  for (const [key, active] of boundaryActiveNotes) {
    if (active.targetId === id) notes.push({ id: JSON.stringify(['boundary', key]), portId: active.targetParameter,
      note: active.note, count: active.count, velocity: active.velocity, bend: active.bend })
  }
  return notes
}

watch(() => props.boundaryNotes ?? [], (incoming) => {
  const next = new Map<string, BoundaryNote & { targetId: string; targetParameter: string }>()
  for (const note of incoming) {
    const port = props.ownerSettings?.exposedPorts.find((entry) => entry.id === note.portId &&
      entry.kind === 'note' && entry.direction === 'input')
    if (!port?.itemId || !port.parameterId) continue
    next.set(JSON.stringify([note.portId, note.id]), { ...note, targetId: port.itemId, targetParameter: port.parameterId })
  }
  for (const key of new Set([...boundaryActiveNotes.keys(), ...next.keys()])) {
    const before = boundaryActiveNotes.get(key)
    const after = next.get(key)
    const target = props.layout.items.find((item) => item.id === (after ?? before)?.targetId)
    const sameTarget = before && after && before.targetId === after.targetId &&
      before.targetParameter === after.targetParameter && before.note === after.note
    const oldCount = sameTarget ? before.count : 0
    const newCount = sameTarget ? after.count : 0
    if (before && (!sameTarget || before.count > newCount)) {
      const oldTarget = props.layout.items.find((item) => item.id === before.targetId)
      if (oldTarget?.type === 'output-selector') {
        for (let i = sameTarget ? newCount : 0; i < before.count; i++) {
          routeNote(oldTarget.id, { parameter: 'note', value: before.note, on: false, velocity: before.velocity })
        }
      }
    }
    if (!after) { boundaryActiveNotes.delete(key); continue }
    boundaryActiveNotes.set(key, { ...after,
      sequence: !sameTarget || after.count > oldCount ? ++noteSequence : before.sequence })
    if (target?.type === 'output-selector') {
      for (let i = sameTarget ? oldCount : 0; i < after.count; i++) {
        routeNote(target.id, { parameter: 'note', value: after.note, on: true, velocity: after.velocity, bend: after.bend })
      }
      if (sameTarget && after.count && before.bend !== after.bend && after.bend !== undefined) {
        routeNote(target.id, { parameter: 'note', value: after.note, bend: after.bend })
      }
    }
    if (target && (target.type === 'pad' || target.type === 'instrument-pad') && after.count > oldCount) {
      handleOutput(target, { parameter: 'velocity', value: after.velocity })
    }
  }
}, { deep: true, immediate: true, flush: 'sync' })

function selectorDestination(item: GridItem) {
  const wire = selectedSelectorWire(modulationLayout.value.connections, item)
  const port = wire && selectorPortWires.value.some((entry) => entry.id === wire.id)
    ? props.ownerSettings?.exposedPorts.find((entry) => entry.id === wire.targetParameter) : undefined
  if (port) return `Parent / ${port.name}`
  const target = wire && props.layout.items.find((entry) => entry.id === wire.targetId)
  const input = target && inputs(target).find((parameter) => parameter.id === wire?.targetParameter)
  return target && input ? `${target.label} / ${input.label}` : 'No destination'
}

function numericWireValue(wire: Connection) {
  const external = resolvedBoundaryNumeric().find((entry) => entry.wire === wire ||
    (entry.wire.id === wire.id && entry.wire.targetId === wire.targetId && entry.wire.targetParameter === wire.targetParameter))
  const signal = external?.signal ?? numericSignal(modulationLayout.value, wire, effectiveSignals.value,
    (id) => displayItems.value.find((entry) => entry.id === id), resolvedBoundaryNumeric(), boundaryOutputSignals)
  if (!signal) return undefined
  const offset = modulationOffset(wire, signal)
  return offset === undefined ? signal.value : selectorNumericValue(wire, signal, normalizeSignal(signal.value, signal.min, signal.max) * 127)
}

function selectorInputValue(wire: Connection, externalSignal?: BoundaryNumeric['signal']) {
  const signal = externalSignal ?? numericSignal(modulationLayout.value, wire, effectiveSignals.value,
    (id) => displayItems.value.find((entry) => entry.id === id), resolvedBoundaryNumeric(), boundaryOutputSignals)
  if (!signal) return undefined
  const target = props.layout.items.find((item) => item.id === wire.targetId)
  const count = modulationLayout.value.connections.filter((connection) => connection.sourceId === wire.targetId).length
  const base = target?.type === 'output-selector' && count
    ? ((target.settings.baseIndex ?? target.settings.index) % count + 0.5) * 128 / count : 0
  return selectorNumericValue(wire, signal, base)
}

function selectorValue(item: GridItem) {
  const incoming = props.layout.connections.find((wire) => wire.targetId === item.id && wire.targetParameter !== 'selection') ??
    resolvedBoundaryNumeric().find((entry) => entry.wire.targetId === item.id && entry.wire.targetParameter === 'value')?.wire
  if (!incoming && [...boundaryActiveNotes.values()].some((note) => note.targetId === item.id)) {
    const note = receivedNotes(item.id).at(-1)?.note
    return note === undefined ? 'No signal' : noteName(note)
  }
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
  const count = modulationLayout.value.connections.filter((wire) => wire.sourceId === item.id).length
  if (userInitiated && count) item.settings.baseIndex = index
  if (!count || item.settings.index % count === index) return
  const notes = receivedNotes(item.id)
  for (const note of notes) for (let i = 0; i < note.count; i++) {
    routeNote(item.id, { parameter: 'note', value: note.note, on: false, velocity: note.velocity })
  }
  item.settings.index = index
  const selected = selectedSelectorWire(modulationLayout.value.connections, item)
  if (selected && selected.targetId && userInitiated) {
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
  const count = modulationLayout.value.connections.filter((wire) => wire.sourceId === item.id).length
  if (count < 2) return
  setSelectorIndex(original, (original.settings.index + 1) % count, true)
}

watch(() => props.layout.items.filter((item) => item.type === 'output-selector').map((item) => {
  const wires = modulationLayout.value.connections.filter((wire) => wire.sourceId === item.id)
  return { id: item.id, wires, selected: wires[item.settings.index % wires.length] }
}), (current, previous) => {
  for (const entry of current) {
    const old = previous?.find((item) => item.id === entry.id)
    if (!old || JSON.stringify(old.wires.map((wire) => wire.id)) === JSON.stringify(entry.wires.map((wire) => wire.id)) ||
      old.selected?.id === entry.selected?.id) continue
    for (const note of receivedNotes(entry.id)) for (let i = 0; i < note.count; i++) {
      if (old.selected) routeNote(entry.id, { parameter: 'note', value: note.note, on: false, velocity: note.velocity }, old.selected)
      if (entry.selected) routeNote(entry.id, { parameter: 'note', value: note.note, on: true, velocity: note.velocity, bend: note.bend }, entry.selected)
    }
  }
}, { flush: 'sync' })

watch(() => props.layout.items.filter((item) => item.type === 'output-selector').map((item) => {
  const external = resolvedBoundaryNumeric().find((entry) => entry.wire.targetId === item.id && entry.wire.targetParameter === 'selection')
  const wire = props.layout.connections.find((entry) => entry.targetId === item.id && entry.targetParameter === 'selection') ?? external?.wire
  const origin = wire && !external ? signalSource(modulationLayout.value, wire) : undefined
  return { id: item.id, wireId: wire?.id, originId: origin?.id, wire, value: wire && selectorInputValue(wire, external?.signal) }
}), (current, previous) => {
  for (const selection of current) {
    const old = previous?.find((entry) => entry.id === selection.id)
    if (old && old.wireId === selection.wireId && old.originId === selection.originId && old.value === selection.value) continue
    const item = props.layout.items.find((entry) => entry.id === selection.id)
    const count = modulationLayout.value.connections.filter((wire) => wire.sourceId === selection.id).length
    if (!item || item.type !== 'output-selector' || !count) continue
    const wire = selection.wire
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
    [...activeNotes.keys()].some((key) => key.startsWith(`${connection.id}:`))) ||
    [...boundaryActiveNotes.values()].some((note) => note.targetId === id && note.targetParameter === 'note')
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
  for (const active of boundaryActiveNotes.values()) {
    if (active.targetId !== id || active.targetParameter !== 'note') continue
    const previous = notes.get(active.note)
    notes.set(active.note, { note: active.note, count: (previous?.count ?? 0) + active.count, velocity: active.velocity, bend: active.bend })
  }
  return [...notes.values()].sort((a, b) => a.note - b.note)
}

function receivedToneNotes(id: string): HeldNote[] {
  const notes: { note: HeldNote; sequence: number }[] = []
  for (const connection of props.layout.connections) {
    if (connection.targetId !== id || connection.targetParameter !== 'note') continue
    const prefix = `${connection.id}:`
    for (const [key, active] of activeNotes) {
      if (!key.startsWith(prefix)) continue
      notes.push({ note: { note: Number(key.slice(prefix.length)), count: active.count,
        velocity: active.velocity, bend: active.bend }, sequence: active.sequence })
    }
  }
  for (const active of boundaryActiveNotes.values()) {
    if (active.targetId === id && active.targetParameter === 'note') notes.push({
      note: { note: active.note, count: active.count, velocity: active.velocity, bend: active.bend }, sequence: active.sequence })
  }
  return notes.sort((a, b) => a.sequence - b.sequence).map((entry) => entry.note)
}

function toggleArpeggiator(id: string) {
  const item = props.layout.items.find((entry) => entry.id === id)
  if (item?.type !== 'arpeggiator') return
  const automated = effectiveSignals.value.get(`${id}:enabled`)
  item.settings.enabled = !(automated === undefined ? item.settings.enabled : automated >= 0.5)
  recordToggle(id, 'enabled', item.settings.enabled)
}

function recordToggle(id: string, parameter: 'enabled', value: boolean) {
  if (props.playing && !props.editing) {
    bankEvents.emit({ kind: 'live-automation', bankId, sourceId: id, parameter, value: Number(value) })
    markManualOverride(id, parameter)
  }
}

function sampleLfo(id: string, settings: Extract<GridItem, { type: 'lfo' }>['settings']) {
  return audioGraph.value?.getLfoSample(id, settings, props.bpm)
}
const knobDisplays = new Map<string, { setDisplayValue: (value?: number) => void }>()
const bypassedKnobs = new Map<string, Set<string>>()
const audioOnlyLfoCache = new Map<string, Set<string> | null>()
const lfoKnobDisplayTimes = new Map<string, number>()
const lfoKnobDisplayIntervalMs = 1000 / 12
function setKnobDisplay(id: string, instance: unknown) {
  if (typeof instance === 'object' && instance !== null && 'setDisplayValue' in instance &&
    typeof instance.setDisplayValue === 'function') {
    const setDisplayValue = instance.setDisplayValue
    knobDisplays.set(id, { setDisplayValue: (value) => setDisplayValue(value) })
  } else knobDisplays.delete(id)
}
function audioOnlyLfo(id: string): Set<string> | undefined {
  const graph = audioGraph.value
  if (!graph || props.editing || props.wiring || props.settingsOpen || props.volumeMode) return undefined
  if (audioOnlyLfoCache.has(id)) return audioOnlyLfoCache.get(id) ?? undefined
  const knobs = new Set<string>()
  const visiting = new Set<string>()
  function visit(sourceId: string): boolean {
    if (visiting.has(sourceId) || props.ownerSettings?.exposedPorts.some((port) =>
      port.direction === 'output' && port.kind === 'numeric' && port.itemId === sourceId && port.parameterId === 'value')) return false
    visiting.add(sourceId)
    const wires = props.layout.connections.filter((wire) => wire.sourceId === sourceId && wire.sourceParameter === 'value')
    if (!wires.length) return false
    const safe = wires.every((wire) => {
      const target = props.layout.items.find((item) => item.id === wire.targetId)
      if (target?.type === 'knob' && wire.targetParameter === 'value' && graph!.hasModulationMonitor(target.id)) {
        knobs.add(target.id)
        return visit(target.id)
      }
      return target?.type === 'tone-element' && graph!.isModulationDriven(target.id, wire.targetParameter)
    })
    visiting.delete(sourceId)
    return safe
  }
  const result = visit(id) ? knobs : undefined
  audioOnlyLfoCache.set(id, result ?? null)
  return result
}
function resetBypassedKnobs(id: string) {
  for (const knob of bypassedKnobs.get(id) ?? []) knobDisplays.get(knob)?.setDisplayValue()
  bypassedKnobs.delete(id)
  lfoKnobDisplayTimes.delete(id)
}
function publishLfo(item: Extract<GridItem, { type: 'lfo' }>, value: number, audioAvailable: boolean) {
  const knobs = audioAvailable ? audioOnlyLfo(item.id) : undefined
  if (!knobs) {
    resetBypassedKnobs(item.id)
    handleOutput(item, { parameter: 'value', value })
    return
  }
  const key = `${item.id}:value`
  if (signals.has(key)) signals.delete(key)
  bypassedKnobs.set(item.id, knobs)
  const now = performance.now()
  if (now - (lfoKnobDisplayTimes.get(item.id) ?? -Infinity) < lfoKnobDisplayIntervalMs) return
  lfoKnobDisplayTimes.set(item.id, now)
  for (const id of knobs) {
    const target = props.layout.items.find((candidate) => candidate.id === id)
    const sample = audioGraph.value?.getModulationSample(id)
    if (target?.type !== 'knob' || sample === undefined || !Number.isFinite(sample)) continue
    const { min, max, step } = target.settings
    const value = Number(Math.max(min, Math.min(max, min + Math.round((sample - min) / step) * step)).toPrecision(12))
    knobDisplays.get(id)?.setDisplayValue(value)
  }
}
watch(() => JSON.stringify(props.layout.connections), () => {
  audioOnlyLfoCache.clear()
  for (const id of [...bypassedKnobs.keys()]) resetBypassedKnobs(id)
})
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
  try {
    validateAudioRoutes(props.rootLayout ?? props.layout, { layout: props.layout, connections: [...props.layout.connections, connection] })
  } catch (error) {
    if (!(error instanceof AudioRouteError)) throw error
    message.value = error.message
    return
  }
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
  const target = props.layout.items.find((item) => item.id === connection.targetId)
  if (target?.type === 'output-selector' && connection.targetParameter === 'note') {
    const prefix = `${connection.id}:`
    for (const [key, note] of activeNotes) if (key.startsWith(prefix)) {
      for (let i = 0; i < note.count; i++) routeNote(target.id, {
        parameter: 'note', value: Number(key.slice(prefix.length)), on: false, velocity: note.velocity,
      })
    }
  }
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
  finishSettingChanges()
  if (props.ownerSettings?.exposedPorts.some((port) => port.itemId === selectedId.value)) {
    message.value = 'Remove the control’s exposed ports before deleting it.'
    return
  }
  for (const connection of [...props.layout.connections]) {
    if (connection.sourceId === selectedId.value || connection.targetId === selectedId.value) removeWire(connection)
  }
  const index = props.layout.items.findIndex((item) => item.id === selectedId.value)
  if (index !== -1) props.layout.items.splice(index, 1)
  if (props.ownerSettings) {
    const surfaceIndex = props.ownerSettings.surfaceItemIds.indexOf(selectedId.value ?? '')
    if (surfaceIndex >= 0) props.ownerSettings.surfaceItemIds.splice(surfaceIndex, 1)
  }
  selectedId.value = null
  newControl.value = false
  message.value = ''
}

function protectedSubGridPorts(id: string): string[] {
  const protectedIds = new Set<string>()
  for (const wire of props.layout.connections) {
    if (wire.sourceId === id) protectedIds.add(wire.sourceParameter)
    if (wire.targetId === id) protectedIds.add(wire.targetParameter)
  }
  for (const port of props.ownerSettings?.exposedPorts ?? []) {
    if (port.itemId === id && port.parameterId) protectedIds.add(port.parameterId)
  }
  return [...protectedIds]
}

function connectedSubGridPorts(id: string): string[] {
  const connected = new Set(props.layout.connections.flatMap((wire) => [
    ...(wire.sourceId === id ? [wire.sourceParameter] : []),
    ...(wire.targetId === id ? [wire.targetParameter] : []),
  ]))
  for (const port of props.ownerSettings?.exposedPorts ?? []) {
    if (port.itemId === id && port.parameterId && props.connectedPorts?.includes(port.id)) connected.add(port.parameterId)
  }
  return [...connected]
}

function audioPortsForSubGrid(item: Extract<GridItem, { type: 'sub-grid' }>): BoundaryAudio[] {
  const connected = connectedSubGridPorts(item.id)
  return item.settings.exposedPorts.flatMap((port) => {
    if (port.kind !== 'audio' || !connected.includes(port.id)) return []
    const node = audioGraph.value?.getPort(item.id, port)
    return node ? [{ port, node }] : []
  })
}

</script>

<template>
  <div class="grid-editor">
    <p v-if="!openSubgrid && editing && !wiring" class="edit-hint">Tap + to add a control. Tap a control to edit it.</p>
    <p v-if="!openSubgrid && wiring" class="edit-hint">{{ wireFirst ? 'Choose a destination control.' : 'Drag from a source to a destination, or tap each in order.' }}</p>
    <p v-if="!openSubgrid && message && !selectedControl && !settingsOpen" class="grid-message" role="alert">{{ message }}</p>
    <p v-if="displayedAudioError" class="grid-message" role="alert">{{ displayedAudioError }}</p>

    <div v-show="!openSubgrid" class="grid-area">
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

        <template v-for="{ item, original } in renderedItems" :key="item.id">
        <Teleport :to="surfaceTarget || 'body'" :disabled="!surfaceTarget || !ownerSettings?.surfaceItemIds.includes(item.id)">
        <div class="grid-item" :style="surfaceTarget && ownerSettings?.surfaceItemIds.includes(item.id) ? surfaceStyle(original) : itemStyle(original)">
          <div v-show="!editing && !wiring && !volumeMode" class="grid-item-component" :class="{ rotated: item.orientation === 'vertical' }">
            <MPCPad v-if="item.type === 'pad' && original.type === 'pad'" :ref="padDisplayRef(item.id)" :label="original.label" :settings="original.settings" :rotated="original.orientation === 'vertical'" :repeat-division="repeatDivision" :bpm="bpm" :playing="playing" :transport-clock="clock" v-on="controlOutputListeners(item.id)" />
            <Knob v-else-if="item.type === 'knob'" :ref="(instance) => setKnobDisplay(item.id, instance)" :label="item.label" :settings="item.settings" :rotated="item.orientation === 'vertical'" emit-initial @output="handleOutput(item, $event)" @activity="controlActivity(item.id, $event)" />
            <LFO v-else-if="item.type === 'lfo'" :label="item.label" :settings="item.settings" :bpm="bpm" :source-id="item.id" :sample-lfo="sampleLfo" :publish-value="(value, available) => publishLfo(item, value, available)" />
            <ModWheel v-else-if="item.type === 'mod-wheel'" :label="item.label" :settings="item.settings" :rotated="item.orientation === 'vertical'" :automation-value="displayedAutomation(item.id, 'value')" @output="handleOutput(item, $event)" @activity="controlActivity(item.id, $event)" />
            <PianoRoll v-else-if="item.type === 'piano-roll' && original.type === 'piano-roll'" :label="original.label" :settings="original.settings" :rotated="original.orientation === 'vertical'" :repeat-division="repeatDivision" :bpm="bpm" :playing="playing" :transport-clock="clock" v-on="controlOutputListeners(item.id)" />
            <InstrumentPad v-else-if="item.type === 'instrument-pad' && original.type === 'instrument-pad'" :ref="instrumentPadDisplayRef(item.id)" :key="original.settings.instrumentType" :label="original.label" :settings="original.settings" :audio-output="audioGraph?.getOutput(item.id)" :audio-unavailable="!audioGraph?.getOutput(item.id)" :disabled="!audioGraph?.getOutput(item.id)" :rotated="original.orientation === 'vertical'" :repeat-division="repeatDivision" :bpm="bpm" :playing="playing" :transport-clock="clock" v-on="instrumentPadListeners(item.id)" />
            <OutputSelector v-else-if="item.type === 'output-selector'" :label="item.label"
              :destination="selectorDestination(item)" :value="selectorValue(item)"
              :flash-sequence="selectorFlash?.sourceId === item.id ? selectorFlash.sequence : 0"
              @advance="advanceSelector(item)" />
            <Arpeggiator v-else-if="item.type === 'arpeggiator'" :label="item.label" :settings="item.settings" :bpm="bpm" :notes="receivedNotes(item.id)" :playing="playing" :transport-clock="clock" @output="handleOutput(item, $event)" @toggle="toggleArpeggiator(item.id)" />
            <SubGrid v-else-if="item.type === 'sub-grid' && original.type === 'sub-grid'" :item="item" :original="original" @open="enterSubgrid(item.id)">
              <div :ref="(element) => setSurfaceTarget(item.id, element)" class="subgrid-surface"
                :style="subgridSurfaceStyle(original)" />
            </SubGrid>
            <ToneOscillator v-else-if="item.type === 'tone-element' && original.type === 'tone-element' && item.settings.elementType === 'oscillator' && audioGraph?.getOutput(item.id)"
              :label="item.label" :settings="item.settings" :base-frequency="original.settings.frequency"
              :notes="receivedToneNotes(item.id)" :audio-output="audioGraph?.getInput(item.id)" :muted="!!original.settings.muted"
              @toggle-mute="original.settings.muted = !original.settings.muted" />
            <ToneNoise v-else-if="item.type === 'tone-element' && original.type === 'tone-element' && item.settings.elementType === 'noise' && audioGraph?.getOutput(item.id)"
              :label="item.label" :settings="item.settings" :notes="receivedToneNotes(item.id)"
              :audio-output="audioGraph?.getInput(item.id)" :muted="!!original.settings.muted"
              @toggle-mute="original.settings.muted = !original.settings.muted" />
            <div v-else-if="item.type === 'tone-element' && original.type === 'tone-element' && (item.settings.elementType === 'envelope' || item.settings.elementType === 'mixer')" class="tone-with-bypass">
              <div class="tone-bypass-content">
                <ADSREnvelopeEditor v-if="item.settings.elementType === 'envelope'"
                  compact :title="item.label" :envelope="item.settings" :color="item.settings.color"
                  :show-visualizer="item.settings.showVisualizer ?? true" :show-knobs="item.settings.showKnobs ?? true"
                  :attack-max="5" :decay-min="0.01" :decay-max="10"
                  @change="(parameter, output) => changeEnvelope(item, parameter, output)" @activity="setSettingGesture"
                  @open-settings="openSettings(original)" />
                <ChannelMixer v-else :label="item.label" :color="item.settings.color" :channels="mixerChannelControls(original)"
                  @change="(id, parameter, value) => changeMixerChannel(original, id, parameter, value)" />
              </div>
              <button v-if="original.settings.showBypass || original.settings.bypassed" type="button" class="tone-bypass-button"
                :aria-label="`${original.settings.bypassed ? 'Enable' : 'Bypass'} ${item.label}`"
                :aria-pressed="!!original.settings.bypassed" :disabled="!audioGraph?.getOutput(item.id)"
                @click="original.settings.bypassed = !original.settings.bypassed">{{ original.settings.bypassed ? 'Bypassed' : 'Bypass' }}</button>
            </div>
            <ToneElement v-else-if="item.type === 'tone-element' && original.type === 'tone-element'" :label="item.label" :settings="original.settings"
              :available="!!audioGraph?.getOutput(item.id) && ['filter', 'gain', 'delay', 'reverb'].includes(item.settings.elementType)"
              @toggle-mute="original.settings.tapMode === 'bypass' ? original.settings.bypassed = !original.settings.bypassed : original.settings.muted = !original.settings.muted" />
            <SequencedLoop v-else-if="item.type === 'sequenced-loop' && original.type === 'sequenced-loop'"
              :item="item" :original="original" :playing="playing" :status="loopStatus.get(item.id)"
              :playhead="loopPlayheads.get(item.id)" :wants-playback="loopWantsPlayback(item)" :gesture="loopGesture(item.id)"
              :get-curves="loopPreviewCurves" :notes="selectedLoopNotes(item)" :preview-x="previewX" :preview-y="previewY" :preview-color="previewColor"
              @keydown="loopKeyDown($event, item.id)" @arm="armLoop(item.id)" @toggle-playback="toggleLoopPlayback(item.id)"
              @clear="clearLoopClip(item.id)" @clone="cloneWidgetClip(original, item.settings.clipIndex)"
              @change-index="changeLoopIndex(item.id, $event)" @open-editor="widgetEditor = { id: item.id, index: item.settings.clipIndex }"
              @quantize="cycleQuantize(original)" />
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
            @click="clickInteraction($event, original)"
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
            @click="clickInteraction($event, original)"
          ><span aria-hidden="true">◢</span></button>
          <button v-if="wiring" type="button" class="wire-control" :class="{ selected: wireFirst === item.id }"
            :data-wire-id="item.id" :aria-label="`Wire ${item.label}`"
            @pointerdown="wirePointerDown($event, original)" @pointermove="wirePointerMove"
            @pointerup="wirePointerEnd($event)" @pointercancel="wirePointerEnd($event, true)"
            @lostpointercapture="wirePointerEnd($event, true)"
            @click="$event.detail === 0 && keyboardWire(original)">
            <span :class="{ 'vertical-edit-label': item.orientation === 'vertical' }">{{ item.label }}</span>
          </button>
          <button v-if="configurationMode" type="button" class="wire-control"
            :aria-label="`Configure ${original.label}`" @click="configuringId = item.id">{{ original.label }}</button>
        </div>
        </Teleport>
        </template>
      </div>
    </div>

    <div v-if="openSubgrid" class="subgrid-navigation">
      <button type="button" @click="leaveSubgrid">Back</button>
      <strong>{{ openSubgrid.label }}</strong>
      <button type="button" :aria-pressed="subgridConfig" @click="subgridConfig = !subgridConfig">CFG</button>
      <button type="button" @click="subgridSettingsOpen = true">Grid settings</button>
    </div>
    <template v-for="item in layout.items" :key="item.id">
      <GrooveGrid v-if="item.type === 'sub-grid' && audioGraph?.getInput(item.id) && audioGraph?.getOutput(item.id)"
        v-show="openSubgridId === item.id" :layout="item.settings.layout" :root-layout="rootLayout ?? layout" :bank-id="`${bankId}/${item.id}`"
        :parent-audio-input="audioGraph.getInput(item.id)" :parent-audio-output="audioGraph.getOutput(item.id)"
        :parent-audio-ports="audioPortsForSubGrid(item)"
        :banks="banks" :bank-events="bankEvents" :transport-clock="clock" :bpm="bpm" :playing="playing"
        :start-on-input="startOnInput" :transport-start-immediate="transportStartImmediate" :triggered-by-input="triggeredByInput"
        :sub-grid-clipboard="subGridClipboard" :repeat-division="repeatDivision"
        :owner-settings="item.settings" :configuration-mode="subgridConfig && openSubgridId === item.id"
        :protected-ports="protectedSubGridPorts(item.id)" :boundary-notes="boundaryNotesForSubGrid(item.id)"
        :connected-ports="connectedSubGridPorts(item.id)"
        :boundary-numeric="boundaryNumericForSubGrid(item.id)"
        :surface-target="openSubgridId !== item.id && !editing && !wiring && !volumeMode ? surfaceTargets.get(item.id) : undefined"
        :editing="editing && openSubgridId === item.id && !subgridConfig" :wiring="wiring && openSubgridId === item.id && !subgridConfig"
        :volume-mode="volumeMode && openSubgridId === item.id"
        :settings-open="openSubgridId === item.id && (settingsOpen || subgridSettingsOpen)"
        @close-settings="subgridSettingsOpen = false; emit('closeSettings')" @audio-error="setNestedAudioError(item.id, $event)"
        @boundary-output="(port, output) => routeNote(item.id, { ...output, parameter: port })"
        @boundary-numeric="(port, signal) => setBoundaryOutput(item.id, port, signal)" />
    </template>
    <SubGridConfigDialog v-if="configuringItem && ownerSettings" :item="configuringItem" :settings="ownerSettings"
      :protected-ports="protectedPorts" @close="configuringId = null" />

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

    <SettingsDialog v-if="settingsOpen && !openSubgrid" title="Grid settings" @close="resizeGrid">
      <form class="settings-form" @submit.prevent="resizeGrid">
        <div class="settings-dimensions grid-dimensions">
          <NumericSetting v-model="layout.columns" label="Columns" :min="Math.max(1, ...layout.items.map((item) => item.x + item.width))" :max="MAX_GRID_COLUMNS" integer />
          <NumericSetting v-model="layout.rows" label="Rows" :min="Math.max(1, ...layout.items.map((item) => item.y + item.height))" :max="MAX_GRID_ROWS" integer />
        </div>
        <p v-if="message" class="grid-message" role="alert">{{ message }}</p>
      </form>
    </SettingsDialog>

    <SettingsDialog v-if="addPosition" title="Add control" @close="addPosition = null">
      <p class="control-picker-hint">Choose a control to add to your grid.</p>
      <p v-if="message" class="grid-message" role="alert">{{ message }}</p>
      <div class="control-picker">
        <button v-if="subGridClipboard" type="button" class="control-picker-button" @click="pasteSubGrid">
          <span><strong>Paste SubGrid</strong><small>{{ subGridClipboard.title }}</small></span>
        </button>
        <button v-for="control in controlTypes" :key="control.type" type="button" class="control-picker-button"
          @click="chooseControlType(control.type)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="control.icon" /></svg>
          <span><strong>{{ control.label }}</strong><small>{{ control.description }}</small></span>
        </button>
      </div>
    </SettingsDialog>

    <GridControlSettingsDialog v-if="selectedControl" :draft="selectedControl" :display-item="selectedDisplay" :selected-id="selectedId" :new-control="newControl" :layout="layout" :root-layout="rootLayout ?? layout" :bpm="bpm" :banks="banks" :bank-id="bankId" :nested="!!parentAudioInput" :owner-settings="ownerSettings" :boundary-audio="parentAudioPorts"
      :loop-playhead="selectedLoopPlayhead"
      :message="message" @update:message="message = $event"
      @save="saveItem"
      @arm-change="selectedControl?.type === 'sequenced-loop' && setLoopArmed(selectedControl, $event)"
      @setting-change="selectedId && recordSettingChange(selectedId, $event)"
      @setting-activity="setSettingGesture"
      @open-sub-grid="enterSubgrid"
      @remove="removeItem" @remove-wire="removeWire" @change-type="changeType" />
    <SequencedLoopSettingsPanel v-if="widgetEditorLoop && widgetEditor" :draft="widgetEditorLoop" :layout="layout" :banks="banks" :bank-id="bankId"
      editor-only :editor-clip-index="widgetEditor.index" :playhead="widgetEditorPlayhead"
      @update:editor-clip-index="widgetEditor.index = $event" @close-editor="widgetEditor = null" />
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

