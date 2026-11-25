<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import * as Tone from 'tone'
import type { HeldNote, ToneElementSettings } from '../../../grid'

const props = defineProps<{ label: string; settings: ToneElementSettings; notes: HeldNote[]; audioOutput?: Tone.InputNode }>()
const continuous = ref(false)
const error = ref('')
let noise: Tone.Noise | undefined
let gain: Tone.Gain | undefined
let generation = 0
let disposed = false

function sync() {
  const active = props.notes.length > 0 || (props.settings.noteMode === 'continuous' && continuous.value)
  if (!active) {
    generation++
    gain?.gain.rampTo(0, 0.02)
    return
  }
  if (noise && gain) {
    noise.type = props.settings.noiseType
    const velocity = props.notes.length ? props.notes[props.notes.length - 1]!.velocity / 127 : 0.7
    gain.gain.rampTo(props.settings.gain * velocity, 0.02)
    return
  }
  const request = ++generation
  void (async () => {
    try {
      await Tone.start()
      if (disposed || request !== generation) return
      gain = new Tone.Gain(0)
      if (props.audioOutput) gain.connect(props.audioOutput)
      else gain.toDestination()
      noise = new Tone.Noise({ type: props.settings.noiseType, volume: -12 }).connect(gain).start()
      sync()
      error.value = ''
    } catch (cause) {
      if (disposed || request !== generation) return
      noise?.dispose()
      gain?.dispose()
      noise = undefined
      gain = undefined
      error.value = `Noise audio error: ${cause instanceof Error ? cause.message : String(cause)}`
      console.error(error.value, cause)
    }
  })()
}

watch(() => props.settings.noteMode, (mode) => {
  if (mode !== 'continuous') continuous.value = false
}, { flush: 'sync' })
watch(() => [props.settings.noiseType, props.settings.gain, props.settings.noteMode, continuous.value,
  props.notes.map((note) => `${note.note}:${note.count}:${note.velocity}`).join(',')], sync,
{ immediate: true, flush: 'sync' })
onBeforeUnmount(() => {
  disposed = true
  generation++
  noise?.dispose()
  gain?.dispose()
})
</script>

<template>
  <div class="tone-element-control" :style="{ '--tone-color': settings.color }">
    <strong>{{ label }}</strong>
    <small>Noise</small>
    <button v-if="settings.noteMode === 'continuous'" type="button" :aria-pressed="continuous"
      @click="continuous = !continuous">{{ continuous ? 'Stop' : 'Start' }}</button>
    <small v-if="error" role="alert">{{ error }}</small>
  </div>
</template>
