<script setup lang="ts">
import type { GridItem } from '../../../grid'
import ADSREnvelopeEditor from '../../UI/ADSREnvelopeEditor.vue'
import NumericSetting from '../../UI/NumericSetting.vue'
import SampleEditor from './SampleEditor.vue'
import type { SampleHitParams } from '../../../instruments/types'

defineProps<{ draft: Extract<GridItem, { type: 'instrument-pad' }> }>()
const emit = defineEmits<{ 'loading-change': [loading: boolean] }>()
</script>

<template>
  <div v-if="draft.settings.instrumentType === 'sample-hit'" class="settings-section">
    <h3>Sample Hit Parameters</h3>
    <SampleEditor :params="draft.settings.instrumentParams as SampleHitParams" @loading-change="emit('loading-change', $event)" />
    <label v-if="draft.settings.instrumentParams.playback === 'loop'">Loop mode
      <select v-model="draft.settings.instrumentParams.loopMode">
        <option value="loop">Loop</option>
        <option value="back-and-forth">Back and forth</option>
      </select>
    </label>
    <label class="inline-checkbox"><input v-model="draft.settings.instrumentParams.reverse" type="checkbox" /> Reverse playback</label>
    <NumericSetting v-model.number="draft.settings.instrumentParams.polyphony" label="Polyphony (voices)" :min="1" :max="16" :step="1" integer />
    <p v-if="draft.settings.instrumentParams.loopMode !== 'once' && draft.settings.instrumentParams.envelope.sustain === 0" class="loop-hint">
      Increase envelope sustain to hear the loop while holding the pad.
    </p>
    <NumericSetting v-model.number="draft.settings.instrumentParams.volume" label="Volume (dB)" :min="-48" :max="0" :step="1" />
    <NumericSetting v-model.number="draft.settings.instrumentParams.pitch" label="Transpose (semitones)" :min="-12" :max="12" :step="0.1" />
    <ADSREnvelopeEditor title="Amplitude Envelope" :envelope="draft.settings.instrumentParams.envelope" />
  </div>
</template>

<style scoped>
.loop-hint { color: #bbb; font-size: 12px; }
</style>
