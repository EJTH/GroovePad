<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{ buffer: AudioBuffer; start: number; end: number; cuts: number[] }>()
const emit = defineEmits<{
  'update:start': [value: number]
  'update:end': [value: number]
  'update:cuts': [value: number[]]
}>()
const zoom = ref(1)
const pan = ref(0)
const adding = ref(false)
const surface = ref<HTMLElement | null>(null)
const epsilon = 0.000001
const pointers = new Map<number, { x: number; y: number }>()
let gesture: { kind: 'pan'; x: number; left: number } |
  { kind: 'marker'; index: number } |
  { kind: 'pinch'; distance: number; zoom: number; anchor: number } | undefined
const width = computed(() => 1 / zoom.value)
const left = computed(() => pan.value * (1 - width.value))
const right = computed(() => left.value + width.value)
const markers = computed(() => [
  { name: 'Start', value: props.start, index: -1 },
  ...props.cuts.map((value, index) => ({ name: `Cut ${index + 1}`, value, index })),
  { name: 'End', value: props.end, index: props.cuts.length },
])
const waveform = computed(() => {
  const buffer = props.buffer
  const points: string[] = []
  for (let x = 0; x < 600; x++) {
    const from = Math.floor((left.value + width.value * x / 600) * buffer.length)
    const to = Math.min(buffer.length, Math.max(from + 1, Math.floor((left.value + width.value * (x + 1) / 600) * buffer.length)))
    let min = 0
    let max = 0
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel)
      for (let i = from; i < to; i++) {
        min = Math.min(min, data[i]!)
        max = Math.max(max, data[i]!)
      }
    }
    points.push(`M${x} ${50 - max * 48}V${50 - min * 48}`)
  }
  return points.join('')
})
watch(() => props.buffer, () => { zoom.value = 1; pan.value = 0; adding.value = false })

function position(event: PointerEvent): number {
  const rect = surface.value!.getBoundingClientRect()
  return Math.max(0, Math.min(1, left.value + (event.clientX - rect.left) / rect.width * width.value))
}

function fraction(clientX: number): number {
  const rect = surface.value!.getBoundingClientRect()
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
}

function setView(nextZoom: number, nextLeft: number) {
  zoom.value = Math.max(1, Math.min(40, nextZoom))
  const maxLeft = 1 - 1 / zoom.value
  pan.value = maxLeft > 0 ? Math.max(0, Math.min(maxLeft, nextLeft)) / maxLeft : 0
}

function zoomAt(nextZoom: number, at: number) {
  const anchor = left.value + at * width.value
  const bounded = Math.max(1, Math.min(40, nextZoom))
  setView(bounded, anchor - at / bounded)
}

function wheel(event: WheelEvent) {
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 300 : 1
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && !event.ctrlKey) {
    setView(zoom.value, left.value + event.deltaX * unit / surface.value!.clientWidth * width.value)
  } else {
    const delta = Math.max(-1, Math.min(1, event.deltaY * unit * 0.002))
    zoomAt(zoom.value * Math.exp(-delta), fraction(event.clientX))
  }
}

function move(index: number, value: number) {
  const lower = index === -1 ? 0 : (index === 0 ? props.start : props.cuts[index - 1]!) + epsilon
  const upper = index === props.cuts.length ? 1 : (index === -1 ? (props.cuts[0] ?? props.end) : (props.cuts[index + 1] ?? props.end)) - epsilon
  value = Math.max(lower, Math.min(upper, value))
  if (index === -1) emit('update:start', value)
  else if (index === props.cuts.length) emit('update:end', value)
  else emit('update:cuts', props.cuts.map((cut, i) => i === index ? value : cut))
}

function beginGesture(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  const target = event.target as HTMLElement
  const marker = target.closest<HTMLElement>('[data-marker]')
  if (adding.value && !marker && pointers.size === 0) {
    addCut(event)
    return
  }
  if (pointers.size >= 2) return
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  surface.value!.setPointerCapture(event.pointerId)
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }]
    const center = fraction((a.x + b.x) / 2)
    gesture = { kind: 'pinch', distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), zoom: zoom.value, anchor: left.value + center * width.value }
  } else if (marker) {
    gesture = { kind: 'marker', index: Number(marker.dataset.marker) }
  } else {
    gesture = { kind: 'pan', x: event.clientX, left: left.value }
  }
  event.preventDefault()
}

function updateGesture(event: PointerEvent) {
  if (!pointers.has(event.pointerId) || !gesture) return
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (gesture.kind === 'marker') move(gesture.index, position(event))
  else if (gesture.kind === 'pan') {
    setView(zoom.value, gesture.left - (event.clientX - gesture.x) / surface.value!.clientWidth * width.value)
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }]
    const nextZoom = Math.max(1, Math.min(40, gesture.zoom * Math.hypot(b.x - a.x, b.y - a.y) / gesture.distance))
    setView(nextZoom, gesture.anchor - fraction((a.x + b.x) / 2) / nextZoom)
  }
}

function endGesture(event: PointerEvent) {
  if (!pointers.delete(event.pointerId)) return
  const remaining = pointers.values().next()
  gesture = remaining.done ? undefined : { kind: 'pan', x: remaining.value.x, left: left.value }
}

function addCut(event: PointerEvent) {
  if (!adding.value) return
  const value = position(event)
  const boundaries = [props.start, ...props.cuts, props.end]
  if (value <= props.start || value >= props.end || boundaries.some((point) => Math.abs(point - value) < epsilon)) return
  emit('update:cuts', [...props.cuts, value].sort((a, b) => a - b))
  adding.value = false
}
</script>

<template>
  <div class="waveform-editor">
    <div ref="surface" class="waveform" :class="{ adding }"
      @wheel.prevent="wheel" @pointerdown="beginGesture" @pointermove="updateGesture"
      @pointerup="endGesture" @pointercancel="endGesture" @lostpointercapture="endGesture">
      <svg viewBox="0 0 600 100" preserveAspectRatio="none" aria-hidden="true">
        <path :d="waveform" />
      </svg>
      <template v-for="marker in markers" :key="marker.name">
        <button v-if="marker.value >= left && marker.value <= right" type="button" class="marker"
          :class="{ boundary: marker.index === -1 || marker.index === cuts.length }"
          :data-marker="marker.index"
          :style="{ left: `${(marker.value - left) / width * 100}%` }"
          :aria-label="`${marker.name}: ${(marker.value * buffer.duration).toFixed(2)} seconds`"
          :title="`${marker.name} ${(marker.value * buffer.duration).toFixed(2)}s`"
          @keydown.left.prevent="move(marker.index, marker.value - width / 100)"
          @keydown.right.prevent="move(marker.index, marker.value + width / 100)">
          <span>{{ marker.name }}</span>
        </button>
      </template>
    </div>
    <div class="waveform-time"><span>{{ (left * buffer.duration).toFixed(2) }}s</span><span>{{ (right * buffer.duration).toFixed(2) }}s</span></div>
    <div class="cut-controls">
      <button type="button" @click="adding = !adding">{{ adding ? 'Cancel adding cut' : 'Add cut' }}</button>
      <span v-if="adding">Click the waveform between start and end.</span>
      <button v-for="(_, index) in cuts" :key="index" type="button"
        @click="emit('update:cuts', cuts.filter((_, i) => i !== index))">Remove cut {{ index + 1 }}</button>
    </div>
    <p>Drag to pan, scroll or pinch to zoom. Drag markers or use arrow keys to adjust them.</p>
  </div>
</template>

<style scoped>
.waveform { position: relative; height: 130px; margin: 10px 8px 0; background: #171a1b; border: 1px solid #565b56; touch-action: none; cursor: grab; }
.waveform:active { cursor: grabbing; }
.waveform.adding { cursor: crosshair; }
svg { width: 100%; height: 100%; pointer-events: none; }
path { fill: none; stroke: #83c9bb; stroke-width: 1; vector-effect: non-scaling-stroke; }
.marker { position: absolute; top: 0; bottom: 0; width: 16px; padding: 0; transform: translateX(-50%); border: 0; background: linear-gradient(90deg, transparent 7px, #ffd36c 7px, #ffd36c 9px, transparent 9px); touch-action: none; cursor: ew-resize; }
.marker.boundary { background: linear-gradient(90deg, transparent 7px, #ff6b9d 7px, #ff6b9d 9px, transparent 9px); }
.marker span { position: absolute; top: 0; left: 8px; background: #343734; color: white; font-size: 10px; white-space: nowrap; pointer-events: none; }
.marker:focus-visible { outline: 2px solid white; }
.waveform-time { display: flex; justify-content: space-between; font-size: 11px; color: #aaa; }
.cut-controls { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 8px; }
.cut-controls button { padding: 6px; }
.cut-controls span, p { color: #bbb; font-size: 12px; }
p { margin: 6px 0; }
</style>
