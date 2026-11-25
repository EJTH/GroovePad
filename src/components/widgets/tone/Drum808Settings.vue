<script setup lang="ts">
import type { GridItem } from '../../../grid'
import ADSREnvelopeEditor from '../../UI/ADSREnvelopeEditor.vue'
import NumericSetting from '../../UI/NumericSetting.vue'

defineProps<{ draft: Extract<GridItem, { type: 'instrument-pad' }> }>()
</script>

<template>
  <div v-if="draft.settings.instrumentType === '808' || draft.settings.instrumentType === '909'" class="settings-section">
    <h3>{{ draft.settings.instrumentType }} Drum Kit Parameters</h3>
    <label>Drum Type
      <select v-model="draft.settings.instrumentParams.drum" required>
        <option value="kick">Kick</option>
        <option value="snare">Snare</option>
        <option value="closed-hat">Closed Hat</option>
        <option value="open-hat">Open Hat</option>
        <option value="rim">Rim</option>
        <option value="tom">Tom</option>
      </select>
    </label>
    <NumericSetting v-model.number="draft.settings.instrumentParams.pitch" label="Pitch" :min="50" :max="300" :step="1" />
    <NumericSetting v-model.number="draft.settings.instrumentParams.volume" label="Volume (dB)" :min="-48" :max="0" :step="1" />
    <NumericSetting v-model.number="draft.settings.instrumentParams.tonality" label="Tonality" :min="0" :max="1" :step="0.1" />
    <NumericSetting v-model.number="draft.settings.instrumentParams.tone" label="Tone" :min="0" :max="1" :step="0.1" />
    <ADSREnvelopeEditor title="Envelope" :envelope="draft.settings.instrumentParams.envelope" />
  </div>
</template>
