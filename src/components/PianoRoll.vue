<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from 'vue'
import { scaleNote, scales } from '../music'
import type { ParameterOutput, PianoRollSettings } from '../grid'

const props = defineProps<{ label: string; settings: PianoRollSettings }>()
const emit = defineEmits<{ output: [output: ParameterOutput] }>()
const pointers = reactive(new Map<number, number>())
const keys = reactive(new Set<number>())
const notes = computed(() => Array.from(
  { length: scales[props.settings.scale].length * props.settings.octaves },
  (_, degree) => Math.max(0, Math.min(127, 48 + props.settings.transpose + scaleNote(props.settings.scale, degree))),
))

function send(note: number, on: boolean) {
  emit('output', { parameter: 'note', value: note, on, velocity: 100 })
}
function down(event: PointerEvent, note: number) {
  if (event.button !== 0 || pointers.has(event.pointerId)) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  event.preventDefault()
  target.setPointerCapture(event.pointerId)
  pointers.set(event.pointerId, note)
  send(note, true)
}
function up(event: PointerEvent) {
  const note = pointers.get(event.pointerId)
  if (note === undefined) return
  pointers.delete(event.pointerId)
  send(note, false)
}
function keyDown(event: KeyboardEvent, note: number) {
  if ((event.key !== 'Enter' && event.key !== ' ') || event.repeat || keys.has(note)) return
  event.preventDefault()
  keys.add(note)
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
}
function releaseAll() {
  for (const note of pointers.values()) send(note, false)
  for (const note of keys) send(note, false)
  pointers.clear()
  keys.clear()
}
watch([() => props.settings.scale, () => props.settings.transpose, () => props.settings.octaves], releaseAll, { flush: 'sync' })
onBeforeUnmount(releaseAll)
</script>

<template>
  <div class="piano" :class="settings.orientation" :aria-label="label">
    <button v-for="(note, index) in notes" :key="index" type="button" class="key"
      :class="{ active: [...pointers.values()].includes(note) || keys.has(note) }"
      :aria-label="`${label} note ${note}`"
      @pointerdown="down($event, note)" @pointerup="up" @pointercancel="up" @lostpointercapture="up"
      @keydown="keyDown($event, note)" @keyup="keyUp($event, note)" @blur="releaseKey(note)">
      <span>{{ note }}</span>
    </button>
  </div>
</template>

<style scoped>
.piano { width: 100%; height: 100%; display: flex; overflow: auto; touch-action: none; }
.piano.vertical { flex-direction: column-reverse; }
.key { flex: 1 0 24px; min-width: 24px; min-height: 24px; padding: 2px; border: 1px solid #687066; border-radius: 2px; background: #e2e8dd; color: #252820; touch-action: none; }
.vertical .key { flex-basis: 24px; }
.key.active { background: var(--accent); }
.key span { font-size: 9px; }
</style>
