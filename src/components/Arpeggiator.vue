<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { scales } from '../music'
import type { ArpeggiatorSettings, HeldNote, ParameterOutput } from '../grid'

const props = defineProps<{ label: string; settings: ArpeggiatorSettings; bpm: number; notes: HeldNote[] }>()
const emit = defineEmits<{ output: [output: ParameterOutput]; toggle: [] }>()
const activeNote = ref<number | null>(null)
const forwarded = new Map<number, HeldNote>()
let step = 0
let interval: number | undefined
let releaseTimer: number | undefined

function stepDuration() {
  const [numerator, denominator] = props.settings.rate.split('/').map(Number)
  return 60000 / props.bpm * 4 * numerator! / denominator!
}

function release() {
  if (releaseTimer !== undefined) window.clearTimeout(releaseTimer)
  releaseTimer = undefined
  if (activeNote.value !== null) emit('output', { parameter: 'note', value: activeNote.value, on: false, velocity: 100 })
  activeNote.value = null
}

function tick() {
  release()
  const notes = [...props.notes].sort((a, b) => a.note - b.note)
  if (!notes.length) return
  const { style, steps, distance, scale, gate } = props.settings
  const period = Math.max(1, steps * 2 - 2)
  let index = step % steps
  if (style === 'down') index = steps - 1 - index
  else if (style === 'up-down') { const n = step % period; index = n < steps ? n : period - n }
  else if (style === 'random') index = Math.floor(Math.random() * steps)
  const root = notes[index % notes.length]!.note
  let note = root + Math.floor(index / notes.length) * distance
  while (note < 127 && !scales[scale].includes(((note - root) % 12 + 12) % 12)) note++
  note = Math.max(0, Math.min(127, note))
  activeNote.value = note
  emit('output', { parameter: 'note', value: note, on: true, velocity: 100 })
  releaseTimer = window.setTimeout(release, stepDuration() * gate)
  step++
}

function stop() {
  if (interval !== undefined) window.clearInterval(interval)
  interval = undefined
  release()
}

function restart() {
  stop()
  if (!props.settings.enabled || !props.notes.length) return
  step = 0
  tick()
  interval = window.setInterval(tick, stepDuration())
}

function syncForwarded(notes: HeldNote[]) {
  const next = new Map(notes.map((note) => [note.note, note]))
  for (const [pitch, old] of forwarded) {
    const remaining = next.get(pitch)?.count ?? 0
    for (let count = remaining; count < old.count; count++) {
      emit('output', { parameter: 'note', value: pitch, on: false, velocity: old.velocity })
    }
  }
  for (const [pitch, note] of next) {
    const previous = forwarded.get(pitch)?.count ?? 0
    for (let count = previous; count < note.count; count++) {
      emit('output', { parameter: 'note', value: pitch, on: true, velocity: note.velocity })
    }
  }
  forwarded.clear()
  for (const [pitch, note] of next) forwarded.set(pitch, { ...note })
}

watch(
  [
    () => props.notes.map((note) => `${note.note}:${note.count}:${note.velocity}`).join(','),
    () => props.settings.enabled,
    () => props.settings.rate,
    () => props.bpm,
  ],
  () => {
    if (props.settings.enabled) {
      syncForwarded([])
      restart()
    } else {
      stop()
      syncForwarded(props.notes)
    }
  },
  { immediate: true, flush: 'sync' },
)
onBeforeUnmount(() => { stop(); syncForwarded([]) })
</script>

<template>
  <button type="button" class="arp" :aria-label="`${settings.enabled ? 'Disable' : 'Enable'} ${label}`"
    :aria-pressed="settings.enabled" @click="emit('toggle')">
    <strong>{{ label }}</strong>
    <span>{{ settings.enabled ? (notes.length ? `Note ${activeNote ?? '–'}` : 'Waiting for notes') : 'Bypass' }}</span>
  </button>
</template>

<style scoped>
.arp { width: 100%; height: 100%; padding: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; overflow: hidden; border: 1px solid #69775b; border-radius: 4px; background: #30392b; color: #e2edd9; }
.arp[aria-pressed="false"] { background: #252623; color: #a7a89f; }
.arp strong, .arp span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
</style>
