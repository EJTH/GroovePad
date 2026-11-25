<script setup lang="ts">
import type { GridItem } from '../../../grid'
import NumericSetting from '../../UI/NumericSetting.vue'
import ToneOscillatorSettingsPanel from './ToneOscillatorSettingsPanel.vue'
import ToneNoiseSettingsPanel from './ToneNoiseSettingsPanel.vue'
import ToneEnvelopeSettingsPanel from './ToneEnvelopeSettingsPanel.vue'

defineProps<{
  liveItem: Extract<GridItem, { type: 'tone-element' }>
  draft: GridItem
  nested?: boolean
  effectiveAudioRoute: string
}>()
const emit = defineEmits<{
  changeType: [event: Event]
  changeAudioRoute: [field: 'audioFrom' | 'audioTo' | 'routeMode', event: Event]
}>()
</script>

<template>
<h3>Tone.js element</h3>
<label>Element
  <select :value="draft.type === 'tone-element' ? draft.settings.elementType : liveItem.settings.elementType" @change="emit('changeType', $event)">
    <option value="oscillator">Oscillator</option>
    <option value="noise">Noise</option>
    <option value="filter">Filter</option>
    <option value="gain">Gain</option>
    <option value="delay">Delay</option>
    <option value="reverb">Reverb</option>
    <option value="envelope">Envelope</option>
    <option value="mixer">Mixer</option>
  </select>
</label>
<ToneOscillatorSettingsPanel v-if="liveItem.settings.elementType === 'oscillator'" :settings="liveItem.settings" />
<ToneNoiseSettingsPanel v-else-if="liveItem.settings.elementType === 'noise'" :settings="liveItem.settings" />
<template v-else-if="liveItem.settings.elementType === 'filter'">
  <NumericSetting v-model="liveItem.settings.cutoff" label="Filter cutoff (Hz)" :min="20" :max="20000" :step="1" />
  <NumericSetting v-model="liveItem.settings.gain" label="Resonance" :min="0" :max="2" :step="0.01" />
</template>
<template v-else-if="liveItem.settings.elementType === 'gain'">
  <NumericSetting v-model="liveItem.settings.gain" label="Gain" :min="0" :max="2" :step="0.01" />
</template>
<template v-else-if="liveItem.settings.elementType === 'delay'">
  <NumericSetting v-model="liveItem.settings.delayTime" label="Delay time (s)" :min="0" :max="5" :step="0.01" />
  <NumericSetting v-model="liveItem.settings.feedback" label="Feedback" :min="0" :max="1" :step="0.01" />
  <NumericSetting v-model="liveItem.settings.gain" label="Wet level" :min="0" :max="1" :step="0.01" />
</template>
<template v-else-if="liveItem.settings.elementType === 'reverb'">
  <NumericSetting v-model="liveItem.settings.decay" label="Decay (s)" :min="0.01" :max="10" :step="0.01" />
  <NumericSetting v-model="liveItem.settings.gain" label="Wet level" :min="0" :max="1" :step="0.01" />
</template>
<ToneEnvelopeSettingsPanel v-else-if="liveItem.settings.elementType === 'envelope'" :settings="liveItem.settings" />
<template v-else-if="liveItem.settings.elementType === 'mixer'">
  <NumericSetting v-model="liveItem.settings.gain" label="Master level" :min="0" :max="2" :step="0.01" />
</template>
<label v-if="liveItem.settings.elementType !== 'oscillator' && liveItem.settings.elementType !== 'noise'">Audio source
  <select :value="liveItem.settings.audioFrom" @change="emit('changeAudioRoute', 'audioFrom', $event)">
    <option value="auto">Automatic (wire or bank)</option>
    <option value="wires">Wires</option>
    <option value="bank-pre-fx">Bank pre-FX</option>
    <option value="bank-post-fx">Bank post-FX</option>
    <option v-if="!nested" value="main-pre-fx">Main pre-FX</option>
    <option v-if="!nested" value="main-post-fx">Main post-FX</option>
  </select>
</label>
<label>Audio destination
  <select :value="liveItem.settings.audioTo" @change="emit('changeAudioRoute', 'audioTo', $event)">
    <option value="auto">Automatic (wire or bank)</option>
    <option value="wires">Wires</option>
    <option value="bank-out">Bank output</option>
    <option v-if="!nested" value="main-out">Main output</option>
  </select>
</label>
<label v-if="liveItem.settings.elementType !== 'oscillator' && liveItem.settings.elementType !== 'noise'">Route mode
  <select :value="liveItem.settings.routeMode" @change="emit('changeAudioRoute', 'routeMode', $event)">
    <option value="insert">Insert</option>
    <option value="parallel">Parallel send</option>
  </select>
</label>
<p>Automatic routing uses connected audio wires, or the enclosing grid when unwired. Unwired inserts run in creation order.</p>
<p>Effective route: {{ effectiveAudioRoute }}</p>
<p v-if="liveItem.settings.elementType === 'oscillator'">Frequency modulation is added to played pitches; note priority determines which voices are used.</p>
<p v-if="liveItem.settings.elementType === 'envelope'">Wire notes to open the envelope.</p>
</template>
