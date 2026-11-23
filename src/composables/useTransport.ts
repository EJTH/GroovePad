import { nextTick, onUnmounted, ref, watch, type Ref } from 'vue'
import * as Tone from 'tone'
import type { Bank } from '../project'
import { BankEventBus, Metronome, TransportClock } from '../sequencedLoop'

export function useTransport(options: {
  banks: Ref<Bank[]>
  bpm: Ref<number>
  editing: Ref<boolean>
  projectError: Ref<string>
  bankEvents: BankEventBus
}) {
  const playing = ref(false)
  const countingIn = ref(false)
  const triggeredByInput = ref(false)
  const transportClock = new TransportClock()
  const beat = ref(0)
  let beatTimer: number | undefined
  let metronomeTimer: number | undefined
  let countInTimer: number | undefined
  let clickSynth: Tone.Synth | undefined
  let startingTransport = false

  const metronome = new Metronome((currentBeat) => {
    try {
      clickSynth ??= new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.025, sustain: 0, release: 0.01 },
        volume: -14,
      }).toDestination()
      clickSynth.triggerAttackRelease(currentBeat % 4 === 0 ? 'C6' : 'G5', 0.03)
    } catch (error) {
      options.projectError.value = `Metronome audio failed: ${error instanceof Error ? error.message : String(error)}`
      console.error(options.projectError.value, error)
    }
  })

  const unsubscribeClicks = options.bankEvents.subscribe((event) => {
    if (event.kind === 'count-in-click' && playing.value) metronome.click(event.beat)
  })

  function updateBeatTimer() {
    if (beatTimer !== undefined) window.clearInterval(beatTimer)
    if (playing.value) {
      beatTimer = window.setInterval(() => {
        beat.value = (beat.value + 1) % 4
      }, 60000 / options.bpm.value)
    } else {
      beatTimer = undefined
      beat.value = 0
    }
  }

  function tickMetronome() {
    const enabled = options.banks.value.some((bank) => bank.layout.items.some((item) =>
      item.type === 'sequenced-loop' && item.settings.armed && item.settings.metronome))
    metronome.tick(transportClock.position(), enabled)
  }

  function beginPlayback(fromInput: boolean) {
    triggeredByInput.value = fromInput
    metronome.reset()
    transportClock.start(options.bpm.value)
    playing.value = true
    tickMetronome()
    metronomeTimer = window.setInterval(tickMetronome, 20)
    beat.value = 0
    updateBeatTimer()
  }

  async function startFromInput(bankId: string): Promise<boolean> {
    if (playing.value) return true
    if (startingTransport || countingIn.value || options.editing.value || !options.banks.value.some((bank) =>
      bank.layout.items.some((item) => item.type === 'sequenced-loop' && item.settings.armed &&
        (bank.id === bankId || item.settings.recordScope === 'all')))) return false
    startingTransport = true
    try {
      await Tone.start()
      beginPlayback(true)
      await nextTick()
      return true
    } catch (error) {
      options.projectError.value = `Audio could not be started: ${error instanceof Error ? error.message : String(error)}`
      console.error(options.projectError.value, error)
      return false
    } finally { startingTransport = false }
  }

  async function togglePlayback() {
    if (startingTransport) return
    if (playing.value || countingIn.value) {
      playing.value = false
      countingIn.value = false
      transportClock.stop()
      if (metronomeTimer !== undefined) window.clearInterval(metronomeTimer)
      if (countInTimer !== undefined) window.clearInterval(countInTimer)
      metronomeTimer = undefined
      countInTimer = undefined
      beat.value = 0
      updateBeatTimer()
      return
    }
    startingTransport = true
    try {
      await Tone.start()
    } catch (error) {
      options.projectError.value = `Audio could not be started: ${error instanceof Error ? error.message : String(error)}`
      console.error(options.projectError.value, error)
      return
    } finally { startingTransport = false }
    const countIn = options.banks.value.some((bank) => bank.layout.items.some((item) =>
      item.type === 'sequenced-loop' && item.settings.armed && item.settings.countIn))
    if (!countIn) { beginPlayback(false); return }
    countingIn.value = true
    metronome.reset()
    transportClock.start(options.bpm.value)
    metronome.click(0)
    countInTimer = window.setInterval(() => {
      const position = transportClock.position()
      if (position >= 4) {
        window.clearInterval(countInTimer)
        countInTimer = undefined
        countingIn.value = false
        beginPlayback(false)
      } else {
        beat.value = Math.floor(position)
        metronome.click(beat.value)
      }
    }, 20)
  }

  watch(options.bpm, () => {
    transportClock.setTempo(options.bpm.value)
    updateBeatTimer()
  }, { flush: 'sync' })

  onUnmounted(() => {
    if (beatTimer !== undefined) window.clearInterval(beatTimer)
    if (metronomeTimer !== undefined) window.clearInterval(metronomeTimer)
    if (countInTimer !== undefined) window.clearInterval(countInTimer)
    unsubscribeClicks()
    clickSynth?.dispose()
  })

  return { playing, countingIn, triggeredByInput, transportClock, beat, togglePlayback, startFromInput }
}
