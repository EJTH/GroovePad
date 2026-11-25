<script setup lang="ts">
import type { KnobSettings, ParameterOutput } from '../grid'
import Fader from './Fader.vue'
import Knob from './Knob.vue'

export interface MixerChannelControl {
  id: string
  label: string
  volume: number
  pan: number
  solo: boolean
}

defineProps<{ label: string; color: string; channels: MixerChannelControl[] }>()
const emit = defineEmits<{ change: [id: string, parameter: 'volume' | 'pan' | 'solo', value: number | boolean] }>()

function panSettings(value: number): KnobSettings {
  return { color: '#83c9bb', min: -1, max: 1, defaultValue: 0, value, step: 0.01, unit: '', recordAutomation: false }
}
function setPan(channel: MixerChannelControl, output: ParameterOutput) {
  emit('change', channel.id, 'pan', output.value)
}
</script>

<template>
  <div class="mixer-control" :style="{ '--tone-color': color }">
    <strong>{{ label }}</strong>
    <div v-if="channels.length" class="mixer-channels" role="group" :aria-label="`${label} channels`">
      <div v-for="channel in channels" :key="channel.id" class="mixer-channel">
        <small class="channel-name" :title="channel.label">{{ channel.label }}</small>
        <Fader label="Channel level" :value="channel.volume" @change="emit('change', channel.id, 'volume', $event)" />
        <div class="channel-actions">
          <div class="pan-control">
            <Knob label="Pan" :settings="panSettings(channel.pan)" @output="setPan(channel, $event)" />
          </div>
          <button type="button" class="solo-button" :class="{ active: channel.solo }"
            :aria-label="`${channel.solo ? 'Unsolo' : 'Solo'} ${channel.label}`" :aria-pressed="channel.solo"
            @click="emit('change', channel.id, 'solo', !channel.solo)">S</button>
        </div>
      </div>
    </div>
    <small v-else class="empty-message">Connect audio sources to add channels</small>
  </div>
</template>

<style scoped>
.mixer-control { width: 100%; height: 100%; min-width: 0; min-height: 0; padding: 3px; display: flex; flex-direction: column; gap: 3px; overflow: hidden; border-radius: 8px; background: color-mix(in srgb, var(--tone-color) 18%, #222320); color: #ecece8; }
.mixer-control > strong { flex: 0 0 auto; max-width: 100%; overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.mixer-channels { display: flex; flex: 1; min-height: 0; overflow-x: auto; overflow-y: hidden; }
.mixer-channel { width: 52px; min-width: 52px; min-height: 0; padding: 2px; display: flex; flex-direction: column; align-items: center; gap: 2px; border-left: 1px solid #4b5148; }
.channel-name { width: 100%; overflow: hidden; color: var(--muted); font-size: 8px; line-height: 10px; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.channel-actions { width: 100%; height: 30px; flex: 0 0 auto; display: flex; align-items: center; justify-content: space-around; }
.pan-control { width: 30px; height: 30px; flex: 0 0 auto; }
.pan-control :deep(.knob) { padding: 0; gap: 0; }
.pan-control :deep(.knob-control) { width: 22px; border-width: 1px; }
.pan-control :deep(.indicator::before) { height: 18%; }
.pan-control :deep(.value), .pan-control :deep(.label) { font-size: 8px; line-height: 9px; }
.solo-button { width: 20px; height: 18px; flex: 0 0 auto; padding: 0; border: 1px solid #536149; border-radius: 3px; background: #171816; color: #d3e6c1; font-size: 9px; font-weight: 700; }
.solo-button.active { border-color: var(--accent); background: var(--accent); color: #171816; }
.solo-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.empty-message { margin: auto; color: var(--muted); font-size: 9px; text-align: center; }
</style>
