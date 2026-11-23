<script setup lang="ts">
import { ref } from 'vue'
import { MAX_INFO_SCROLL_SPEED, MIN_INFO_SCROLL_SPEED } from '../project'
import SettingsDialog from './SettingsDialog.vue'

const props = defineProps<{ bpm: number; infoText: string; infoScrollSpeed: number }>()
const emit = defineEmits<{ close: []; save: [bpm: number, infoText: string, infoScrollSpeed: number] }>()
const draft = ref(props.bpm)
const infoDraft = ref(props.infoText)
const speedDraft = ref(props.infoScrollSpeed)
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
    draft.value = Math.round(60000 * (taps.length - 1) / (now - taps[0]!) * 100) / 100
  }
  error.value = ''
}

function saveTempo() {
  if (!Number.isFinite(draft.value) || draft.value < 1 || draft.value > 300) {
    error.value = 'Tempo must be between 1 and 300 BPM.'
    return
  }
  if (!Number.isFinite(speedDraft.value) || speedDraft.value < MIN_INFO_SCROLL_SPEED || speedDraft.value > MAX_INFO_SCROLL_SPEED) {
    error.value = `Info scroll speed must be between ${MIN_INFO_SCROLL_SPEED} and ${MAX_INFO_SCROLL_SPEED} pixels per second.`
    return
  }
  emit('save', draft.value, infoDraft.value, speedDraft.value)
}
</script>

<template>
  <SettingsDialog title="Project settings" @close="emit('close')">
    <form class="settings-form bank-form" @submit.prevent="saveTempo">
      <label>Tempo (BPM) <input v-model.number="draft" type="number" min="1" max="300" step="any" required @input="taps = []; error = ''"></label>
      <div class="settings-actions"><button type="button" @click="tapTempo">Tap</button></div>
      <label>Info text <input v-model="infoDraft" type="text"></label>
      <label>Info scroll speed (pixels per second)
        <input v-model.number="speedDraft" type="number" :min="MIN_INFO_SCROLL_SPEED" :max="MAX_INFO_SCROLL_SPEED" step="any" required>
      </label>
      <p v-if="error" class="grid-message" role="alert">{{ error }}</p>
      <div class="settings-actions"><button type="submit">Save settings</button></div>
    </form>
  </SettingsDialog>
</template>
