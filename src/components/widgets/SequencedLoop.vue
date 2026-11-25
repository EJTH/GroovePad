<script setup lang="ts">
import { computed, ref } from 'vue'
import { LOOP_WIDGET_BUTTONS, loopWidgetButtonVisible, MAX_LOOP_CLIP_INDEX, type GridItem, type LoopNote, type SequencedLoopSettings } from '../../grid'
import { nextUnusedClipIndex } from '../../loopRows'
import type { useGridPlayback } from '../useGridPlayback'
import LoopPreview from './LoopPreview.vue'

type Playback = ReturnType<typeof useGridPlayback>
const props = defineProps<{
  item: Extract<GridItem, { type: 'sequenced-loop' }>
  original: Extract<GridItem, { type: 'sequenced-loop' }>
  playing?: boolean
  status?: { enabled: boolean; pending: boolean }
  playhead?: number
  wantsPlayback: boolean
  gesture: ReturnType<Playback['loopGesture']>
  getCurves: Playback['loopPreviewCurves']
  notes: LoopNote[]
  previewX: Playback['previewX']
  previewY: Playback['previewY']
  previewColor: Playback['previewColor']
}>()
const root = ref<HTMLElement | null>(null)
const emptyAutomation: SequencedLoopSettings['automation'][string] = []
const automation = computed(() => props.item.settings.automation[String(props.item.settings.clipIndex)] ?? emptyAutomation)
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
function isVisible() {
  return !!root.value?.getClientRects().length
}
defineExpose({ isVisible })
</script>

<template>
<div ref="root" class="loop-control"
  role="group" :aria-label="`${item.label} controls`" tabindex="0"
  :style="{ '--loop-color': item.settings.color }"
  aria-keyshortcuts="ArrowUp ArrowDown"
  title="Use the buttons to arm or play; swipe up or down to change clips"
  @pointerdown="gesture.down" @pointermove="gesture.move" @pointerup="gesture.up"
  @pointercancel="gesture.cancel" @lostpointercapture="gesture.cancel"
  @click="gesture.click" @keydown="emit('keydown', $event)">
  <div class="loop-header">
    <strong>{{ item.label }}</strong>
    <span class="loop-status">Clip {{ item.settings.clipIndex }} · {{ status?.pending ? 'Waiting' : status?.enabled ? 'On' : wantsPlayback ? 'Ready' : 'Off' }}</span>
  </div>
  <LoopPreview :item="item" :clip-index="item.settings.clipIndex" :automation="automation" :notes="notes"
    :get-curves="getCurves" :length="item.settings.barLength * 4" :playhead="playhead"
    :preview-x="previewX" :preview-y="previewY" :preview-color="previewColor" />
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
<style>

.loop-header {
  display: flex;
  flex-direction: column;
  position:absolute;
  top: 0;
  width:100%;
}
.loop-control { position: relative; box-sizing: border-box; width: 100%; height: 100%; padding: 5px; display: grid; grid-template-rows: auto auto minmax(4px, 1fr) auto; align-items: center; gap: 3px; overflow: hidden; border: 1px solid var(--loop-color); border-radius: 4px; background: color-mix(in srgb, var(--loop-color) 7%, #171816); color: #e2edd9; touch-action: none; -webkit-tap-highlight-color: transparent; }
.loop-control:focus-visible { outline: 2px solid var(--loop-color); outline-offset: 2px; }
.loop-control strong, .loop-control .loop-status { max-width: 100%; overflow: hidden; text-align: center; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.loop-actions { 
  width: 50%; display: grid; grid-template-columns: repeat(var(--button-columns), minmax(0, 1fr)); gap: 4px;
  position: absolute;
  bottom: 8px;
  left: 8px;
}
.loop-action { opacity: 0.5; box-sizing: border-box; width: 100%; min-width: 0; height: clamp(16px, var(--button-height), 36px); padding: 2px; display: grid; grid-template-columns: minmax(0, 1fr); place-items: center; overflow: hidden; border: 1px solid color-mix(in srgb, var(--loop-color) 55%, #555); border-radius: 4px; background: #20221f; color: #e2edd9; cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent; appearance: none; }
.loop-action:hover { opacity: 1; }
.loop-action:focus-visible { outline: 2px solid var(--loop-color); outline-offset: 2px; }
.loop-action svg { display: block; width: min(20px, 100%); height: auto; aspect-ratio: 1; fill: currentColor; }
.loop-action.loop-arm svg { fill: none; stroke: #ff6262; stroke-width: 2; }
.loop-action.loop-arm.armed svg { fill: #ff6262; }
.loop-action.loop-clear svg { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.loop-action.loop-outline svg { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.loop-action.loop-quantize { font-size: 9px; white-space: nowrap; }
.loop-action:disabled { opacity: .4; cursor: not-allowed; }

</style>