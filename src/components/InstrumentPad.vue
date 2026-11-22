<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import * as Tone from 'tone'
import type { HeldNote, InstrumentPadSettings, ParameterOutput } from '../grid'
import { Bass303, InstrumentFactory, type InstrumentInstance } from '../instruments'
import MPCPad from './MPCPad.vue'

const props = defineProps<{ label: string; settings: InstrumentPadSettings; notes: HeldNote[] }>()
const emit = defineEmits<{ output: [output: ParameterOutput] }>()
const error = ref('')
let instrument: InstrumentInstance | undefined
let localPressed = false
let localVelocity = 100
let currentKey = ''
let generation = 0
let unmounted = false
let sampleParameters = ''
const appliedParameters = new Map<string, number>()

function syncParameters() {
  if (!(instrument instanceof Bass303)) return
  for (const [key, value] of Object.entries(props.settings.instrumentParams)) {
    const values = typeof value === 'object' && value !== null
      ? Object.entries(value).map(([field, entry]) => [`${key}.${field}`, entry] as const)
      : [[key, value] as const]
    for (const [name, entry] of values) {
      if (typeof entry !== 'number' || !Number.isFinite(entry) || appliedParameters.get(name) === entry) continue
      instrument.updateParameter(name, entry)
      appliedParameters.set(name, entry)
    }
  }
}

function syncNote() {
  const wired = props.notes[props.notes.length - 1]
  const key = localPressed ? 'local' : wired ? `note:${wired.note}` : ''
  if (key === currentKey) return
  currentKey = key
  const request = ++generation
  instrument?.release()
  if (!key) return
  const note = localPressed ? 60 : wired!.note
  const velocity = localPressed ? localVelocity : wired!.velocity

  void (async () => {
    try {
      await Tone.start()
      if (unmounted || request !== generation) return
      instrument ??= InstrumentFactory.create(props.settings.instrumentType, props.settings.instrumentParams)
      syncParameters()
      await instrument.trigger(velocity, note)
      if (!unmounted && request === generation) error.value = ''
    } catch (cause) {
      if (!unmounted && request === generation) {
        error.value = `Audio error: ${cause instanceof Error ? cause.message : String(cause)}`
        console.error(error.value, cause)
      }
    }
  })()
}

function handlePadOutput(output: ParameterOutput) {
  emit('output', output)
  if (output.parameter === 'velocity') localVelocity = output.value
  if (output.parameter === 'gate') {
    localPressed = output.value > 0
    syncNote()
  }
}

watch(() => props.notes.map((note) => `${note.note}:${note.count}:${note.velocity}`).join(','), syncNote, { immediate: true })
watch(() => props.settings.instrumentParams, () => {
  if (props.settings.instrumentType === 'sample-hit' || props.settings.instrumentType === 'sample-loop') {
    const snapshot = JSON.stringify(props.settings.instrumentParams)
    if (sampleParameters && snapshot !== sampleParameters && instrument) {
      generation++
      instrument.dispose()
      instrument = undefined
      currentKey = ''
      syncNote()
    }
    sampleParameters = snapshot
  } else syncParameters()
}, { deep: true, immediate: true })
onBeforeUnmount(() => {
  unmounted = true
  generation++
  instrument?.dispose()
})
</script>

<template>
  <div class="instrument-pad">
    <MPCPad :label="label" :settings="settings" :wired-active="notes.length > 0" @output="handlePadOutput" />
    <span v-if="error" class="instrument-error" role="alert">{{ error }}</span>
  </div>
</template>

<style scoped>
.instrument-pad { width: 100%; height: 100%; min-width: 0; min-height: 0; position: relative; }
.instrument-error { position: absolute; inset: auto 0 0; padding: 4px; background: #422; color: #fff; font-size: 11px; }
</style>
