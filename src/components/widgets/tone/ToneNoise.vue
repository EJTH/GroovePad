<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import * as Tone from 'tone'
import type { HeldNote, ToneElementSettings } from '../../../grid'

const props = defineProps<{ label: string; settings: ToneElementSettings; notes: HeldNote[]; audioTime?: number; audioOutput?: Tone.InputNode; muted: boolean }>()
const emit = defineEmits<{ toggleMute: [] }>()
const continuous = ref(false)
const error = ref('')
let noise: Tone.Noise | undefined
let gain: Tone.Gain | undefined
let generation = 0
let disposed = false
let playbackNotes = props.notes

function sync(notes = playbackNotes, time = Tone.immediate()) {
  const active = notes.length > 0 || (props.settings.noteMode === 'continuous' && continuous.value)
  if (!active) {
    generation++
    gain?.gain.rampTo(0, 0.02, time)
    return
  }
  if (noise && gain) {
    noise.type = props.settings.noiseType
    const velocity = notes.length ? notes[notes.length - 1]!.velocity / 127 : 0.7
    gain.gain.rampTo(props.settings.gain * velocity, 0.02, time)
    return
  }
  const request = ++generation
  const reportError = (cause: unknown) => {
    if (disposed || request !== generation) return
    noise?.dispose()
    gain?.dispose()
    noise = undefined
    gain = undefined
    error.value = `Noise audio error: ${cause instanceof Error ? cause.message : String(cause)}`
    console.error(error.value, cause)
  }
  const start = () => {
    if (disposed || request !== generation) return
    try {
      gain = new Tone.Gain(0)
      if (props.audioOutput) gain.connect(props.audioOutput)
      else gain.toDestination()
      noise = new Tone.Noise({ type: props.settings.noiseType, volume: -12 }).connect(gain).start()
      sync(notes, time)
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
watch(() => [props.settings.noiseType, props.settings.gain, props.settings.noteMode, continuous.value], () => sync(),
{ immediate: true, flush: 'sync' })
function setPlaybackNotes(notes: HeldNote[], time?: number) {
  if (notes.length === playbackNotes.length && notes.every((note, index) => {
    const previous = playbackNotes[index]
    return previous && previous.note === note.note && previous.count === note.count &&
      previous.velocity === note.velocity
  })) return
  playbackNotes = notes
  sync(notes, time)
}
defineExpose({ setPlaybackNotes })
onBeforeUnmount(() => {
  disposed = true
  generation++
  noise?.dispose()
  gain?.dispose()
})
</script>

<template>
  <component :is="settings.noteMode === 'continuous' ? 'div' : 'button'" class="tone-element-control" :class="{ muted }"
    :type="settings.noteMode === 'continuous' ? undefined : 'button'" :style="{ '--tone-color': settings.color }"
    :aria-label="settings.noteMode === 'continuous' ? undefined : `${muted ? 'Unmute' : 'Mute'} ${label}`"
    :aria-pressed="settings.noteMode === 'continuous' ? undefined : muted"
    @click="settings.noteMode !== 'continuous' && emit('toggleMute')">
    <strong>{{ label }}</strong>
    <small>Noise</small>
    <button v-if="settings.noteMode === 'continuous'" type="button" :aria-pressed="continuous"
      @click="continuous = !continuous">{{ continuous ? 'Stop' : 'Start' }}</button>
    <button v-if="muted && settings.noteMode === 'continuous'" type="button" @click.stop="emit('toggleMute')">Unmute</button>
    <small v-if="error" role="alert">{{ error }}</small>
    <small v-if="muted && settings.noteMode !== 'continuous'">Muted</small>
  </component>
</template>
