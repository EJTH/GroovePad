<script setup lang="ts">
import { ref } from 'vue'
import { MAX_INFO_SCROLL_SPEED, MIN_INFO_SCROLL_SPEED } from '../project'
import { RECORDING_FORMATS, type RecordingFormat } from '../audio/sessionRecording'
import SettingsDialog from './SettingsDialog.vue'

const props = defineProps<{ bpm: number; infoText: string; infoScrollSpeed: number; recordingFormat: RecordingFormat; supportedFormats: RecordingFormat[] }>()
const emit = defineEmits<{ close: []; 'update:bpm': [value: number]; 'update:infoText': [value: string]; 'update:infoScrollSpeed': [value: number]; 'update:recordingFormat': [value: RecordingFormat] }>()
const error = ref('')
let taps: number[] = []

function tapTempo() {
  const now = performance.now()
  const lastTap = taps[taps.length - 1]
  if (lastTap !== undefined && now - lastTap < 200) {
    taps = [now]
    error.value = 'Tap tempo must be between 1 and 300 BPM.'
    return
  }
  if (lastTap !== undefined && now - lastTap > 60000) taps = []
  taps.push(now)
  if (taps.length > 5) taps.shift()
  if (taps.length > 1) {
    emit('update:bpm', Math.round(60000 * (taps.length - 1) / (now - taps[0]!) * 100) / 100)
  }
  error.value = ''
}

function updateNumber(event: Event, field: 'bpm' | 'speed', finish = false) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const min = field === 'bpm' ? 1 : MIN_INFO_SCROLL_SPEED
  const max = field === 'bpm' ? 300 : MAX_INFO_SCROLL_SPEED
  let value = input.valueAsNumber
  if (finish) {
    if (!Number.isFinite(value)) value = field === 'bpm' ? props.bpm : props.infoScrollSpeed
    value = Math.max(min, Math.min(max, value))
    input.value = String(value)
  }
  if (!Number.isFinite(value) || value < min || value > max) return
  if (field === 'bpm') {
    taps = []
    error.value = ''
    emit('update:bpm', value)
  } else emit('update:infoScrollSpeed', value)
}

function close() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  emit('close')
}

function updateRecordingFormat(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  const format = props.supportedFormats.find((item) => item === value)
  if (format) emit('update:recordingFormat', format)
}
</script>

<template>
  <SettingsDialog title="Project settings" @close="close">
    <form class="settings-form bank-form" @submit.prevent="close">
      <label>Tempo (BPM) <input :value="bpm" type="number" min="1" max="300" step="any" required @input="updateNumber($event, 'bpm')" @blur="updateNumber($event, 'bpm', true)"></label>
      <div class="settings-actions"><button type="button" @click="tapTempo">Tap</button></div>
      <label>Info text <input :value="infoText" type="text" @input="emit('update:infoText', ($event.target as HTMLInputElement).value)"></label>
      <label>Info scroll speed (pixels per second)
        <input :value="infoScrollSpeed" type="number" :min="MIN_INFO_SCROLL_SPEED" :max="MAX_INFO_SCROLL_SPEED" step="any" required @input="updateNumber($event, 'speed')" @blur="updateNumber($event, 'speed', true)">
      </label>
      <label>Session recording format
        <select :value="recordingFormat" :disabled="!supportedFormats.length" @change="updateRecordingFormat">
          <option v-if="!supportedFormats.includes(recordingFormat)" :value="recordingFormat" disabled>{{ recordingFormat.toUpperCase() }} (not supported in this browser)</option>
          <option v-for="format in RECORDING_FORMATS.filter((item) => supportedFormats.includes(item.id))" :key="format.id" :value="format.id">{{ format.label }}</option>
        </select>
      </label>
      <p v-if="!supportedFormats.includes(recordingFormat)" class="grid-message" role="status">Choose a supported recording format before recording.</p>
      <p v-if="error" class="grid-message" role="alert">{{ error }}</p>
    </form>
  </SettingsDialog>
</template>
