<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import * as Tone from 'tone'
import type { HeldNote, InstrumentPadSettings, ParameterOutput, RepeatDivision } from '../../../grid'
import type { TransportClock } from '../../../sequencedLoop'
import { Bass303, DrumKit, InstrumentFactory, SampleHit, SampleLoop, type InstrumentInstance } from '../../../instruments'
import type { SampleHitParams, SampleLoopParams } from '../../../instruments/types'
import MPCPad from '../MPCPad.vue'

const props = defineProps<{ label: string; settings: InstrumentPadSettings; notes: HeldNote[]; loopNotes?: HeldNote[]; rotated?: boolean; repeatDivision?: RepeatDivision; bpm?: number; playing?: boolean; transportClock?: TransportClock; disabled?: boolean; audioOutput?: Tone.InputNode; audioUnavailable?: boolean }>()
const emit = defineEmits<{ output: [output: ParameterOutput]; liveNote: [note: number, on: boolean, velocity: number, bend?: number] }>()
const error = ref('')
const inputsMuted = ref(false)
let instrument: InstrumentInstance | undefined
let localPressed = false
let localVelocity = 100
let currentKey = ''
let generation = 0
let unmounted = false
const appliedParameters = new Map<string, number | string>()
const hitNotes = new Map<string, { note: number; velocity: number; bend: number }>()

function incomingNotes() {
  const merged = new Map<number, HeldNote>()
  for (const note of inputsMuted.value ? [] : [...props.notes, ...(props.loopNotes ?? [])]) {
    const previous = merged.get(note.note)
    merged.set(note.note, { ...note, count: note.count + (previous?.count ?? 0) })
  }
  return [...merged.values()].sort((a, b) => a.note - b.note)
}

function incomingBend() {
  const notes = incomingNotes()
  return notes[notes.length - 1]?.bend ?? 0
}

function syncParameters() {
  const params = props.settings.muted ? { ...props.settings.instrumentParams, volume: -Infinity } : props.settings.instrumentParams
  if (instrument instanceof SampleHit || instrument instanceof SampleLoop) {
    if (instrument.params.sample !== props.settings.instrumentParams.sample) {
      generation++
      instrument.dispose()
      instrument = undefined
      currentKey = ''
      hitNotes.clear()
      syncNote()
    } else if (instrument instanceof SampleHit) {
      instrument.updateParameters(params as SampleHitParams)
    } else {
      instrument.updateParameters(params as SampleLoopParams)
    }
    return
  }
  if (!(instrument instanceof Bass303) && !(instrument instanceof DrumKit)) return
  for (const [key, value] of Object.entries(params)) {
    const values = typeof value === 'object' && value !== null
      ? Object.entries(value).map(([field, entry]) => [`${key}.${field}`, entry] as const)
      : [[key, value] as const]
    for (const [name, entry] of values) {
      if (appliedParameters.get(name) === entry) continue
      if (typeof entry === 'number' && (Number.isFinite(entry) || (name === 'volume' && entry === -Infinity))) instrument.updateParameter(name, entry)
      else if (instrument instanceof DrumKit && name === 'drum' && typeof entry === 'string') instrument.updateParameter(name, entry)
      else continue
      appliedParameters.set(name, entry)
    }
  }
}

function syncNote() {
  if (props.audioUnavailable) {
    generation++
    instrument?.release()
    currentKey = ''
    return
  }
  if (props.settings.instrumentType === 'sample-hit' && props.settings.instrumentParams.polyphony > 1) {
    syncHitNotes()
    return
  }
  const notes = incomingNotes()
  const wired = notes[notes.length - 1]
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
      instrument ??= InstrumentFactory.create(props.settings.instrumentType, props.settings.instrumentParams, props.audioOutput)
      syncParameters()
      instrument.setPitchBend?.(localPressed ? 0 : incomingBend())
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

function syncHitNotes() {
  const next = new Map<string, { note: number; velocity: number; bend: number }>(incomingNotes().map((note) =>
    [`note:${note.note}`, { note: note.note, velocity: note.velocity, bend: note.bend ?? 0 }] as const))
  if (localPressed) next.set('local', { note: 60, velocity: localVelocity, bend: 0 })
  for (const id of hitNotes.keys()) {
    if (next.has(id)) continue
    hitNotes.delete(id)
    if (instrument instanceof SampleHit) instrument.release(id)
  }
  for (const [id, note] of next) {
    const previous = hitNotes.get(id)
    if (previous) {
      if (previous.bend !== note.bend && instrument instanceof SampleHit) instrument.setVoicePitchBend(id, note.bend)
      previous.bend = note.bend
      continue
    }
    hitNotes.set(id, note)
    const request = generation
    void (async () => {
      try {
        await Tone.start()
        if (unmounted || request !== generation || hitNotes.get(id) !== note) return
        instrument ??= InstrumentFactory.create('sample-hit', props.settings.instrumentParams, props.audioOutput)
        if (!(instrument instanceof SampleHit)) return
        syncParameters()
        if (!(instrument instanceof SampleHit) || hitNotes.get(id) !== note) return
        await instrument.trigger(note.velocity, note.note, id, note.bend)
        if (!unmounted && request === generation) error.value = ''
      } catch (cause) {
        if (!unmounted && request === generation) {
          error.value = `Audio error: ${cause instanceof Error ? cause.message : String(cause)}`
          console.error(error.value, cause)
        }
      }
    })()
  }
}

function handlePadOutput(output: ParameterOutput) {
  emit('output', output)
  if (output.parameter === 'velocity') localVelocity = output.value
  if (output.parameter === 'gate') {
    if (props.settings.mode === 'toggle') {
      if (output.value > 0) {
        inputsMuted.value = !inputsMuted.value
        syncNote()
      }
      return
    }
    const pressed = output.value > 0
    if (pressed !== localPressed) emit('liveNote', 60, pressed, localVelocity)
    localPressed = pressed
    syncNote()
  }
}

watch(() => props.settings.mode, (mode, previous) => {
  if (previous === undefined || mode === previous) return
  if (previous === 'trigger' && localPressed) {
    localPressed = false
    emit('liveNote', 60, false, localVelocity)
  }
  inputsMuted.value = false
  syncNote()
})
watch(() => props.notes.map((note) => `${note.note}:${note.count}:${note.velocity}:${note.bend ?? 0}`).join(','),
  syncNote, { immediate: true, flush: 'sync' })
watch(() => (props.loopNotes ?? []).map((note) => `${note.note}:${note.count}:${note.velocity}:${note.bend ?? 0}`).join(','),
  syncNote, { flush: 'sync' })
watch(() => localPressed ? 0 : incomingBend(),
  (bend) => {
    if (!(instrument instanceof SampleHit) || props.settings.instrumentParams.polyphony === 1) instrument?.setPitchBend?.(bend)
  })
watch(() => props.settings.instrumentParams, syncParameters, { deep: true, immediate: true })
watch(() => props.settings.muted, syncParameters, { flush: 'sync' })
watch(() => props.audioUnavailable, syncNote, { flush: 'sync' })
onBeforeUnmount(() => {
  if (localPressed && props.settings.mode === 'trigger') emit('liveNote', 60, false, localVelocity)
  unmounted = true
  generation++
  instrument?.dispose()
})
</script>

<template>
  <div class="instrument-pad">
    <MPCPad :label="label" :settings="settings" :rotated="rotated" :disabled="disabled" :wired-active="!inputsMuted && (notes.length > 0 || (loopNotes?.length ?? 0) > 0)"
      :repeat-division="settings.mode === 'trigger' ? repeatDivision : undefined" :bpm="bpm" :playing="playing" :transport-clock="transportClock"
      :input-muted="settings.mode === 'toggle' ? inputsMuted : undefined" @output="handlePadOutput" />
    <span v-if="error" class="instrument-error" role="alert">{{ error }}</span>
  </div>
</template>

<style scoped>
.instrument-pad { width: 100%; height: 100%; min-width: 0; min-height: 0; position: relative; }
.instrument-error { position: absolute; inset: auto 0 0; padding: 4px; background: #422; color: #fff; font-size: 11px; }
</style>
