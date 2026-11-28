<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import * as Tone from 'tone'
import { noteName, scales } from '../../music'
import { pointerTap } from '../../pointerTap'
import type { ArpeggiatorSettings, HeldNote, ParameterOutput } from '../../grid'
import type { TransportClock } from '../../sequencedLoop'

const props = defineProps<{ label: string; settings: ArpeggiatorSettings; bpm: number; notes: HeldNote[]; playing?: boolean; transportClock?: TransportClock }>()
const emit = defineEmits<{ output: [output: ParameterOutput]; toggle: [] }>()
const tap = pointerTap(() => emit('toggle'))
const activeNote = ref<number | null>(null)
let activeSource: number | null = null
const forwarded = new Map<number, HeldNote>()
const sounding = new Map<number, { note: number; velocity: number }>()
let step = 0
let transportEvent: number | undefined
const releaseEvents = new Set<number>()
let freeClock: Tone.Clock | undefined
const freeReleaseClocks = new Set<Tone.Clock>()
let voiceSequence = 0
let activeVoice = 0

function stepBeats() {
  const [numerator, denominator] = props.settings.rate.split('/').map(Number)
  return 4 * numerator! / denominator!
}

function sendNote(note: number, on: boolean, velocity: number, bend?: number, time = Tone.immediate()) {
  if (on) emit('output', { parameter: 'velocity', value: velocity, time })
  emit('output', { parameter: 'note', value: note, on, velocity, time, ...(bend === undefined ? {} : { bend }) })
}

function playStep(time: number) {
  const notes = [...props.notes].sort((a, b) => a.note - b.note)
  if (!notes.length || !props.settings.enabled) return
  const { style, steps, distance, scale, gate } = props.settings
  const count = (steps + 1) * notes.length
  const period = Math.max(1, count * 2 - 2)
  let index = step % count
  if (style === 'down') index = Math.floor(index / notes.length) * notes.length + notes.length - 1 - index % notes.length
  else if (style === 'up-down') { const n = step % period; index = n < count ? n : period - n }
  else if (style === 'random') index = Math.floor(Math.random() * (step === 0 ? notes.length : count))
  const held = notes[index % notes.length]!
  const root = held.note
  let note = root + Math.floor(index / notes.length) * distance
  while (note < 127 && !scales[scale].includes(((note - root) % 12 + 12) % 12)) note++
  note = Math.max(0, Math.min(127, note))
  const voice = ++voiceSequence
  activeVoice = voice
  activeSource = held.note
  sounding.set(voice, { note, velocity: held.velocity })
  sendNote(note, true, held.velocity, held.bend, time)
  Tone.getDraw().schedule(() => { if (activeVoice === voice) activeNote.value = note }, time)
  const release = (releaseTime: number) => {
    const active = sounding.get(voice)
    if (!active) return
    sounding.delete(voice)
    sendNote(active.note, false, active.velocity, undefined, releaseTime)
    Tone.getDraw().schedule(() => { if (activeVoice === voice) activeNote.value = null }, releaseTime)
  }
  const delayBeats = stepBeats() * gate
  if (props.playing && props.transportClock) {
    const transport = Tone.getTransport()
    const beat = transport.getTicksAtTime(time) / transport.PPQ
    const ticks = Math.round((beat + delayBeats) * transport.PPQ)
    let event = -1
    event = transport.scheduleOnce((releaseTime) => {
      releaseEvents.delete(event)
      release(releaseTime)
    }, `${ticks}i`)
    releaseEvents.add(event)
  } else {
    let clock: Tone.Clock
    clock = new Tone.Clock((releaseTime) => {
      freeReleaseClocks.delete(clock)
      clock.dispose()
      release(releaseTime)
    }, 1)
    freeReleaseClocks.add(clock)
    clock.start(time + delayBeats * 60 / props.bpm)
  }
  step++
}

function scheduleTransportStep(beat: number) {
  const transport = Tone.getTransport()
  const ticks = Math.max(0, Math.round(beat * transport.PPQ))
  transportEvent = transport.scheduleOnce((time) => {
    transportEvent = undefined
    playStep(time)
    if (props.settings.enabled && props.notes.length && props.playing && props.transportClock) {
      scheduleTransportStep(beat + stepBeats())
    }
  }, `${ticks}i`)
}

function releaseAll(time = Tone.immediate()) {
  for (const note of sounding.values()) sendNote(note.note, false, note.velocity, undefined, time)
  sounding.clear()
  activeVoice = ++voiceSequence
  activeSource = null
  activeNote.value = null
}

function stop() {
  const transport = Tone.getTransport()
  if (transportEvent !== undefined) transport.clear(transportEvent)
  transportEvent = undefined
  for (const event of releaseEvents) transport.clear(event)
  releaseEvents.clear()
  freeClock?.dispose()
  freeClock = undefined
  for (const clock of freeReleaseClocks) clock.dispose()
  freeReleaseClocks.clear()
  releaseAll()
}

function restart() {
  stop()
  if (!props.settings.enabled || !props.notes.length) return
  step = 0
  if (props.playing && props.transportClock) {
    const transport = Tone.getTransport()
    const position = transport.getTicksAtTime(Tone.immediate()) / transport.PPQ
    scheduleTransportStep(Math.ceil(position / stepBeats()) * stepBeats())
  } else {
    freeClock = new Tone.Clock((time) => playStep(time), 1 / (stepBeats() * 60 / props.bpm))
    freeClock.start(Tone.immediate())
  }
}

function syncForwarded(notes: HeldNote[]) {
  const next = new Map(notes.map((note) => [note.note, note]))
  for (const [pitch, old] of forwarded) {
    const remaining = next.get(pitch)?.count ?? 0
    for (let count = remaining; count < old.count; count++) {
      sendNote(pitch, false, old.velocity)
    }
  }
  for (const [pitch, note] of next) {
    const previous = forwarded.get(pitch)?.count ?? 0
    for (let count = previous; count < note.count; count++) {
      sendNote(pitch, true, note.velocity, note.bend)
    }
    if (previous > 0 && forwarded.get(pitch)?.bend !== note.bend) {
      emit('output', { parameter: 'note', value: pitch, bend: note.bend ?? 0 })
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
    () => props.playing,
    () => props.transportClock,
  ],
  (current, previous) => {
    if (props.settings.enabled) {
      syncForwarded([])
      if (!props.notes.length) { stop(); step = 0 }
      else if (!previous?.[0] || current.slice(1).some((value, index) => value !== previous[index + 1])) restart()
    } else {
      stop()
      syncForwarded(props.notes)
    }
  },
  { immediate: true, flush: 'sync' },
)
watch(() => props.notes.map((note) => `${note.note}:${note.bend ?? 0}`).join(','), () => {
  if (!props.settings.enabled) syncForwarded(props.notes)
  else if (activeNote.value !== null && activeSource !== null) {
    const note = props.notes.find((entry) => entry.note === activeSource)
    if (note) emit('output', { parameter: 'note', value: activeNote.value, bend: note.bend ?? 0 })
  }
}, { flush: 'sync' })
onBeforeUnmount(() => { stop(); syncForwarded([]) })
</script>

<template>
  <button type="button" class="arp" :style="{ '--arp-color': settings.color }" :aria-label="`${settings.enabled ? 'Disable' : 'Enable'} ${label}`"
    :aria-pressed="settings.enabled" @pointerdown="tap.down" @pointerup="tap.up"
    @pointercancel="tap.cancel" @lostpointercapture="tap.cancel" @click="tap.click">
    <strong>{{ label }}</strong>
    <span>{{ settings.enabled ? (notes.length ? `Note ${activeNote === null ? '–' : noteName(activeNote)}` : 'On') : 'Off' }}</span>
  </button>
</template>

<style scoped>
.arp { width: 100%; height: 100%; padding: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; overflow: hidden; border: 1px solid var(--arp-color); border-radius: 4px; background: color-mix(in srgb, var(--arp-color) 20%, #171816); color: #e2edd9; touch-action: none; }
.arp[aria-pressed="false"] { background: color-mix(in srgb, var(--arp-color) 7%, #171816); color: #a7a89f; }
.arp strong, .arp span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
</style>
