<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { noteName, scales } from '../../music'
import { pointerTap } from '../../pointerTap'
import type { ArpeggiatorSettings, HeldNote, ParameterOutput } from '../../grid'
import type { TransportClock } from '../../sequencedLoop'

const props = defineProps<{ label: string; settings: ArpeggiatorSettings; bpm: number; notes: HeldNote[]; playing?: boolean; transportClock?: TransportClock }>()
const emit = defineEmits<{ output: [output: ParameterOutput]; toggle: [] }>()
const tap = pointerTap(() => emit('toggle'))
let currentActiveNote: number | null = null
let activeSource: number | null = null
let effectiveSettings = props.settings
let scheduledEnabled = effectiveSettings.enabled
let scheduledRate = effectiveSettings.rate
const button = ref<HTMLButtonElement | null>(null)
const statusText = ref<HTMLElement | null>(null)
const forwarded = new Map<number, HeldNote>()
let step = 0
let interval: number | undefined
let syncTimer: number | undefined
let releaseTimer: number | undefined
let generation = 0

function stepBeats() {
  const [numerator, denominator] = effectiveSettings.rate.split('/').map(Number)
  return 4 * numerator! / denominator!
}

function stepDuration() { return 60000 / props.bpm * stepBeats() }

function release() {
  if (releaseTimer !== undefined) window.clearTimeout(releaseTimer)
  releaseTimer = undefined
  if (currentActiveNote !== null) emit('output', { parameter: 'note', value: currentActiveNote, on: false, velocity: 100 })
  currentActiveNote = null
  updateDisplay()
  activeSource = null
}

function sendNote(note: number, on: boolean, velocity: number, bend?: number) {
  if (on) emit('output', { parameter: 'velocity', value: velocity })
  emit('output', { parameter: 'note', value: note, on, velocity, ...(bend === undefined ? {} : { bend }) })
}

function tick() {
  release()
  const notes = [...props.notes].sort((a, b) => a.note - b.note)
  if (!notes.length) return
  const { style, steps, distance, scale, gate } = effectiveSettings
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
  currentActiveNote = note
  activeSource = held.note
  sendNote(note, true, held.velocity, held.bend)
  releaseTimer = window.setTimeout(release, stepDuration() * gate)
  step++
  updateDisplay()
}

function stop() {
  generation++
  if (interval !== undefined) window.clearInterval(interval)
  if (syncTimer !== undefined) window.clearTimeout(syncTimer)
  interval = undefined
  syncTimer = undefined
  release()
}

function scheduleStep(beat: number) {
  const clock = props.transportClock
  if (!clock || !props.playing) return
  const scheduledGeneration = generation
  const delay = Math.max(0, (beat - clock.position()) * 60000 / props.bpm)
  syncTimer = window.setTimeout(() => {
    syncTimer = undefined
    const now = clock.position()
    if (now < beat) { scheduleStep(beat); return }
    tick()
    if (generation !== scheduledGeneration) return
    const duration = stepBeats()
    scheduleStep(beat + (Math.floor((now - beat) / duration) + 1) * duration)
  }, delay)
}

function restart() {
  stop()
  if (!effectiveSettings.enabled || !props.notes.length) return
  step = 0
  if (props.playing && props.transportClock) {
    const duration = stepBeats()
    scheduleStep(Math.ceil(props.transportClock.position() / duration) * duration)
  } else {
    tick()
    interval = window.setInterval(tick, stepDuration())
  }
}

function updateDisplay() {
  const enabled = effectiveSettings.enabled
  if (button.value) {
    button.value.setAttribute('aria-label', `${enabled ? 'Disable' : 'Enable'} ${props.label}`)
    button.value.setAttribute('aria-pressed', String(enabled))
  }
  if (statusText.value) {
    statusText.value.textContent = enabled
      ? props.notes.length ? `Note ${currentActiveNote === null ? '–' : noteName(currentActiveNote)}` : 'On'
      : 'Off'
  }
}

function setEffectiveSettings(settings: ArpeggiatorSettings) {
  const scheduleChanged = scheduledEnabled !== settings.enabled || scheduledRate !== settings.rate
  effectiveSettings = settings
  scheduledEnabled = settings.enabled
  scheduledRate = settings.rate
  updateDisplay()
  if (!scheduleChanged) return
  if (effectiveSettings.enabled) {
    syncForwarded([])
    if (!props.notes.length) { stop(); step = 0 }
    else restart()
  } else {
    stop()
    syncForwarded(props.notes)
  }
}
defineExpose({ setEffectiveSettings })

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

watch(() => props.settings, setEffectiveSettings, { deep: true, flush: 'sync' })
watch(
  [
    () => props.notes.map((note) => `${note.note}:${note.count}:${note.velocity}`).join(','),
    () => props.bpm,
    () => props.playing,
    () => props.transportClock,
  ],
  (current, previous) => {
    updateDisplay()
    if (effectiveSettings.enabled) {
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
  updateDisplay()
  if (!effectiveSettings.enabled) syncForwarded(props.notes)
  else if (currentActiveNote !== null && activeSource !== null) {
    const note = props.notes.find((entry) => entry.note === activeSource)
    if (note) emit('output', { parameter: 'note', value: currentActiveNote, bend: note.bend ?? 0 })
  }
}, { flush: 'sync' })
onMounted(updateDisplay)
onBeforeUnmount(() => { stop(); syncForwarded([]) })
</script>

<template>
  <button ref="button" type="button" class="arp" :style="{ '--arp-color': settings.color }"
    :aria-label="`${settings.enabled ? 'Disable' : 'Enable'} ${label}`" :aria-pressed="settings.enabled"
    @pointerdown="tap.down" @pointerup="tap.up"
    @pointercancel="tap.cancel" @lostpointercapture="tap.cancel" @click="tap.click">
    <strong>{{ label }}</strong>
    <span ref="statusText">{{ settings.enabled ? 'On' : 'Off' }}</span>
  </button>
</template>

<style scoped>
.arp { width: 100%; height: 100%; padding: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; overflow: hidden; border: 1px solid var(--arp-color); border-radius: 4px; background: color-mix(in srgb, var(--arp-color) 20%, #171816); color: #e2edd9; touch-action: none; }
.arp[aria-pressed="false"] { background: color-mix(in srgb, var(--arp-color) 7%, #171816); color: #a7a89f; }
.arp strong, .arp span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
</style>
