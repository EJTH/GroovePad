<script setup lang="ts">
import { ref } from 'vue'
import SettingsDialog from './SettingsDialog.vue'

const props = defineProps<{ bpm: number }>()
const emit = defineEmits<{ close: []; save: [bpm: number] }>()
const draft = ref(props.bpm)
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
  emit('save', draft.value)
}
</script>

<template>
  <SettingsDialog title="Project settings" @close="emit('close')">
    <form class="settings-form bank-form" @submit.prevent="saveTempo">
      <label>Tempo (BPM) <input v-model.number="draft" type="number" min="1" max="300" step="any" required @input="taps = []; error = ''"></label>
      <div class="settings-actions"><button type="button" @click="tapTempo">Tap</button></div>
      <p v-if="error" class="grid-message" role="alert">{{ error }}</p>
      <div class="settings-actions"><button type="submit">Save tempo</button></div>
    </form>
  </SettingsDialog>
</template>
