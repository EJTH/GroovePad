<script setup lang="ts">
import type { GridItem } from '../../../grid'
import ADSREnvelopeEditor from '../../UI/ADSREnvelopeEditor.vue'
import NumericSetting from '../../UI/NumericSetting.vue'

defineProps<{ draft: Extract<GridItem, { type: 'instrument-pad' }> }>()
</script>

<template>
  <div v-if="draft.settings.instrumentType === '303'" class="settings-section">
    <h3>303 Bass Synth Parameters</h3>
    <NumericSetting v-model.number="draft.settings.instrumentParams.transpose" label="Transpose (semitones)" :min="-36" :max="36" :step="1" />
    <NumericSetting v-model.number="draft.settings.instrumentParams.resonance" label="Resonance" :min="0.1" :max="30" :step="0.1" />
    <NumericSetting v-model.number="draft.settings.instrumentParams.volume" label="Volume (dB)" :min="-48" :max="0" :step="1" />
    <NumericSetting v-model.number="draft.settings.instrumentParams.slideTime" label="Slide Time (s)" :min="0" :max="0.5" :step="0.01" />
    <ADSREnvelopeEditor title="Amplitude Envelope" :envelope="draft.settings.instrumentParams.envelope" />
    <div class="envelope-settings">
      <h4>Filter Envelope</h4>
      <NumericSetting v-model.number="draft.settings.instrumentParams.filterFrequency" label="Filter Frequency (Hz)" :min="50" :max="5000" :step="50" />
      <NumericSetting v-model.number="draft.settings.instrumentParams.filterAmount" label="Filter Amount" :min="0" :max="1" :step="0.1" />
      <ADSREnvelopeEditor title="" :envelope="draft.settings.instrumentParams.filterEnvelope" />
    </div>
  </div>
</template>
