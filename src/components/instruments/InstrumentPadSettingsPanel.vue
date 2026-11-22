<script setup lang="ts">
import type { GridItem } from '../../grid'
import { InstrumentFactory } from '../../instruments'
import SampleHitSettings from './SampleHitSettings.vue'
import SampleLoopSettings from './SampleLoopSettings.vue'
import Bass303Settings from './Bass303Settings.vue'
import Drum808Settings from './Drum808Settings.vue'

const props = defineProps<{ draft: Extract<GridItem, { type: 'instrument-pad' }> }>()
const emit = defineEmits<{ 'loading-change': [loading: boolean] }>()

function changeInstrumentType(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  const type = target.value
  if (type !== 'sample-hit' && type !== 'sample-loop' && type !== '303' && type !== '808') {
    throw new Error(`Unknown instrument type: ${type}`)
  }
  if (type === props.draft.settings.instrumentType) return
  props.draft.settings.instrumentParams = InstrumentFactory.getDefaultParams(type)
  props.draft.settings.instrumentType = type
}
</script>

<template>
  <div class="settings-section">
    <h3>Instrument Pad Settings</h3>
    <label>Instrument Type
      <select
        :value="draft.settings.instrumentType"
        required
        @change="changeInstrumentType"
      >
        <option value="sample-hit">Sample Hit</option>
        <option value="sample-loop">Sample Loop</option>
        <option value="303">303 Bass Synth</option>
        <option value="808">808 Drum Kit</option>
      </select>
    </label>
  </div>
  <SampleHitSettings :draft="draft" @loading-change="emit('loading-change', $event)" />
  <SampleLoopSettings :draft="draft" @loading-change="emit('loading-change', $event)" />
  <Bass303Settings :draft="draft" />
  <Drum808Settings :draft="draft" />
</template>
