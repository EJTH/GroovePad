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
  audioOutput?: Tone.InputNode
  muted: boolean
}>()
const emit = defineEmits<{ toggleMute: [] }>()

const continuous = ref(false)
const error = ref('')
const waitingForAudio = ref(false)
let effectiveSettings = props.settings
const hasControls = computed(() => props.settings.noteMode === 'continuous' ||
  (props.settings.noteMode === 'always-on' && (waitingForAudio.value || !!error.value)))
let oscillator: ToneOscillator | undefined
let generation = 0
let disposed = false

function updateOscillator(notes: HeldNote[], playContinuous: boolean) {
  if (!oscillator) return
  try {
    oscillator.update(effectiveSettings, props.baseFrequency, notes, playContinuous)
    error.value = ''
  } catch (cause) {
    error.value = `Oscillator audio error: ${cause instanceof Error ? cause.message : String(cause)}`
    console.error(error.value, cause)
  }
}

function sync() {
  const playContinuous = effectiveSettings.noteMode === 'always-on' || (effectiveSettings.noteMode === 'continuous' && continuous.value)
  const active = props.notes.length > 0 || playContinuous
  if (!active) {
    generation++
    waitingForAudio.value = false
    updateOscillator([], false)
    return
  }
  if (oscillator) {
    updateOscillator(props.notes, playContinuous)
    return
  }
  const request = ++generation
  waitingForAudio.value = true
  void (async () => {
    try {
      await Tone.start()
      if (disposed || request !== generation) return
      oscillator = new ToneOscillator(effectiveSettings, props.audioOutput)
      oscillator.update(effectiveSettings, props.baseFrequency, props.notes,
        effectiveSettings.noteMode === 'always-on' || (effectiveSettings.noteMode === 'continuous' && continuous.value))
      waitingForAudio.value = false
      error.value = ''
    } catch (cause) {
      if (disposed || request !== generation) return
      waitingForAudio.value = false
      error.value = `Oscillator audio error: ${cause instanceof Error ? cause.message : String(cause)}`
      console.error(error.value, cause)
    }
  })()
}

function setEffectiveSettings(settings: ToneElementSettings) {
  const relevant = ['oscillatorType', 'frequency', 'detune', 'attack', 'release', 'noteMode', 'notePriority', 'polyphony'] as const
  if (relevant.every((key) => effectiveSettings[key] === settings[key])) {
    effectiveSettings = settings
    return
  }
  effectiveSettings = settings
  sync()
}
defineExpose({ setEffectiveSettings })

watch(() => props.settings.noteMode, (mode) => {
  if (mode !== 'continuous') continuous.value = false
}, { flush: 'sync' })
watch(() => props.settings, (settings) => { effectiveSettings = settings; sync() }, { deep: true, flush: 'sync' })
watch(() => [props.settings.oscillatorType, props.settings.frequency, props.settings.detune,
  props.settings.attack, props.settings.release, props.settings.noteMode, props.settings.notePriority, props.settings.polyphony,
  props.baseFrequency, continuous.value,
  props.notes.map((note) => `${note.note}:${note.count}:${note.velocity}:${note.bend ?? 0}`).join(',')],
sync, { immediate: true, flush: 'sync' })

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
    <button v-if="settings.noteMode === 'always-on' && (waitingForAudio || error)" type="button" @click="sync">Enable audio</button>
    <button v-else-if="settings.noteMode === 'continuous'" type="button" :aria-pressed="continuous"
      @click="continuous = !continuous">
      {{ continuous ? 'Stop' : 'Start' }}
    </button>
    <button v-if="muted && hasControls" type="button" @click.stop="emit('toggleMute')">Unmute</button>
    <small v-if="error" role="alert">{{ error }}</small>
    <small v-if="muted && !hasControls">Muted</small>
  </component>
</template>
