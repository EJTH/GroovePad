<script setup lang="ts">
import type { ToneElementSettings } from '../../../grid'
import NumericSetting from '../../UI/NumericSetting.vue'

defineProps<{ settings: ToneElementSettings }>()
</script>

<template>
  <label>Waveform
    <select v-model="settings.oscillatorType">
      <option value="sine">Sine</option>
      <option value="triangle">Triangle</option>
      <option value="square">Square</option>
      <option value="sawtooth">Sawtooth</option>
    </select>
  </label>
  <NumericSetting v-model="settings.frequency" label="Frequency (Hz)" :min="20" :max="20000" :step="1" />
  <NumericSetting v-model="settings.detune" label="Detune (cents)" :min="-1200" :max="1200" :step="1" />
  <template v-if="settings.noteMode !== 'always-on'">
    <NumericSetting v-model="settings.attack" label="Attack (s)" :min="0.001" :max="5" :step="0.001" />
    <NumericSetting v-model="settings.release" label="Release (s)" :min="0.01" :max="10" :step="0.01" />
  </template>
  <label>Mode
    <select v-model="settings.noteMode">
      <option value="gated">Gated oscillator</option>
      <option value="continuous">Continuous oscillator</option>
      <option value="always-on">Always on</option>
    </select>
  </label>
  <NumericSetting v-model="settings.polyphony" label="Polyphony" :min="1" :max="16" integer />
  <label>Note priority
    <select v-model="settings.notePriority">
      <option value="last">Last note</option>
      <option value="highest">Highest note</option>
      <option value="lowest">Lowest note</option>
    </select>
  </label>
</template>
