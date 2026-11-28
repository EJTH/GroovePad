<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import * as Tone from 'tone'
import type { HeldNote, InstrumentPadSettings, ParameterOutput, RepeatDivision } from '../../../grid'
import type { TransportClock } from '../../../sequencedLoop'
import { Bass303, DrumKit, InstrumentFactory, SampleHit, SampleLoop, type InstrumentInstance } from '../../../instruments'
import type { SampleHitParams, SampleLoopParams } from '../../../instruments/types'
import MPCPad from '../MPCPad.vue'

const props = defineProps<{ label: string; settings: InstrumentPadSettings; rotated?: boolean; repeatDivision?: RepeatDivision; bpm?: number; playing?: boolean; transportClock?: TransportClock; disabled?: boolean; audioOutput?: Tone.InputNode; audioUnavailable?: boolean;
  filterFrequencySignal?: Tone.Signal; setFilterFrequency?: (value: number) => void }>()
const emit = defineEmits<{ output: [output: ParameterOutput]; liveNote: [note: number, on: boolean, velocity: number, bend?: number]; choke: [group: number] }>()
const error = ref('')
interface PadWidget {
  setRepeatDivision(division?: RepeatDivision): void
  setWiredActive(active: boolean): void
  setInputMuted(muted?: boolean): void
}
let inputsMuted = false
let currentSettings = props.settings
let incomingWiredNotes: HeldNote[] = []
let incomingLoopNotes: HeldNote[] = []
let padWidget: PadWidget | null = null
let instrument: InstrumentInstance | undefined
let localPressed = false
let localVelocity = 100
let currentKey = ''
let generation = 0
let unmounted = false
let preparedInstrument: InstrumentInstance | undefined
let preparingInstrument: InstrumentInstance | undefined
let failedPreparation: InstrumentInstance | undefined
let preparationError = ''
const appliedParameters = new Map<string, number | string>()
const hitNotes = new Map<string, { note: number; velocity: number; bend: number }>()

function incomingNotes() {
  const merged = new Map<number, HeldNote>()
  for (const note of inputsMuted ? [] : [...incomingWiredNotes, ...incomingLoopNotes]) {
    const previous = merged.get(note.note)
    merged.set(note.note, { ...note, count: note.count + (previous?.count ?? 0) })
  }
  return [...merged.values()].sort((a, b) => a.note - b.note)
}

function incomingBend() {
  const notes = incomingNotes()
  return notes[notes.length - 1]?.bend ?? 0
}

function effectiveInstrumentParams() {
  return currentSettings.muted ? { ...currentSettings.instrumentParams, volume: -Infinity } : currentSettings.instrumentParams
}

function syncParameters() {
  const params = effectiveInstrumentParams()
  if (instrument instanceof SampleHit || instrument instanceof SampleLoop) {
    if (instrument.params.sample !== currentSettings.instrumentParams.sample) {
      generation++
      instrument.dispose()
      instrument = undefined
      preparedInstrument = undefined
      failedPreparation = undefined
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
      if (typeof entry === 'number' && (Number.isFinite(entry) || (name === 'volume' && entry === -Infinity))) {
        instrument.updateParameter(name, entry)
        if (instrument instanceof Bass303 && name === 'filterFrequency') props.setFilterFrequency?.(entry)
      }
      else if (instrument instanceof DrumKit && name === 'drum' && typeof entry === 'string') instrument.updateParameter(name, entry)
      else continue
      appliedParameters.set(name, entry)
    }
  }
}

function prepareSample() {
  if (!props.playing || props.audioUnavailable ||
    (currentSettings.instrumentType !== 'sample-hit' && currentSettings.instrumentType !== 'sample-loop')) return
  const sample = currentSettings.instrumentParams.sample
  if (typeof sample !== 'string' || !sample) return
  try {
    instrument ??= InstrumentFactory.create(currentSettings.instrumentType, effectiveInstrumentParams(), props.audioOutput)
    const candidate = instrument
    if (!(candidate instanceof SampleHit || candidate instanceof SampleLoop) ||
      candidate === preparedInstrument || candidate === preparingInstrument || candidate === failedPreparation) return
    preparingInstrument = candidate
    void candidate.prepare().then(() => {
      if (unmounted || instrument !== candidate) return
      preparedInstrument = candidate
      if (error.value === preparationError) error.value = ''
      preparationError = ''
    }).catch((cause: unknown) => {
      if (unmounted || instrument !== candidate) return
      failedPreparation = candidate
      preparationError = `Audio error: ${cause instanceof Error ? cause.message : String(cause)}`
      error.value = preparationError
      console.error(preparationError, cause)
    }).finally(() => {
      if (preparingInstrument === candidate) preparingInstrument = undefined
    })
  } catch (cause) {
    preparationError = `Audio error: ${cause instanceof Error ? cause.message : String(cause)}`
    error.value = preparationError
    console.error(preparationError, cause)
  }
}

function syncNote(time = Tone.immediate()) {
  if (props.audioUnavailable) {
    generation++
    instrument?.release(undefined, time)
    currentKey = ''
    hitNotes.clear()
    return
  }
  if (currentSettings.instrumentType === 'sample-hit' && currentSettings.instrumentParams.polyphony > 1) {
    syncHitNotes(time)
    return
  }
  const notes = incomingNotes()
  const wired = notes[notes.length - 1]
  const key = localPressed ? 'local' : wired ? `note:${wired.note}` : ''
  if (key === currentKey) {
    if (!localPressed && (!(instrument instanceof SampleHit) || currentSettings.instrumentParams.polyphony === 1)) {
      instrument?.setPitchBend?.(incomingBend(), time)
    }
    return
  }
  if (key && currentSettings.chokeGroup !== undefined) emit('choke', currentSettings.chokeGroup)
  currentKey = key
  const request = ++generation
  instrument?.release(undefined, time)
  if (!key) return
  const note = localPressed ? 60 : wired!.note
  const velocity = localPressed ? localVelocity : wired!.velocity
  const bend = localPressed ? 0 : incomingBend()
  const reportError = (cause: unknown) => {
    if (!unmounted && request === generation) {
      error.value = `Audio error: ${cause instanceof Error ? cause.message : String(cause)}`
      console.error(error.value, cause)
    }
  }
  const trigger = () => {
    if (unmounted || request !== generation) return
    try {
      instrument ??= InstrumentFactory.create(currentSettings.instrumentType, effectiveInstrumentParams(), props.audioOutput)
      if (instrument instanceof Bass303 && props.filterFrequencySignal) instrument.setFilterFrequencySignal(props.filterFrequencySignal)
      syncParameters()
      instrument.setPitchBend?.(bend, time)
      const result = instrument.trigger(velocity, note, time)
      void Promise.resolve(result).then(() => {
        if (!unmounted && request === generation) error.value = ''
      }).catch(reportError)
    } catch (cause) {
      reportError(cause)
    }
  }
  if (Tone.getContext().state === 'running') trigger()
  else void Tone.start().then(trigger).catch(reportError)
}

function syncHitNotes(time = Tone.immediate()) {
  const next = new Map<string, { note: number; velocity: number; bend: number }>()
  for (const note of incomingNotes()) for (let index = 0; index < note.count; index++) {
    next.set(`note:${note.note}:${index}`, { note: note.note, velocity: note.velocity, bend: note.bend ?? 0 })
  }
  if (localPressed) next.set('local', { note: 60, velocity: localVelocity, bend: 0 })
  let emittedChoke = false
  for (const id of hitNotes.keys()) {
    if (next.has(id)) continue
    hitNotes.delete(id)
    if (instrument instanceof SampleHit) instrument.release(id, time)
  }
  for (const [id, note] of next) {
    const previous = hitNotes.get(id)
    if (previous) {
      if (previous.bend !== note.bend && instrument instanceof SampleHit) instrument.setVoicePitchBend(id, note.bend, time)
      previous.bend = note.bend
      continue
    }
    if (!emittedChoke && currentSettings.chokeGroup !== undefined) {
      emit('choke', currentSettings.chokeGroup)
      emittedChoke = true
    }
    hitNotes.set(id, note)
    const request = generation
    const trigger = () => {
      try {
        if (unmounted || request !== generation || hitNotes.get(id) !== note) return
        instrument ??= InstrumentFactory.create('sample-hit', effectiveInstrumentParams(), props.audioOutput)
        if (!(instrument instanceof SampleHit)) return
        syncParameters()
        if (!(instrument instanceof SampleHit) || hitNotes.get(id) !== note) return
        void instrument.trigger(note.velocity, note.note, time, id, note.bend).then(() => {
          if (!unmounted && request === generation) error.value = ''
        }).catch(reportError)
      } catch (cause) {
        reportError(cause)
      }
    }
    const reportError = (cause: unknown) => {
      if (!unmounted && request === generation) {
        error.value = `Audio error: ${cause instanceof Error ? cause.message : String(cause)}`
        console.error(error.value, cause)
      }
    }
    if (Tone.getContext().state === 'running') trigger()
    else void Tone.start().then(trigger).catch(reportError)
  }
}

function choke(time = Tone.immediate()) {
  generation++
  if (instrument instanceof SampleHit || instrument instanceof SampleLoop) {
    instrument.choke(time)
  } else if (instrument instanceof DrumKit) {
    instrument.dispose()
    instrument = undefined
    appliedParameters.clear()
  } else {
    instrument?.release(undefined, time)
  }
}

function handlePadOutput(output: ParameterOutput) {
  emit('output', output)
  if (output.parameter === 'velocity') localVelocity = output.value
  if (output.parameter === 'gate') {
    if (currentSettings.mode === 'toggle') {
      if (output.value > 0) {
        inputsMuted = !inputsMuted
        syncPadDisplay()
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

function updateMode(mode: InstrumentPadSettings['mode'], previous: InstrumentPadSettings['mode']) {
  if (mode === previous) return
  if (previous === 'trigger' && localPressed) {
    localPressed = false
    emit('liveNote', 60, false, localVelocity)
  }
  inputsMuted = false
  padWidget?.setRepeatDivision(mode === 'trigger' ? props.repeatDivision : undefined)
  syncPadDisplay()
  syncNote()
}

function syncPadDisplay() {
  padWidget?.setWiredActive(!inputsMuted && (incomingWiredNotes.length > 0 || incomingLoopNotes.length > 0))
  padWidget?.setInputMuted(currentSettings.mode === 'toggle' ? inputsMuted : undefined)
}
function isPadWidget(instance: unknown): instance is PadWidget {
  return typeof instance === 'object' && instance !== null && 'setRepeatDivision' in instance &&
    typeof instance.setRepeatDivision === 'function' && 'setWiredActive' in instance &&
    typeof instance.setWiredActive === 'function' && 'setInputMuted' in instance &&
    typeof instance.setInputMuted === 'function'
}
function setPadWidget(instance: unknown) {
  padWidget = isPadWidget(instance) ? instance : null
  padWidget?.setRepeatDivision(currentSettings.mode === 'trigger' ? props.repeatDivision : undefined)
  syncPadDisplay()
}
function setPlaybackNotes(notes: HeldNote[], loopNotes: HeldNote[], time = Tone.immediate()) {
  const sameNotes = (current: HeldNote[], next: HeldNote[]) =>
    current.length === next.length && current.every((note, index) => {
      const candidate = next[index]
      return candidate && candidate.note === note.note && candidate.count === note.count &&
        candidate.velocity === note.velocity && candidate.bend === note.bend
    })
  if (sameNotes(incomingWiredNotes, notes) && sameNotes(incomingLoopNotes, loopNotes)) return
  incomingWiredNotes = notes
  incomingLoopNotes = loopNotes
  syncPadDisplay()
  syncNote(time)
}
function setDisplaySettings(settings: InstrumentPadSettings) {
  const previous = currentSettings
  if (settings === previous) return
  currentSettings = settings
  updateMode(settings.mode, previous.mode)
  syncParameters()
  syncNote()
  prepareSample()
}
watch(() => props.settings.mode, (mode, previous) => {
  if (currentSettings === props.settings) updateMode(mode, previous)
})
watch(() => props.settings.instrumentParams, () => {
  if (currentSettings === props.settings) { syncParameters(); prepareSample() }
}, { deep: true, immediate: true })
watch(() => props.settings.muted, () => {
  if (currentSettings === props.settings) syncParameters()
}, { flush: 'sync' })
watch(() => props.repeatDivision, (division) => {
  padWidget?.setRepeatDivision(currentSettings.mode === 'trigger' ? division : undefined)
})
watch(() => props.audioUnavailable, () => syncNote(), { flush: 'sync' })
watch([() => props.playing, () => props.audioUnavailable], ([playing]) => {
  if (!playing) failedPreparation = undefined
  else prepareSample()
}, { immediate: true })
onBeforeUnmount(() => {
  if (localPressed && currentSettings.mode === 'trigger') emit('liveNote', 60, false, localVelocity)
  unmounted = true
  generation++
  instrument?.dispose()
})
defineExpose({ setPlaybackNotes, setDisplaySettings, choke })
</script>

<template>
  <div class="instrument-pad">
    <MPCPad :ref="setPadWidget" :label="label" :settings="settings" :rotated="rotated" :disabled="disabled"
      :bpm="bpm" :playing="playing" :transport-clock="transportClock"
      @output="handlePadOutput" />
    <span v-if="error" class="instrument-error" role="alert">{{ error }}</span>
  </div>
</template>

<style scoped>
.instrument-pad { width: 100%; height: 100%; min-width: 0; min-height: 0; position: relative; }
.instrument-error { position: absolute; inset: auto 0 0; padding: 4px; background: #422; color: #fff; font-size: 11px; }
</style>
