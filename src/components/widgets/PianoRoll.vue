<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { noteName, scaleNote, scales } from '../../music'
import { ExpressionTracker } from '../../expression'
import type { ParameterOutput, PianoRollSettings, RepeatDivision } from '../../grid'
import type { TransportClock } from '../../sequencedLoop'
import { useNoteRepeat } from '../useNoteRepeat'

const props = defineProps<{ label: string; settings: PianoRollSettings; rotated?: boolean; repeatDivision?: RepeatDivision; bpm?: number; playing?: boolean; transportClock?: TransportClock }>()
const emit = defineEmits<{ output: [output: ParameterOutput] }>()
const root = ref<HTMLElement | null>(null)
const pointers = reactive(new Map<number, number>())
const keys = reactive(new Set<number>())
const expression = new ExpressionTracker()
function isVisible() {
  return !!root.value?.getClientRects().length
}
defineExpose({ isVisible })

const notes = computed(() => {
  const numRows = props.settings.numRows ?? 1
  const totalOctaves = props.settings.octaves * numRows
  const octaveShift = props.settings.octaveTranspose * 12
  if (props.settings.style === 'whites-blacks') {
    return Array.from(
      { length: 12 * totalOctaves },
      (_, degree) => 48 + octaveShift + degree,
    )
  }
  return Array.from(
    { length: scales[props.settings.scale].length * totalOctaves },
    (_, degree) => 48 + octaveShift + scaleNote(props.settings.scale, degree, props.settings.rootNote),
  )
})
const rows = computed(() => {
  const requestedCount = props.settings.numRows ?? 1
  const count = Number.isSafeInteger(requestedCount) && requestedCount >= 1 && requestedCount <= 8
    ? requestedCount : 1
  return Array.from({ length: count }, (_, row) => {
    const start = Math.floor(row * notes.value.length / count)
    const end = Math.floor((row + 1) * notes.value.length / count)
    return notes.value.slice(start, end).map((note, index) => ({ note, index: start + index }))
  })
})

function isScaleNote(note: number) {
  const root = 48 + props.settings.octaveTranspose * 12 +
    scaleNote(props.settings.scale, 0, props.settings.rootNote)
  const interval = ((note - root) % 12 + 12) % 12
  return scales[props.settings.scale].includes(interval)
}

function octaveTranspose() {
  return props.settings.octaveTranspose * 12
}

function layoutNote(note: number) {
  return props.settings.style === 'whites-blacks' ? note - octaveTranspose() : note
}

function whiteIndex(note: number) {
  const pitch = layoutNote(note)
  return Math.floor(pitch / 12) * 7 + [0, 2, 4, 5, 7, 9, 11].filter((key) => key < pitch % 12).length
}
function isWhiteKey(note: number) {
  return [0, 2, 4, 5, 7, 9, 11].includes(layoutNote(note) % 12)
}
function pianoRowBounds(row: { note: number }[]) {
  if (!row.length) return { start: 0, slots: 0 }
  const first = row[0]!.note
  const last = row[row.length - 1]!.note
  if (row.length === 1 && !isWhiteKey(first)) {
    return { start: whiteIndex(first) - 0.5, slots: 1 }
  }
  const start = whiteIndex(first) - (isWhiteKey(first) ? 0 : 0.3)
  const end = whiteIndex(last) + (isWhiteKey(last) ? 1 : 0.3)
  return { start, slots: end - start }
}
function pianoRowStyle(row: { note: number }[]) {
  const size = `${pianoRowBounds(row).slots * 24}px`
  return props.settings.orientation === 'vertical' ? { minHeight: size } : { minWidth: size }
}
function pianoKeyStyle(row: { note: number }[], note: number) {
  const { start, slots } = pianoRowBounds(row)
  const black = !isWhiteKey(note)
  const offset = (whiteIndex(note) - start - (black ? 0.3 : 0)) / slots * 100
  const size = (black ? 0.6 : 1) / slots * 100
  return props.settings.orientation === 'vertical'
    ? { bottom: `${offset}%`, height: `${size}%` }
    : { left: `${offset}%`, width: `${size}%` }
}
function bendAt(event: PointerEvent, key: HTMLElement) {
  const rect = key.getBoundingClientRect()
  const vertical = props.settings.orientation === 'vertical'
  const size = props.rotated ? (vertical ? rect.width : rect.height) : (vertical ? rect.height : rect.width)
  const coordinate = props.rotated
    ? (vertical ? event.clientX - rect.left : event.clientY - rect.top)
    : (vertical ? rect.top + rect.height - event.clientY : event.clientX - rect.left)
  const position = size > 0 ? coordinate / size : 0.5
  const index = Number(key.dataset.index)
  const offset = Math.max(0, Math.min(1, position)) - 0.5
  const current = notes.value[index]
  if (current === undefined) return 0
  const neighbor = notes.value[index + (offset < 0 ? -1 : 1)]
  return offset * (neighbor === undefined ? 1 : Math.abs(neighbor - current))
}
const repeat = useNoteRepeat({
  division: () => props.repeatDivision, bpm: () => props.bpm ?? 120, playing: () => props.playing,
  clock: () => props.transportClock,
  send: (value: { note: number; velocity: number; bend?: number }, on) => {
    if (on) emit('output', { parameter: 'velocity', value: value.velocity })
    emit('output', { parameter: 'note', value: value.note, on, velocity: value.velocity, ...(value.bend === undefined ? {} : { bend: value.bend }) })
  },
})
function send(note: number, on: boolean, velocity = 100, bend?: number) {
  repeat.change(note, { note, velocity, bend }, on)
}
function sendPressure() {
  emit('output', { parameter: 'pressure', value: expression.pressure, active: expression.active })
}
function pointerExpression(event: PointerEvent, key: HTMLElement) {
  const vertical = props.settings.orientation === 'vertical'
  const axis = props.rotated ? (vertical ? 'y' : 'x') : (vertical ? 'x' : 'y')
  return expression.updatePointer(event.pointerId, event, key.getBoundingClientRect(), axis,
    !!props.rotated && !vertical, props.settings.pressureMode !== 'position', 0.5, 0.25)
}
function down(event: PointerEvent, note: number) {
  if (props.settings.style === 'whites-blacks' && !isScaleNote(note)) return
  if ((event.pointerType !== 'touch' && event.button !== 0) || pointers.has(event.pointerId)) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  event.preventDefault()
  target.setPointerCapture(event.pointerId)
  pointers.set(event.pointerId, note)
  const velocity = pointerExpression(event, target)
  sendPressure()
  send(note, true, velocity, props.settings.style === 'glide-strip' ? bendAt(event, target) : undefined)
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
  const key = target && event.currentTarget.closest('.piano')?.contains(target) ? target : event.currentTarget
  const velocity = pointerExpression(event, key)
  sendPressure()
  if (key !== target || !target || target.dataset.note === undefined) return

  const newNote = Number(target.dataset.note)
  const currentNote = pointers.get(event.pointerId)
  
  if (currentNote === undefined || (props.settings.style === 'whites-blacks' && !isScaleNote(newNote))) return
  const bend = props.settings.style === 'glide-strip' ? bendAt(event, target) : undefined
  if (currentNote === newNote) {
    if (bend !== undefined) {
      repeat.update(newNote, (value) => ({ ...value, bend }))
      emit('output', { parameter: 'note', value: newNote, bend })
    }
    return
  }

  send(currentNote, false)
  pointers.set(event.pointerId, newNote)
  send(newNote, true, velocity, bend)
}
function keyDown(event: KeyboardEvent, note: number) {
  if (props.settings.style === 'whites-blacks' && !isScaleNote(note)) return
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
watch([() => props.settings.rootNote, () => props.settings.scale, () => props.settings.octaveTranspose, () => props.settings.octaves,
  () => props.settings.numRows, () => props.settings.style, () => props.settings.orientation, () => props.rotated], releaseAll, { flush: 'sync' })
onBeforeUnmount(releaseAll)
</script>

<template>
  <div ref="root" class="piano" :class="[settings.orientation, settings.style || 'pads']" :style="{ '--piano-color': settings.color, '--mpc-color': settings.color }"
    :aria-label="label" @touchstart.prevent @touchmove.prevent>
    <div v-for="(row, rowIndex) in rows" :key="rowIndex" class="key-row"
      :style="settings.style === 'whites-blacks' ? pianoRowStyle(row) : undefined">
      <button v-for="item in row" :key="item.index" type="button" class="key"
        :class="[
          { active: [...pointers.values()].includes(item.note) || keys.has(item.note) },
          (settings.style || 'pads') === 'pads' && 'mpc-surface',
          settings.style === 'whites-blacks' && (isWhiteKey(item.note) ? 'white' : 'black'),
          settings.style === 'pads' && !isWhiteKey(item.note) && 'black',
          settings.style === 'whites-blacks' && !isScaleNote(item.note) && 'out-of-scale'
        ]"
        :disabled="settings.style === 'whites-blacks' && !isScaleNote(item.note)"
        :aria-label="`${label} note ${noteName(layoutNote(item.note))}`" :data-note="item.note" :data-index="item.index"
        :style="settings.style === 'whites-blacks' ? pianoKeyStyle(row, item.note) : undefined"
        @pointerdown="down($event, item.note)" @pointerup="up" @pointermove="move" @pointercancel="up" @lostpointercapture="up"
        @keydown="keyDown($event, item.note)" @keyup="keyUp($event, item.note)" @blur="releaseKey(item.note)">
        <span>{{ noteName(layoutNote(item.note)) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.piano { width: 100%; height: 100%; display: flex; flex-direction: column; overflow: auto; touch-action: none; }
.key-row { display: flex; flex: 1 0 24px; min-height: 24px; }
.piano.vertical { flex-direction: row; }
.vertical .key-row { flex-direction: column-reverse; min-width: 24px; }
.key { flex: 1 0 24px; min-width: 24px; min-height: 24px; padding: 2px; touch-action: none; -webkit-tap-highlight-color: transparent; }
:where(.piano:not(.pads)) .key { border: 1px solid var(--piano-color); border-radius: 2px; background: color-mix(in srgb, var(--piano-color) 35%, #e2e8dd); color: #252820; }
:where(.piano:not(.pads)) .key.active { background: color-mix(in srgb, var(--piano-color) 65%, #e2e8dd); }
.key span { font-size: 9px; }
.pads { gap: 3px; padding: 3px; border-radius: 7px; background: #181a19; box-shadow: inset 0 1px 4px #000b; }
.pads .key-row { gap: 3px; }
.pads .key.black { --mpc-base: #1d201f; }
.whites-blacks .key-row { position: relative; }
.whites-blacks .key { position: absolute; min-width: 0; min-height: 0; overflow: hidden; }
.whites-blacks.horizontal .key { top: 0; height: 100%; }
.whites-blacks.vertical .key { left: 0; width: 100%; }
.whites-blacks .key.white { background: #fff; color: #000; }
.whites-blacks .key.black { z-index: 1; background: #222; color: #fff; }
.whites-blacks.horizontal .key.black { height: 62%; }
.whites-blacks.vertical .key.black { width: 62%; }
.whites-blacks .key.active { background: var(--piano-color); color: #000; }
.whites-blacks .key.out-of-scale { background: #a4a4a4; color: #444; }
.whites-blacks .key.black.out-of-scale { background: #555; color: #bbb; }
.glide-strip .key-row { background: linear-gradient(90deg, var(--piano-color), #e2e8dd); }
.glide-strip.vertical .key-row { background: linear-gradient(0deg, var(--piano-color), #e2e8dd); }
.glide-strip .key { border: 0; border-right: 1px solid #25282030; border-radius: 0; background: transparent; }
.glide-strip.vertical .key { border-right: 0; border-top: 1px solid #25282030; }
.glide-strip .key.active { background: #ffffff80; }
</style>
