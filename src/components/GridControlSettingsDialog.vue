<script setup lang="ts">
import { ref, watch, computed, provide } from 'vue'
import { createControl, isValidPlacement, MAX_LOOP_CLIP_INDEX, validPianoRollSettings, type Connection, type GridItem, type GridItemType, type GridLayout, type SubGridSettings, type ToneElementKind, type ToneElementSettings } from '../grid'
import { isCompatible, inputs, outputs, selectorConnectionsCompatible, selectorRoutingCompatible } from '../parameters'
import { InstrumentFactory } from '../instruments'
import type { InstrumentType } from '../instruments/types'
import type ControlIdentitySettings from './ControlIdentitySettings.vue'
import InstrumentPadSettingsPanel from './widgets/tone/InstrumentPadSettingsPanel.vue'
import KnobSettingsPanel from './widgets/KnobSettingsPanel.vue'
import LFOSettingsPanel from './widgets/LFOSettingsPanel.vue'
import ModWheelSettingsPanel from './widgets/ModWheelSettingsPanel.vue'
import PianoRollSettingsPanel from './widgets/PianoRollSettingsPanel.vue'
import ArpeggiatorSettingsPanel from './widgets/ArpeggiatorSettingsPanel.vue'
import SequencedLoopSettingsPanel from './widgets/SequencedLoopSettingsPanel.vue'
import ToneElementSettingsPanel from './widgets/tone/ToneElementSettingsPanel.vue'
import SubGridSettingsPanel from './widgets/SubGridSettingsPanel.vue'
import ControlIdentitySettingsComponent from './ControlIdentitySettings.vue'
import SettingsDialog from './UI/SettingsDialog.vue'
import ConnectionMapping from './ConnectionMapping.vue'
import InstrumentPad from './widgets/tone/InstrumentPad.vue'
import LFO from './widgets/LFO.vue'
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
        const toneParameter = item.type === 'tone-element' && nextPath.length === 2 &&
          inputs(item).some((input) => input.kind === 'number' && input.id === nextPath[1])
        if (!toneParameter && !settingPaths.value.has(nextPath.join('.'))) return value
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
  item.settings.bypassed = false
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
        :settings="{ ...liveItem.settings, mode: 'trigger' }" :disabled="sampleLoading" />
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
        <SubGridSettingsPanel v-else-if="liveItem.type === 'sub-grid'" :draft="liveItem" @open="openSubGrid" />
        <ToneElementSettingsPanel v-else-if="liveItem.type === 'tone-element'" :live-item="liveItem" :draft="draft"
          :nested="nested" :effective-audio-route="effectiveAudioRoute" @change-type="changeToneElementType" @change-audio-route="changeAudioRoute" />
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
