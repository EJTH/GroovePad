<script setup lang="ts">
import { LOOP_WIDGET_BUTTONS, loopWidgetButtonVisible, MAX_LOOP_CLIP_INDEX, type GridItem, type LoopNote, type SequencedLoopSettings } from '../../grid'
import { nextUnusedClipIndex } from '../../loopRows'
import type { useGridPlayback } from '../useGridPlayback'

type Playback = ReturnType<typeof useGridPlayback>
defineProps<{
  item: Extract<GridItem, { type: 'sequenced-loop' }>
  original: Extract<GridItem, { type: 'sequenced-loop' }>
  playing?: boolean
  status?: { enabled: boolean; pending: boolean; counting: boolean }
  playhead?: number
  wantsPlayback: boolean
  gesture: ReturnType<Playback['loopGesture']>
  curves: ReturnType<Playback['loopPreviewCurves']>
  notes: LoopNote[]
  previewX: Playback['previewX']
  previewY: Playback['previewY']
  previewColor: Playback['previewColor']
}>()
const emit = defineEmits<{
  keydown: [event: KeyboardEvent]
  arm: []
  togglePlayback: []
  clear: []
  clone: []
  changeIndex: [delta: number]
  openEditor: []
  quantize: []
}>()
function widgetButtonCount(settings: SequencedLoopSettings) {
  return LOOP_WIDGET_BUTTONS.filter((button) => loopWidgetButtonVisible(settings, button.id)).length
}
</script>

<template>
<div class="loop-control"
  role="group" :aria-label="`${item.label} controls`" tabindex="0"
  :style="{ '--loop-color': item.settings.color }"
  aria-keyshortcuts="ArrowUp ArrowDown"
  title="Use the buttons to arm or play; swipe up or down to change clips"
  @pointerdown="gesture.down" @pointermove="gesture.move" @pointerup="gesture.up"
  @pointercancel="gesture.cancel" @lostpointercapture="gesture.cancel"
  @click="gesture.click" @keydown="emit('keydown', $event)">
  <strong>{{ item.label }}</strong>
  <span class="loop-status">Clip {{ item.settings.clipIndex }} · {{ status?.counting ? 'Count-in' : status?.pending ? 'Waiting' : status?.enabled ? 'On' : wantsPlayback ? 'Ready' : 'Off' }}</span>
  <svg class="loop-preview" viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
    <path class="loop-preview-grid" d="M25 0v48 M50 0v48 M75 0v48 M0 12h100 M0 24h100 M0 36h100" />
    <path v-for="curve in curves" :key="curve.key" class="loop-preview-curve" :d="curve.path" :style="{ stroke: curve.color }" />
    <circle v-for="(note, index) in notes" :key="index" class="loop-preview-note"
      :cx="previewX(note.position, Math.max(1, item.settings.barLength * 4))"
      :cy="previewY(note.note, 36, 96)" r="1.5" :style="{ fill: previewColor(note.instrumentId, note.bankId) }" />
    <line v-if="playhead !== undefined" class="loop-preview-playhead"
      :x1="playhead" :x2="playhead" y1="0" y2="48" />
  </svg>
  <div v-if="widgetButtonCount(item.settings)" class="loop-actions"
    :style="{ '--button-columns': Math.min(4, widgetButtonCount(item.settings)), '--button-height': `${40 / Math.ceil(widgetButtonCount(item.settings) / 4)}cqh` }"
    @pointerdown.stop @pointermove.stop @pointerup.stop @pointercancel.stop @lostpointercapture.stop @click.stop @keydown.stop>
    <button v-if="loopWidgetButtonVisible(item.settings, 'arm')" type="button" class="loop-action loop-arm" :class="{ armed: item.settings.armed }"
      :aria-label="`${item.settings.armed ? 'Disarm' : 'Arm'} ${item.label} for recording`"
      :aria-pressed="item.settings.armed" :title="item.settings.armed ? 'Disarm recording' : 'Arm for recording'"
      @pointerdown.stop @pointermove.stop @pointerup.stop @pointercancel.stop @lostpointercapture.stop @click.stop="emit('arm')">
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6" /></svg>
    </button>
    <button v-if="loopWidgetButtonVisible(item.settings, 'play')" type="button" class="loop-action loop-play" :aria-label="`${wantsPlayback ? 'Pause' : 'Play'} ${item.label}${playing ? '' : ' when playback starts'}`"
      :aria-pressed="wantsPlayback"
      :title="playing ? (wantsPlayback ? 'Pause loop' : 'Play loop') : (wantsPlayback ? 'Do not start this loop when playback starts' : 'Start this loop when playback starts')"
      @pointerdown.stop @pointermove.stop @pointerup.stop @pointercancel.stop @lostpointercapture.stop @click.stop="emit('togglePlayback')">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path v-if="wantsPlayback" d="M5 4h4v12H5z M11 4h4v12h-4z" />
        <path v-else d="M6 3.5 17 10 6 16.5z" />
      </svg>
    </button>
    <button v-if="loopWidgetButtonVisible(item.settings, 'clear')" type="button" class="loop-action loop-clear"
      :aria-label="`Clear clip ${item.settings.clipIndex} in ${item.label}`"
      :title="`Clear clip ${item.settings.clipIndex}`"
      @pointerdown.stop @pointermove.stop @pointerup.stop @pointercancel.stop @lostpointercapture.stop @click.stop="emit('clear')">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6h10l-.8 11H5.8L5 6Zm2-3h6l1 2H6l1-2Zm1 5v6m4-6v6" /></svg>
    </button>
    <button v-if="loopWidgetButtonVisible(item.settings, 'clone')" type="button" class="loop-action loop-outline"
      :disabled="nextUnusedClipIndex(original.settings) === undefined" :aria-label="`Clone clip ${item.settings.clipIndex} in ${item.label}`"
      :title="nextUnusedClipIndex(original.settings) === undefined ? 'All clip indices are in use' : 'Clone clip'"
      @click="emit('clone')">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4h9v10H6zM4 7H3v10h9v-1M10.5 7v4M8.5 9h4" /></svg>
    </button>
    <button v-if="loopWidgetButtonVisible(item.settings, 'previous')" type="button" class="loop-action loop-outline"
      :disabled="original.settings.clipIndex <= 0" :aria-label="`Previous clip in ${item.label}`" title="Previous clip"
      @click="emit('changeIndex', -1)">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m14 4-7 6 7 6M5 4v12" /></svg>
    </button>
    <button v-if="loopWidgetButtonVisible(item.settings, 'next')" type="button" class="loop-action loop-outline"
      :disabled="original.settings.clipIndex >= MAX_LOOP_CLIP_INDEX" :aria-label="`Next clip in ${item.label}`" title="Next clip"
      @click="emit('changeIndex', 1)">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 4 7 6-7 6M15 4v12" /></svg>
    </button>
    <button v-if="loopWidgetButtonVisible(item.settings, 'editor')" type="button" class="loop-action loop-outline"
      :aria-label="`Open ${item.label} editor`" title="Open editor"
      @click="emit('openEditor')">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3h14v14H3zM7 3v14M3 8h14M3 13h14" /></svg>
    </button>
    <button v-if="loopWidgetButtonVisible(item.settings, 'quantize')" type="button" class="loop-action loop-quantize"
      :aria-label="`Record quantization ${item.settings.quantize === 'off' ? 'off' : item.settings.quantize}; change quantization`"
      title="Change record quantization" @click="emit('quantize')">Q {{ item.settings.quantize === 'off' ? 'OFF' : item.settings.quantize }}</button>
  </div>
</div>
</template>
