<script setup lang="ts">
import type { GridItem } from '../../grid'
import ADSREnvelopeEditor from '../ADSREnvelopeEditor.vue'
import NumericSetting from '../NumericSetting.vue'
import SampleEditor from '../SampleEditor.vue'
import type { SampleLoopParams } from '../../instruments/types'

defineProps<{ draft: Extract<GridItem, { type: 'instrument-pad' }> }>()
const emit = defineEmits<{ 'loading-change': [loading: boolean] }>()
</script>

<template>
  <div v-if="draft.settings.instrumentType === 'sample-loop'" class="settings-section">
    <h3>Sample Loop Parameters</h3>
    <SampleEditor :params="draft.settings.instrumentParams as SampleLoopParams" @loading-change="emit('loading-change', $event)" />
    <NumericSetting v-model.number="draft.settings.instrumentParams.volume" label="Volume (dB)" :min="-48" :max="0" :step="1" />
    <NumericSetting v-model.number="draft.settings.instrumentParams.pitch" label="Transpose (semitones)" :min="-12" :max="12" :step="0.1" />
    <ADSREnvelopeEditor title="Amplitude Envelope" :envelope="draft.settings.instrumentParams.envelope" />
  </div>
</template>
