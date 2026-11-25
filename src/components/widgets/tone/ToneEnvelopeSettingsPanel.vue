<script setup lang="ts">
import type { ToneElementSettings } from '../../../grid'
import ADSREnvelopeEditor from '../../UI/ADSREnvelopeEditor.vue'

defineProps<{ settings: ToneElementSettings }>()
</script>

<template>
  <label class="inline-checkbox"><input :checked="settings.showVisualizer !== false" type="checkbox"
    @change="settings.showVisualizer = ($event.target as HTMLInputElement).checked" /> Show envelope visualizer</label>
  <label class="inline-checkbox"><input :checked="settings.showKnobs !== false" type="checkbox"
    @change="settings.showKnobs = ($event.target as HTMLInputElement).checked" /> Show envelope knobs</label>
  <ADSREnvelopeEditor title="Envelope" :envelope="settings" :color="settings.color" :attack-max="5" :decay-min="0.01" :decay-max="10" />
</template>
