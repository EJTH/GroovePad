<script setup lang="ts">
import type { GridItem } from '../grid'
import { validPianoRollSettings } from '../grid'
import { PIANO_ROOT_NOTES } from '../music'
import NumericSetting from './NumericSetting.vue'
import PianoRoll from './PianoRoll.vue'

defineProps<{ draft: Extract<GridItem, { type: 'piano-roll' }> }>()
</script>

<template>
  <div class="settings-section">
    <h3>Piano Roll Settings</h3>
    <div class="piano-root-scale">
      <label>Root note
        <select v-model="draft.settings.rootNote">
          <option v-for="note in PIANO_ROOT_NOTES" :key="note" :value="note">{{ note }}</option>
        </select>
      </label>
      <label>Scale
        <select v-model="draft.settings.scale">
          <option value="chromatic">Chromatic</option><option value="major">Major</option>
          <option value="minor">Minor</option>
          <option value="dorian">Dorian</option><option value="phrygian">Phrygian</option>
          <option value="lydian">Lydian</option><option value="mixolydian">Mixolydian</option>
          <option value="locrian">Locrian</option>
          <option value="major-pentatonic">Major Pentatonic</option>
          <option value="minor-pentatonic">Minor Pentatonic</option><option value="blues">Blues</option>
        </select>
      </label>
    </div>
    <NumericSetting v-model="draft.settings.octaves" label="Octaves per row" :min="1" :max="3" />
    <NumericSetting v-model="draft.settings.numRows" label="Number of rows" :min="1" :max="8" />
    <NumericSetting v-model="draft.settings.octaveTranspose" label="Octave transpose" :min="-3" :max="3" :step="1" />
    <label>Keyboard layout <select v-model="draft.settings.orientation"><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select></label>
    <label>Style <select v-model="draft.settings.style"><option value="pads">Pads</option><option value="whites-blacks">Whites & Blacks</option><option value="glide-strip">Glide strip</option></select></label>
    <label>Pressure mode <select v-model="draft.settings.pressureMode"><option value="position">Position on key</option><option value="pressure">Pressure sensing (position fallback)</option></select></label>
    <div class="piano-preview">
      <PianoRoll v-if="validPianoRollSettings(draft.settings)" label="Piano roll preview" :settings="draft.settings" />
      <p v-else>Use a valid octave and row count that keeps the note range within MIDI notes 0 to 127.</p>
    </div>
  </div>
</template>

<style scoped>
.piano-root-scale { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.piano-root-scale label { min-width: 0; }
</style>
