<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from 'vue'
import { noteName, scaleNote, scales } from '../music'
import { ExpressionTracker } from '../expression'
import type { ParameterOutput, PianoRollSettings } from '../grid'

const props = defineProps<{ label: string; settings: PianoRollSettings }>()
const emit = defineEmits<{ output: [output: ParameterOutput] }>()
const pointers = reactive(new Map<number, number>())
const keys = reactive(new Set<number>())
const expression = new ExpressionTracker()
const notes = computed(() => Array.from(
  { length: scales[props.settings.scale].length * props.settings.octaves },
  (_, degree) => Math.max(0, Math.min(127, 48 + props.settings.transpose + scaleNote(props.settings.scale, degree))),
))

function send(note: number, on: boolean, velocity = 100) {
  if (on) emit('output', { parameter: 'velocity', value: velocity })
  emit('output', { parameter: 'note', value: note, on, velocity })
}
function sendPressure() {
  emit('output', { parameter: 'pressure', value: expression.pressure })
}
function down(event: PointerEvent, note: number) {
  if (event.button !== 0 || pointers.has(event.pointerId)) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  event.preventDefault()
  target.setPointerCapture(event.pointerId)
  pointers.set(event.pointerId, note)
  const velocity = expression.updatePointer(event.pointerId, event, target.getBoundingClientRect(), props.settings.orientation === 'vertical' ? 'x' : 'y')
  sendPressure()
  send(note, true, velocity)
}
function up(event: PointerEvent) {
  const note = pointers.get(event.pointerId)
  if (note === undefined) return
  pointers.delete(event.pointerId)
  send(note, false)
  expression.remove(event.pointerId)
  sendPressure()
}
function move(event: PointerEvent) {
  if (!pointers.has(event.pointerId)) return
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('.key')
  if (!(event.currentTarget instanceof HTMLElement)) return
  const key = target && event.currentTarget.parentElement?.contains(target) ? target : event.currentTarget
  const velocity = expression.updatePointer(event.pointerId, event, key.getBoundingClientRect(), props.settings.orientation === 'vertical' ? 'x' : 'y')
  sendPressure()
  if (key !== target || !target || target.dataset.note === undefined) return

  const newNote = Number(target.dataset.note)
  const currentNote = pointers.get(event.pointerId)
  
  if (currentNote === undefined || currentNote === newNote) return
  
  send(currentNote, false)
  pointers.set(event.pointerId, newNote)
  send(newNote, true, velocity)
}
function keyDown(event: KeyboardEvent, note: number) {
  if ((event.key !== 'Enter' && event.key !== ' ') || event.repeat || keys.has(note)) return
  event.preventDefault()
  keys.add(note)
  expression.set(`key:${note}`, 100)
  sendPressure()
  send(note, true)
}
function keyUp(event: KeyboardEvent, note: number) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  releaseKey(note)
}
function releaseKey(note: number) {
  if (!keys.delete(note)) return
  send(note, false)
  expression.remove(`key:${note}`)
  sendPressure()
}
function releaseAll() {
  const hadContacts = pointers.size > 0 || keys.size > 0
  for (const note of pointers.values()) send(note, false)
  for (const note of keys) send(note, false)
  pointers.clear()
  keys.clear()
  expression.clear()
  if (hadContacts) sendPressure()
}
watch([() => props.settings.scale, () => props.settings.transpose, () => props.settings.octaves], releaseAll, { flush: 'sync' })
onBeforeUnmount(releaseAll)
</script>

<template>
  <div class="piano" :class="settings.orientation" :style="{ '--piano-color': settings.color }" :aria-label="label">
    <button v-for="(note, index) in notes" :key="index" type="button" class="key"
      :class="{ active: [...pointers.values()].includes(note) || keys.has(note) }"
      :aria-label="`${label} note ${noteName(note)}`" :data-note="note"
      @pointerdown="down($event, note)" @pointerup="up" @pointermove="move" @pointercancel="up" @lostpointercapture="up"
      @keydown="keyDown($event, note)" @keyup="keyUp($event, note)" @blur="releaseKey(note)">
      <span>{{ noteName(note) }}</span>
    </button>
  </div>
</template>

<style scoped>
.piano { width: 100%; height: 100%; display: flex; overflow: auto; touch-action: none; }
.piano.vertical { flex-direction: column-reverse; }
.key { flex: 1 0 24px; min-width: 24px; min-height: 24px; padding: 2px; border: 1px solid var(--piano-color); border-radius: 2px; background: color-mix(in srgb, var(--piano-color) 35%, #e2e8dd); color: #252820; touch-action: none; }
.vertical .key { flex-basis: 24px; }
.key.active { background: color-mix(in srgb, var(--piano-color) 65%, #e2e8dd); }
.key span { font-size: 9px; }
</style>
