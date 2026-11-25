<script setup lang="ts">
import { ref, watch, computed, provide } from 'vue'
import { createControl, isValidPlacement, MAX_LOOP_CLIP_INDEX, validPianoRollSettings, type Connection, type GridItem, type GridItemType, type GridLayout, type SubGridSettings, type ToneElementKind, type ToneElementSettings } from '../grid'
import { isCompatible, inputs, outputs, selectorConnectionsCompatible, selectorRoutingCompatible } from '../parameters'
import { InstrumentFactory } from '../instruments'
import type { InstrumentType } from '../instruments/types'
import type ControlIdentitySettings from './ControlIdentitySettings.vue'
import InstrumentPadSettingsPanel from './instruments/InstrumentPadSettingsPanel.vue'
import KnobSettingsPanel from './KnobSettingsPanel.vue'
import LFOSettingsPanel from './LFOSettingsPanel.vue'
import ModWheelSettingsPanel from './ModWheelSettingsPanel.vue'
import PianoRollSettingsPanel from './PianoRollSettingsPanel.vue'
import ArpeggiatorSettingsPanel from './ArpeggiatorSettingsPanel.vue'
import SequencedLoopSettingsPanel from './SequencedLoopSettingsPanel.vue'
import ControlIdentitySettingsComponent from './ControlIdentitySettings.vue'
import SettingsDialog from './SettingsDialog.vue'
import ConnectionMapping from './ConnectionMapping.vue'
import InstrumentPad from './InstrumentPad.vue'
import LFO from './LFO.vue'
import NumericSetting from './NumericSetting.vue'
import ADSREnvelopeEditor from './ADSREnvelopeEditor.vue'
import { controlTypes } from './gridControlTypes'
import type { Bank } from '../project'
import { captureSettings, settingGestureKey } from '../settingsAutomation'
import { AudioRouteError, audioInput, audioOutput, isAudioSource, planAudioRoutes, validateAudioRoutes } from '../audio/audioRoutes'
import type { BoundaryAudio } from '../audio/bankAudio'

const props = defineProps<{
  draft: GridItem
  displayItem?: GridItem
  selectedId: string | null
  newControl: boolean
  layout: GridLayout
  rootLayout?: GridLayout
  bpm: number
  message: string
  banks?: Bank[]
  bankId?: string
  loopPlayhead?: number
  nested?: boolean
  ownerSettings?: SubGridSettings
  boundaryAudio?: BoundaryAudio[]
}>()
const emit = defineEmits<{
  save: [item: GridItem]
  remove: []
  removeWire: [connection: Connection]
  changeType: [type: GridItemType]
  armChange: [armed: boolean]
  settingChange: [change: { id: string; value: number; continuous: boolean }]
  settingActivity: [active: boolean]
  openSubGrid: [id: string]
  'update:message': [message: string]
}>()

const controlIdentity = ref<InstanceType<typeof ControlIdentitySettings> | null>(null)
const sampleLoading = ref(false)
const message = computed({
  get: () => props.message,
  set: (value: string) => emit('update:message', value),
})
const effectiveAudioRoute = computed(() => {
  const item = props.draft
  if (item.type !== 'tone-element') return ''
  try {
    const edges = planAudioRoutes(props.layout, props.boundaryAudio?.map(({ port }) => port))
    const name = (id: string) => {
      if (id === 'bank-pre') return 'Bank pre-FX'
      if (id === 'bank-post') return 'Bank output'
      if (id === 'main-pre') return 'Main pre-FX'
      if (id === 'main-post') return 'Main output'
      for (const entry of props.layout.items) if (entry.type === 'sub-grid') {
        const port = entry.settings.exposedPorts.find((candidate) => candidate.kind === 'audio' &&
          (audioInput(entry.id, candidate.id) === id || audioOutput(entry.id, candidate.id) === id))
        if (port) return `${entry.label} / ${port.name}`
      }
      const control = props.layout.items.find((entry) => audioInput(entry.id) === id || audioOutput(entry.id) === id)
      return control?.label ?? id
    }
    const sources = edges.filter((edge) => edge.to === audioInput(item.id)).map((edge) => name(edge.from))
    const targets = edges.filter((edge) => edge.from === audioOutput(item.id)).map((edge) => name(edge.to))
    for (const { port } of props.boundaryAudio ?? []) {
      if (port.itemId !== item.id || port.parameterId !== 'audio') continue
      if (port.direction === 'input') sources.push(`Parent / ${port.name}`)
      else targets.push(`Parent / ${port.name}`)
    }
    return `${isAudioSource(item) ? 'Source' : (sources.join(', ') || 'No audio input')} → ${targets.join(', ') || 'No audio output'}`
  } catch (error) {
    if (error instanceof AudioRouteError) return error.message
    throw error
  }
})
const settingPaths = computed(() => {
  const item = props.draft
  const prefix = item.type === 'instrument-pad'
    ? `setting:${item.type}:${item.settings.instrumentType}:` : `setting:${item.type}:`
  return new Map(captureSettings(item).map((setting) => {
    const name = setting.id.slice(prefix.length)
    const path = item.type === 'instrument-pad' && name !== 'mode'
      ? `settings.instrumentParams.${name}` : `settings.${name}`
    return [path, setting] as const
  }))
})
const liveItem = computed(() => {
  const item = props.draft
  const cache = new WeakMap<object, object>()
  function wrap<T extends object>(target: T, path: string[]): T {
    const cached = cache.get(target)
    if (cached) return cached as T
    const proxy = new Proxy(target, {
      get(object, key) {
        const value: unknown = Reflect.get(object, key)
        if (typeof key !== 'string' || key.startsWith('__v_')) return value
        const nextPath = [...path, key]
        if (nextPath[0] !== 'settings') return value
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) return wrap(value, nextPath)
        if (!settingPaths.value.has(nextPath.join('.'))) return value
        const display = props.displayItem
        if (!display || display.id !== item.id || display.type !== item.type ||
          (item.type === 'instrument-pad' && display.type === 'instrument-pad' &&
            item.settings.instrumentType !== display.settings.instrumentType)) return value
        let current: unknown = display
        for (const part of nextPath) {
          if (current === null || typeof current !== 'object') return value
          current = Reflect.get(current, part)
        }
        return current
      },
      set(object, key, value) {
        const previous: unknown = Reflect.get(object, key)
        const displayed: unknown = Reflect.get(proxy, key)
        const changed = Reflect.set(object, key, value)
        if (changed && typeof key === 'string' && Object.is(previous, value) && !Object.is(displayed, value)) {
          const setting = settingPaths.value.get([...path, key].join('.'))
          if (setting) emit('settingChange', setting)
        }
        return changed
      },
    })
    cache.set(target, proxy)
    return proxy
  }
  return wrap(item, [])
})
let lastLabel = props.draft.label
let suppressRecording = false
provide(settingGestureKey, (active) => emit('settingActivity', active))
watch(() => props.draft.label, (label) => {
  if (label.trim()) lastLabel = label.trim()
}, { flush: 'sync' })
watch(() => captureSettings(props.draft), (next, previous) => {
  if (suppressRecording) return
  const before = new Map(previous.map((setting) => [setting.id, setting.value]))
  for (const setting of next) {
    const old = before.get(setting.id)
    if (old !== undefined && old !== setting.value) emit('settingChange', setting)
  }
}, { flush: 'sync' })

function connectionsCompatible(item: GridItem) {
  const items = props.layout.items.map((entry) => entry.id === item.id ? item : entry)
  return selectorRoutingCompatible(props.rootLayout ?? props.layout, { layout: props.layout, items }) &&
    (props.ownerSettings?.exposedPorts ?? []).filter((port) => port.itemId === item.id).every((port) =>
    (port.direction === 'input' ? inputs(item) : outputs(item))
      .some((parameter) => parameter.id === port.parameterId && parameter.kind === (port.kind === 'numeric' ? 'number' : port.kind))) &&
    props.layout.connections.every((connection) => {
    const source = items.find((entry) => entry.id === connection.sourceId)
    const target = items.find((entry) => entry.id === connection.targetId)
    return !!source && !!target && isCompatible(source, connection.sourceParameter, target, connection.targetParameter) &&
      selectorConnectionsCompatible(items, props.layout.connections, connection)
  })
}

function audioRoutesCompatible(item: GridItem) {
  try {
    validateAudioRoutes(props.rootLayout ?? props.layout,
      { layout: props.layout, items: props.layout.items.map((entry) => entry.id === item.id ? item : entry) })
    return true
  } catch (error) {
    if (!(error instanceof AudioRouteError)) throw error
    message.value = error.message
    return false
  }
}

function changeType(event: Event) {
  const target = event.target
  const item = props.draft
  if (!(target instanceof HTMLSelectElement) || target.value === item.type) return
  const type = target.value as GridItemType
  const replacement = createControl(item.id, item.x, item.y, type)
  if (!connectionsCompatible(replacement)) {
    target.value = item.type
    message.value = 'Remove incompatible wires or exposed ports before changing the control type.'
    return
  }
  if (!audioRoutesCompatible(replacement)) {
    target.value = item.type
    return
  }
  message.value = ''
  emit('changeType', type)
}

function changeAudioRoute(field: 'audioFrom' | 'audioTo' | 'routeMode', event: Event) {
  const item = props.draft
  const target = event.target
  if (item.type !== 'tone-element' || !(target instanceof HTMLSelectElement)) return
  if (props.nested && (target.value === 'main-pre-fx' || target.value === 'main-post-fx' || target.value === 'main-out')) {
    target.value = item.settings[field]
    message.value = 'SubGrid audio must route through its enclosing control.'
    return
  }
  const choices: Record<typeof field, readonly string[]> = {
    audioFrom: ['auto', 'wires', 'bank-pre-fx', 'bank-post-fx', 'main-pre-fx', 'main-post-fx'],
    audioTo: ['auto', 'wires', 'bank-out', 'main-out'],
    routeMode: ['insert', 'parallel'],
  }
  if (!choices[field].includes(target.value)) {
    target.value = item.settings[field]
    return
  }
  const settings: ToneElementSettings = { ...item.settings, [field]: target.value }
  const replacement: GridItem = { ...item, settings }
  if (!audioRoutesCompatible(replacement)) {
    target.value = item.settings[field]
    return
  }
  Object.assign(item.settings, { [field]: target.value })
  message.value = ''
}

function changeInstrumentType(type: InstrumentType) {
  const item = props.draft
  if (item.type !== 'instrument-pad' || item.settings.instrumentType === type) return
  const params = InstrumentFactory.getDefaultParams(type)
  const replacement: GridItem = { ...item, settings: { ...item.settings, instrumentType: type, instrumentParams: params } }
  if (!connectionsCompatible(replacement)) {
    message.value = 'Remove incompatible wires or exposed ports before changing the instrument type.'
    return
  }
  suppressRecording = true
  try {
    item.settings.instrumentParams = params
    item.settings.instrumentType = type
  } finally {
    suppressRecording = false
  }
  message.value = ''
}

const toneElementLabels: Record<ToneElementKind, string> = {
  oscillator: 'Oscillator', noise: 'Noise', filter: 'Filter', gain: 'Gain',
  delay: 'Delay', reverb: 'Reverb', envelope: 'Envelope', mixer: 'Mixer',
}

function changeToneElementType(event: Event) {
  const item = props.draft
  const target = event.target
  if (item.type !== 'tone-element' || !(target instanceof HTMLSelectElement)) return
  const type = (Object.keys(toneElementLabels) as ToneElementKind[]).find((key) => key === target.value)
  if (!type || type === item.settings.elementType) return
  const replacement: GridItem = { ...item, settings: { ...item.settings, elementType: type } }
  if (!connectionsCompatible(replacement)) {
    target.value = item.settings.elementType
    message.value = 'Remove incompatible wires or exposed ports before changing the element.'
    return
  }
  if (!audioRoutesCompatible(replacement)) {
    target.value = item.settings.elementType
    return
  }
  if (item.label === toneElementLabels[item.settings.elementType]) item.label = toneElementLabels[type]
  item.settings.elementType = type
  if (type === 'noise' && item.settings.noteMode === 'always-on') item.settings.noteMode = 'gated'
  lastLabel = item.label
  message.value = ''
}

function saveItem() {
  const item = props.draft
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  if (sampleLoading.value) {
    message.value = 'Wait for the sample to finish loading.'
    return
  }
  item.label = item.label.trim() || lastLabel
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
  if (item.type === 'sequenced-loop') {
    const s = item.settings
    if (!Number.isSafeInteger(s.barLength) || s.barLength < 1 || s.barLength > 64 ||
      !Number.isSafeInteger(s.clipIndex) || s.clipIndex < 0 || s.clipIndex > MAX_LOOP_CLIP_INDEX) {
      message.value = `Use a whole bar length from 1 to 64 and clip index from 0 to ${MAX_LOOP_CLIP_INDEX}.`
      return
    }
    s.clips[String(s.clipIndex)] ??= []
    s.automation[String(s.clipIndex)] ??= []
    for (const notes of Object.values(s.clips)) for (const note of notes) {
      note.position %= s.barLength * 4
      note.duration = Math.min(note.duration, s.barLength * 4)
    }
    for (const events of Object.values(s.automation)) for (const event of events) event.position %= s.barLength * 4
  }
  if (item.type === 'instrument-pad' && item.settings.instrumentType === 'sample-hit' &&
    (!Number.isSafeInteger(item.settings.instrumentParams.polyphony) ||
      item.settings.instrumentParams.polyphony < 1 || item.settings.instrumentParams.polyphony > 16)) {
    message.value = 'Polyphony must be a whole number from 1 to 16.'
    return
  }
  if (!connectionsCompatible(item)) {
    message.value = 'Remove incompatible wires or exposed ports before changing the control type.'
    return
  }
  message.value = ''
  emit('save', item)
  return true
}

function openSubGrid() {
  const id = props.draft.id
  if (saveItem()) emit('openSubGrid', id)
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
</script>

<template>
  <SettingsDialog title="Control settings" @close="saveItem">
    <template #header-actions>
      <InstrumentPad v-if="liveItem.type === 'instrument-pad'" :key="liveItem.settings.instrumentType" class="preview-pad" label="Play"
        :settings="{ ...liveItem.settings, mode: 'trigger' }" :notes="[]" :disabled="sampleLoading" />
    </template>
    <form class="settings-form control-settings" @submit.prevent="saveItem">
      <ControlIdentitySettingsComponent ref="controlIdentity" :draft="draft" :layout="layout" :columns="layout.columns" :rows="layout.rows"
        :control-types="controlTypes" @change-type="changeType" />

      <section v-if="draft.type !== 'pad' && draft.type !== 'output-selector'" class="control-parameters">
        <template v-if="liveItem.type === 'instrument-pad'">
          <InstrumentPadSettingsPanel :draft="liveItem" @loading-change="sampleLoading = $event" @change-instrument="changeInstrumentType" />
        </template>
        <KnobSettingsPanel v-else-if="liveItem.type === 'knob' && draft.type === 'knob'" :draft="liveItem" :base-draft="draft"
          @default-value-change="liveItem.settings.defaultValue = $event; if (newControl) liveItem.settings.value = $event" />
        <LFOSettingsPanel v-else-if="liveItem.type === 'lfo'" :draft="liveItem">
          <template #preview>
            <LFO label="Preview" :settings="liveItem.settings" :bpm="bpm" />
          </template>
        </LFOSettingsPanel>
        <ModWheelSettingsPanel v-else-if="liveItem.type === 'mod-wheel'" :draft="liveItem" />
        <PianoRollSettingsPanel v-else-if="liveItem.type === 'piano-roll' && draft.type === 'piano-roll'" :draft="liveItem" :base-draft="draft" />
        <ArpeggiatorSettingsPanel v-else-if="liveItem.type === 'arpeggiator'" :draft="liveItem" />
        <SequencedLoopSettingsPanel v-else-if="draft.type === 'sequenced-loop'" :draft="draft" :layout="layout" :banks="banks" :bank-id="bankId"
          :playhead="loopPlayhead" @arm-change="emit('armChange', $event)" />
        <template v-else-if="liveItem.type === 'sub-grid'">
          <h3>SubGrid</h3>
          <p>{{ liveItem.settings.layout.columns }} × {{ liveItem.settings.layout.rows }} nested grid · {{ liveItem.settings.layout.items.length }} controls</p>
          <div class="settings-actions"><button type="button" @click="openSubGrid">Open SubGrid</button></div>
          <label>Exposed ports
            <input :value="liveItem.settings.exposedPorts.map((port) => port.name).join(', ')"
              readonly aria-label="Exposed SubGrid ports">
          </label>
        </template>
        <template v-else-if="liveItem.type === 'tone-element'">
          <h3>Tone.js element</h3>
          <label>Element
            <select :value="draft.type === 'tone-element' ? draft.settings.elementType : liveItem.settings.elementType" @change="changeToneElementType">
              <option value="oscillator">Oscillator</option>
              <option value="noise">Noise</option>
              <option value="filter">Filter</option>
              <option value="gain">Gain</option>
              <option value="delay">Delay</option>
              <option value="reverb">Reverb</option>
              <option value="envelope">Envelope</option>
              <option value="mixer">Mixer</option>
            </select>
          </label>
          <template v-if="liveItem.settings.elementType === 'oscillator'">
            <label>Waveform
              <select v-model="liveItem.settings.oscillatorType">
                <option value="sine">Sine</option>
                <option value="triangle">Triangle</option>
                <option value="square">Square</option>
                <option value="sawtooth">Sawtooth</option>
              </select>
            </label>
            <NumericSetting v-model="liveItem.settings.frequency" label="Frequency (Hz)" :min="20" :max="20000" :step="1" />
            <NumericSetting v-model="liveItem.settings.detune" label="Detune (cents)" :min="-1200" :max="1200" :step="1" />
            <template v-if="liveItem.settings.noteMode !== 'always-on'">
              <NumericSetting v-model="liveItem.settings.attack" label="Attack (s)" :min="0.001" :max="5" :step="0.001" />
              <NumericSetting v-model="liveItem.settings.release" label="Release (s)" :min="0.01" :max="10" :step="0.01" />
            </template>
            <label>Mode
              <select v-model="liveItem.settings.noteMode">
                <option value="gated">Gated oscillator</option>
                <option value="continuous">Continuous oscillator</option>
                <option value="always-on">Always on</option>
              </select>
            </label>
            <NumericSetting v-model="liveItem.settings.polyphony" label="Polyphony" :min="1" :max="16" integer />
            <label>Note priority
              <select v-model="liveItem.settings.notePriority">
                <option value="last">Last note</option>
                <option value="highest">Highest note</option>
                <option value="lowest">Lowest note</option>
              </select>
            </label>
          </template>
          <template v-else-if="liveItem.settings.elementType === 'noise'">
            <label>Noise type
              <select v-model="liveItem.settings.noiseType">
                <option value="white">White</option>
                <option value="pink">Pink</option>
                <option value="brown">Brown</option>
              </select>
            </label>
            <NumericSetting v-model="liveItem.settings.gain" label="Gain" :min="0" :max="2" :step="0.01" />
            <label>Mode
              <select v-model="liveItem.settings.noteMode">
                <option value="gated">Gated noise</option>
                <option value="continuous">Continuous noise</option>
              </select>
            </label>
          </template>
          <template v-else-if="liveItem.settings.elementType === 'filter'">
            <NumericSetting v-model="liveItem.settings.cutoff" label="Filter cutoff (Hz)" :min="20" :max="20000" :step="1" />
            <NumericSetting v-model="liveItem.settings.gain" label="Resonance" :min="0" :max="2" :step="0.01" />
          </template>
          <template v-else-if="liveItem.settings.elementType === 'gain'">
            <NumericSetting v-model="liveItem.settings.gain" label="Gain" :min="0" :max="2" :step="0.01" />
          </template>
          <template v-else-if="liveItem.settings.elementType === 'delay'">
            <NumericSetting v-model="liveItem.settings.delayTime" label="Delay time (s)" :min="0" :max="5" :step="0.01" />
            <NumericSetting v-model="liveItem.settings.feedback" label="Feedback" :min="0" :max="1" :step="0.01" />
            <NumericSetting v-model="liveItem.settings.gain" label="Wet level" :min="0" :max="1" :step="0.01" />
          </template>
          <template v-else-if="liveItem.settings.elementType === 'reverb'">
            <NumericSetting v-model="liveItem.settings.decay" label="Decay (s)" :min="0.01" :max="10" :step="0.01" />
            <NumericSetting v-model="liveItem.settings.gain" label="Wet level" :min="0" :max="1" :step="0.01" />
          </template>
          <template v-else-if="liveItem.settings.elementType === 'envelope'">
            <label class="inline-checkbox"><input :checked="liveItem.settings.showVisualizer !== false" type="checkbox"
              @change="liveItem.settings.showVisualizer = ($event.target as HTMLInputElement).checked" /> Show envelope visualizer</label>
            <label class="inline-checkbox"><input :checked="liveItem.settings.showKnobs !== false" type="checkbox"
              @change="liveItem.settings.showKnobs = ($event.target as HTMLInputElement).checked" /> Show envelope knobs</label>
            <ADSREnvelopeEditor title="Envelope" :envelope="liveItem.settings" :color="liveItem.settings.color" :attack-max="5" :decay-min="0.01" :decay-max="10" />
          </template>
          <template v-else-if="liveItem.settings.elementType === 'mixer'">
            <NumericSetting v-model="liveItem.settings.gain" label="Master level" :min="0" :max="2" :step="0.01" />
          </template>
          <label v-if="liveItem.settings.elementType !== 'oscillator' && liveItem.settings.elementType !== 'noise'">Audio source
            <select :value="liveItem.settings.audioFrom" @change="changeAudioRoute('audioFrom', $event)">
              <option value="auto">Automatic (wire or bank)</option>
              <option value="wires">Wires</option>
              <option value="bank-pre-fx">Bank pre-FX</option>
              <option value="bank-post-fx">Bank post-FX</option>
              <option v-if="!nested" value="main-pre-fx">Main pre-FX</option>
              <option v-if="!nested" value="main-post-fx">Main post-FX</option>
            </select>
          </label>
          <label>Audio destination
            <select :value="liveItem.settings.audioTo" @change="changeAudioRoute('audioTo', $event)">
              <option value="auto">Automatic (wire or bank)</option>
              <option value="wires">Wires</option>
              <option value="bank-out">Bank output</option>
              <option v-if="!nested" value="main-out">Main output</option>
            </select>
          </label>
          <label v-if="liveItem.settings.elementType !== 'oscillator' && liveItem.settings.elementType !== 'noise'">Route mode
            <select :value="liveItem.settings.routeMode" @change="changeAudioRoute('routeMode', $event)">
              <option value="insert">Insert</option>
              <option value="parallel">Parallel send</option>
            </select>
          </label>
          <p>Automatic routing uses connected audio wires, or the enclosing grid when unwired. Unwired inserts run in creation order.</p>
          <p>Effective route: {{ effectiveAudioRoute }}</p>
          <p v-if="liveItem.settings.elementType === 'oscillator'">Frequency modulation is added to played pitches; note priority determines which voices are used.</p>
          <p v-if="liveItem.settings.elementType === 'envelope'">Wire notes to open the envelope.</p>
        </template>
      </section>

      <div v-if="selectedId && layout.connections.some((connection) => connection.sourceId === selectedId || connection.targetId === selectedId)" class="control-parameters settings-section">
        <h3>Connections</h3>
        <div v-for="connection in layout.connections.filter((entry) => entry.sourceId === selectedId || entry.targetId === selectedId)" :key="connection.id" class="wire-entry">
          <div class="wire-entry-heading">
            <span class="wire-entry-label">{{ connectionLabel(connection) }}</span>
            <ConnectionMapping v-if="canSetModulationAmount(connection)" :layout="layout" :connection="connection"
              :label="connectionLabel(connection)" @error="message = $event" />
            <button type="button" class="wire-button" :aria-label="`Remove wire: ${connectionLabel(connection)}`"
              title="Remove wire" @click="emit('removeWire', connection)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>
            </button>
          </div>
        </div>
      </div>

      <p v-if="message" class="grid-message" role="alert">{{ message }}</p>
      <div class="settings-actions">
        <button v-if="selectedId" type="button" class="remove-button" @click="emit('remove')">Remove</button>
      </div>
    </form>
  </SettingsDialog>
</template>
