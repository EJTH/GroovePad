<script setup lang="ts">
import { watch } from 'vue'
import type { GridItem } from '../grid'
import { validPianoRollSettings } from '../grid'
import { PIANO_ROOT_NOTES } from '../music'
import NumericSetting from './NumericSetting.vue'
import PianoRoll from './PianoRoll.vue'

const props = defineProps<{
  draft: Extract<GridItem, { type: 'piano-roll' }>
  baseDraft?: Extract<GridItem, { type: 'piano-roll' }>
}>()
let normalizing = false

watch(() => {
  const settings = (props.baseDraft ?? props.draft).settings
  return [settings.octaves, settings.numRows, settings.octaveTranspose, settings.rootNote, settings.scale, settings.style] as const
}, (values, previous) => {
  const settings = (props.baseDraft ?? props.draft).settings
  if (normalizing || validPianoRollSettings(settings)) return
  const changed = values.findIndex((value, index) => value !== previous[index])
  const candidates = Array.from({ length: 8 }, (_, row) => row + 1)
    .flatMap((numRows) => Array.from({ length: 3 }, (_, octave) => octave + 1)
      .flatMap((octaves) => Array.from({ length: 7 }, (_, transpose) => ({ numRows, octaves, octaveTranspose: transpose - 3 }))))
  function distance(candidate: { octaves: number; numRows: number; octaveTranspose: number }) {
    return Math.abs(settings.octaves - candidate.octaves) * (changed === 0 ? 100 : 1) +
      Math.abs(settings.numRows - candidate.numRows) * (changed === 1 ? 100 : 1) +
      Math.abs(settings.octaveTranspose - candidate.octaveTranspose) * (changed === 2 ? 100 : 1)
  }
  candidates.sort((a, b) => distance(a) - distance(b))
  const nearest = candidates.find((candidate) => validPianoRollSettings({ ...settings, ...candidate }))
  if (nearest) {
    normalizing = true
    try { Object.assign(settings, nearest) } finally { normalizing = false }
  }
}, { flush: 'sync' })

function setNumber(field: 'octaves' | 'numRows' | 'octaveTranspose', value: number) {
  const settings = props.draft.settings
  const [min, max] = field === 'octaves' ? [1, 3] : field === 'numRows' ? [1, 8] : [-3, 3]
  const candidates = Array.from({ length: max - min + 1 }, (_, index) => min + index)
  candidates.sort((a, b) => Math.abs(a - value) - Math.abs(b - value))
  const nearest = candidates.find((candidate) => validPianoRollSettings({ ...settings, [field]: candidate }))
  if (nearest !== undefined) settings[field] = nearest
}

watch(() => [props.draft.settings.rootNote, props.draft.settings.scale, props.draft.settings.style], () => {
  const settings = props.draft.settings
  if (validPianoRollSettings(settings)) return
  const candidates = Array.from({ length: settings.numRows }, (_, row) => row + 1)
    .flatMap((numRows) => Array.from({ length: settings.octaves }, (_, octave) => ({ numRows, octaves: octave + 1 })))
    .sort((a, b) => (settings.numRows - a.numRows + settings.octaves - a.octaves) -
      (settings.numRows - b.numRows + settings.octaves - b.octaves))
  const nearest = candidates.find((candidate) => validPianoRollSettings({ ...settings, ...candidate }))
  if (nearest) {
    settings.numRows = nearest.numRows
    settings.octaves = nearest.octaves
  }
}, { flush: 'sync' })
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
    <NumericSetting :model-value="draft.settings.octaves" label="Octaves per row" :min="1" :max="3" integer @update:model-value="setNumber('octaves', $event)" />
    <NumericSetting :model-value="draft.settings.numRows" label="Number of rows" :min="1" :max="8" integer @update:model-value="setNumber('numRows', $event)" />
    <NumericSetting :model-value="draft.settings.octaveTranspose" label="Octave transpose" :min="-3" :max="3" :step="1" integer @update:model-value="setNumber('octaveTranspose', $event)" />
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
