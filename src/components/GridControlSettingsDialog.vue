<script setup lang="ts">
import { onBeforeUnmount, ref, watch, computed } from 'vue'
import * as Tone from 'tone'
import { isValidPlacement, MAX_LOOP_CLIP_INDEX, validPianoRollSettings, type Connection, type GridItem, type GridItemType, type GridLayout, type ParameterOutput } from '../grid'
import { isCompatible, inputs, outputs, selectorConnectionsCompatible } from '../parameters'
import { InstrumentFactory, type InstrumentInstance } from '../instruments'
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
import MPCPad from './MPCPad.vue'
import LFO from './LFO.vue'
import { controlTypes } from './gridControlTypes'
import type { Bank } from '../project'

const props = defineProps<{
  draft: GridItem
  selectedId: string | null
  layout: GridLayout
  bpm: number
  message: string
  banks?: Bank[]
  bankId?: string
}>()
const emit = defineEmits<{
  close: []
  save: [item: GridItem]
  remove: []
  removeWire: [connection: Connection]
  changeType: [type: GridItemType]
  'update:message': [message: string]
}>()

const controlIdentity = ref<InstanceType<typeof ControlIdentitySettings> | null>(null)
const sampleLoading = ref(false)
const message = computed({
  get: () => props.message,
  set: (value: string) => emit('update:message', value),
})
let preview: InstrumentInstance | undefined
let previewGeneration = 0
let previewVelocity = 100

function stopPreview() {
  previewGeneration++
  preview?.dispose()
  preview = undefined
}

async function previewInstrument(velocity: number) {
  const item = props.draft
  if (item.type !== 'instrument-pad') return
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

function changeType(event: Event) {
  const target = event.target
  const item = props.draft
  if (!(target instanceof HTMLSelectElement) || target.value === item.type) return
  emit('changeType', target.value as GridItemType)
}

watch(() => props.draft.type === 'instrument-pad'
  ? [props.draft.settings.instrumentType, props.draft.settings.instrumentParams] : null,
stopPreview, { deep: true, flush: 'sync' })
onBeforeUnmount(stopPreview)

function saveItem() {
  const item = props.draft
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
  if (props.selectedId && props.layout.connections.some((connection) => {
    const source = connection.sourceId === item.id ? item : props.layout.items.find((entry) => entry.id === connection.sourceId)
    const target = connection.targetId === item.id ? item : props.layout.items.find((entry) => entry.id === connection.targetId)
    const items = props.layout.items.map((entry) => entry.id === item.id ? item : entry)
    return !source || !target || !isCompatible(source, connection.sourceParameter, target, connection.targetParameter) ||
      !selectorConnectionsCompatible(items, props.layout.connections, connection)
  })) {
    message.value = 'Remove incompatible wires before changing the control type.'
    return
  }
  message.value = ''
  emit('save', { ...item, label: item.label.trim() })
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
  <SettingsDialog title="Control settings" :showSaveButton="true" @close="emit('close')" @save="saveItem">
    <template #header-actions>
      <MPCPad v-if="draft.type === 'instrument-pad'" class="preview-pad" label="Play"
        :settings="draft.settings" @output="handlePreviewOutput" />
    </template>
    <form class="settings-form control-settings" @submit.prevent="saveItem">
      <ControlIdentitySettingsComponent ref="controlIdentity" :draft="draft" :columns="layout.columns" :rows="layout.rows"
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
        <SequencedLoopSettingsPanel v-else-if="draft.type === 'sequenced-loop'" :draft="draft" :layout="layout" :banks="banks" :bank-id="bankId" />
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
