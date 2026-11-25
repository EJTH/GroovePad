<script setup lang="ts">
import type { GridItem } from '../../../grid'
import type { InstrumentType } from '../../../instruments/types'
import SampleHitSettings from './SampleHitSettings.vue'
import SampleLoopSettings from './SampleLoopSettings.vue'
import Bass303Settings from './Bass303Settings.vue'
import Drum808Settings from './Drum808Settings.vue'

const props = defineProps<{ draft: Extract<GridItem, { type: 'instrument-pad' }> }>()
const emit = defineEmits<{ 'loading-change': [loading: boolean]; 'change-instrument': [type: InstrumentType] }>()

const instrumentTypes: { type: InstrumentType; label: string; icon: string }[] = [
  { type: 'sample-hit', label: 'Sample Hit', icon: 'M3 12h3l2-6 3 12 3-9 2 3h5' },
  { type: 'sample-loop', label: 'Sample Loop', icon: 'M4 10a8 8 0 0 1 14-3l2 2 M20 4v5h-5 M20 14a8 8 0 0 1-14 3l-2-2 M4 20v-5h5' },
  { type: '303', label: '303 Bass Synth', icon: 'M3 6h18v12H3z M9 6v12 M15 6v12 M6 6v7 M12 6v7 M18 6v7' },
  { type: '808', label: '808 Drum Kit', icon: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z' },
  { type: '909', label: '909 Drum Kit', icon: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z' },
]

function changeInstrumentType(type: InstrumentType) {
  if (type === props.draft.settings.instrumentType) return
  emit('change-instrument', type)
}
</script>

<template>
  <div class="settings-section">
    <h3>Instrument Pad Settings</h3>
    <label class="pad-mode-setting">
      Pad mode
      <select v-model="draft.settings.mode">
        <option value="trigger">Trigger</option>
        <option value="toggle">Toggle input mute</option>
      </select>
    </label>
    <div class="instrument-types" role="group" aria-label="Instrument type">
      <button v-for="instrument in instrumentTypes" :key="instrument.type" type="button"
        :class="{ selected: draft.settings.instrumentType === instrument.type }"
        :aria-pressed="draft.settings.instrumentType === instrument.type"
        @click="changeInstrumentType(instrument.type)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="instrument.icon" /></svg>
        <span>{{ instrument.label }}</span>
      </button>
    </div>
  </div>
  <SampleHitSettings :draft="draft" @loading-change="emit('loading-change', $event)" />
  <SampleLoopSettings :draft="draft" @loading-change="emit('loading-change', $event)" />
  <Bass303Settings :draft="draft" />
  <Drum808Settings :draft="draft" />
</template>

<style scoped>
.instrument-types { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.pad-mode-setting { display: flex; flex-direction: column; gap: 4px; }
.instrument-types button { min-width: 0; min-height: 64px; padding: 8px; display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 4px; background: #292a26; color: #ecece8; text-align: left; cursor: pointer; }
.instrument-types button:hover, .instrument-types button.selected { border-color: var(--accent); background: #32372b; }
.instrument-types button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.instrument-types svg { flex: 0 0 24px; width: 24px; height: 24px; fill: none; stroke: var(--accent); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
</style>
