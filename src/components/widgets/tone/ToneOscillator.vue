<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import * as Tone from 'tone'
import type { HeldNote, ToneElementSettings } from '../../../grid'
import { ToneOscillator } from '../../../audio/toneOscillator'

const props = defineProps<{
  label: string
  settings: ToneElementSettings
  baseFrequency: number
  notes: HeldNote[]
  audioTime?: number
  audioOutput?: Tone.InputNode
  muted: boolean
}>()
const emit = defineEmits<{ toggleMute: [] }>()

const continuous = ref(false)
const error = ref('')
const waitingForAudio = ref(false)
const hasControls = computed(() => props.settings.noteMode === 'continuous' ||
  (props.settings.noteMode === 'always-on' && (waitingForAudio.value || !!error.value)))
let oscillator: ToneOscillator | undefined
let generation = 0
let disposed = false
let playbackNotes = props.notes

function updateOscillator(notes: HeldNote[], playContinuous: boolean, time?: number) {
  if (!oscillator) return
  try {
    oscillator.update(props.settings, props.baseFrequency, notes, playContinuous, time)
    error.value = ''
  } catch (cause) {
    error.value = `Oscillator audio error: ${cause instanceof Error ? cause.message : String(cause)}`
    console.error(error.value, cause)
  }
}

function sync(notes = playbackNotes, time = Tone.immediate()) {
  const playContinuous = props.settings.noteMode === 'always-on' || (props.settings.noteMode === 'continuous' && continuous.value)
  const active = notes.length > 0 || playContinuous
  if (!active) {
    generation++
    waitingForAudio.value = false
    updateOscillator([], false, time)
    return
  }
  if (oscillator) {
    updateOscillator(notes, playContinuous, time)
    return
  }
  const request = ++generation
  waitingForAudio.value = true
  const reportError = (cause: unknown) => {
    if (disposed || request !== generation) return
    waitingForAudio.value = false
    error.value = `Oscillator audio error: ${cause instanceof Error ? cause.message : String(cause)}`
    console.error(error.value, cause)
  }
  const start = () => {
    if (disposed || request !== generation) return
    try {
      oscillator = new ToneOscillator(props.settings, props.audioOutput)
      oscillator.update(props.settings, props.baseFrequency, notes, playContinuous, time)
      waitingForAudio.value = false
      error.value = ''
    } catch (cause) {
      reportError(cause)
    }
  }
  if (Tone.getContext().state === 'running') start()
  else void Tone.start().then(start).catch(reportError)
}

watch(() => props.settings.noteMode, (mode) => {
  if (mode !== 'continuous') continuous.value = false
}, { flush: 'sync' })
watch(() => [props.settings.oscillatorType, props.settings.frequency, props.settings.detune,
  props.settings.attack, props.settings.release, props.settings.noteMode, props.settings.notePriority, props.settings.polyphony,
  props.baseFrequency, continuous.value],
() => sync(), { immediate: true, flush: 'sync' })

function setPlaybackNotes(notes: HeldNote[], time?: number) {
  if (notes.length === playbackNotes.length && notes.every((note, index) => {
    const previous = playbackNotes[index]
    return previous && previous.note === note.note && previous.count === note.count &&
      previous.velocity === note.velocity && previous.bend === note.bend
  })) return
  playbackNotes = notes
  sync(notes, time)
}
defineExpose({ setPlaybackNotes })

onBeforeUnmount(() => {
  disposed = true
  generation++
  oscillator?.dispose()
})
</script>

<template>
  <component :is="hasControls ? 'div' : 'button'" class="tone-element-control" :class="{ muted }"
    :type="hasControls ? undefined : 'button'" :style="{ '--tone-color': settings.color }"
    :aria-label="hasControls ? undefined : `${muted ? 'Unmute' : 'Mute'} ${label}`"
    :aria-pressed="hasControls ? undefined : muted" @click="!hasControls && emit('toggleMute')">
    <strong>{{ label }}</strong>
    <small>{{ settings.noteMode === 'always-on' ? 'Always on' : 'Oscillator' }}</small>
    <button v-if="settings.noteMode === 'always-on' && (waitingForAudio || error)" type="button" @click="sync()">Enable audio</button>
    <button v-else-if="settings.noteMode === 'continuous'" type="button" :aria-pressed="continuous"
      @click="continuous = !continuous">
      {{ continuous ? 'Stop' : 'Start' }}
    </button>
    <button v-if="muted && hasControls" type="button" @click.stop="emit('toggleMute')">Unmute</button>
    <small v-if="error" role="alert">{{ error }}</small>
    <small v-if="muted && !hasControls">Muted</small>
  </component>
</template>
