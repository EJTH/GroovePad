<script setup lang="ts">
import { ref, shallowRef, watch, type Ref } from 'vue'
import type { GridItem, LoopAutomation, LoopNote } from '../../grid'
import { useVisualRefresh } from '../../composables/useVisualRefresh'

const props = defineProps<{
  item: Extract<GridItem, { type: 'sequenced-loop' }>
  clipIndex: number
  automation: LoopAutomation[]
  notes: LoopNote[]
  getCurves: (item: Extract<GridItem, { type: 'sequenced-loop' }>) => { key: string; path: string; color: string }[]
  length: number
  playhead?: number
  playheadSource?: { positions: Readonly<Ref<ReadonlyMap<string, number>>> }
  previewX: (position: number, length: number) => number
  previewY: (value: number, min: number, max: number) => number
  previewColor: (sourceId: string, bankId?: string) => string
}>()

const element = ref<SVGElement | null>(null)

function makePreview() {
  let min = Infinity
  let max = -Infinity
  for (const note of props.notes) {
    min = Math.min(min, note.note)
    max = Math.max(max, note.note)
  }
  const barLines: number[] = []
  for (let position = 0; position < props.length; position += 4) {
    barLines.push(props.previewX(position, props.length))
  }
  const octaveLines: number[] = []
  if (props.notes.length) {
    for (let pitch = Math.ceil(min / 12) * 12; pitch <= max; pitch += 12) {
      octaveLines.push(props.previewY(pitch, min, max))
    }
  }
  return {
    barLines, octaveLines, curves: props.getCurves(props.item),
    notes: props.notes.map((note) => ({
      x: props.previewX(note.position, Math.max(1, props.length)),
      y: props.previewY(note.note, min, max),
      color: props.previewColor(note.instrumentId, note.bankId),
    })),
  }
}

const preview = shallowRef(makePreview())
const { request, visible } = useVisualRefresh(element, 5, () => { preview.value = makePreview() })
watch(() => visible.value ? [
  props.clipIndex, props.automation, props.notes, props.length,
  [
    ...props.automation.map((event) => props.previewColor(event.sourceId, event.bankId)),
    ...props.notes.map((note) => props.previewColor(note.instrumentId, note.bankId)),
  ],
] : undefined, request, { deep: true })
function currentPlayhead() {
  return props.playheadSource ? props.playheadSource.positions.value.get(props.item.id) : props.playhead
}
const displayPlayhead = ref(currentPlayhead())
watch([() => visible.value ? currentPlayhead() : undefined, visible], ([playhead, isVisible]) => {
  if (isVisible) displayPlayhead.value = playhead
})
</script>

<template>
<svg ref="element" class="loop-preview" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
  <g v-memo="[preview]">
    <line v-for="x in preview.barLines" :key="`bar-${x}`" class="loop-preview-grid" :x1="x" :x2="x" y1="0" y2="60" />
    <line v-for="y in preview.octaveLines" :key="`octave-${y}`" class="loop-preview-grid" x1="0" x2="100" :y1="y" :y2="y" />
    <path v-for="curve in preview.curves" :key="curve.key" class="loop-preview-curve" :d="curve.path" :style="{ stroke: curve.color }" />
    <circle v-for="(note, index) in preview.notes" :key="index" class="loop-preview-note"
      :cx="note.x" :cy="note.y" r="1.5" :style="{ fill: note.color }" />
  </g>
  <line v-if="displayPlayhead !== undefined" class="loop-preview-playhead"
    :x1="displayPlayhead" :x2="displayPlayhead" y1="0" y2="48" />
</svg>
</template>

<style>
.loop-preview { position: relative; display: block; width: 100%; height: 100%; min-height: 4px; pointer-events: none; }
.loop-preview-grid { fill: none; stroke: color-mix(in srgb, var(--loop-color) 20%, transparent); stroke-width: .6; }
.loop-preview-curve { fill: none; stroke: var(--loop-color); stroke-width: 1.5; opacity: .8; }
.loop-preview-note { fill: var(--loop-color); }
.loop-preview-playhead { stroke: #fff; stroke-width: .8; vector-effect: non-scaling-stroke; }
</style>
