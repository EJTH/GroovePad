// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import { nextTick, onUnmounted, ref, watch, type Ref } from 'vue'
import * as Tone from 'tone'
import type { Bank } from '../project'
import { Metronome, TransportClock } from '../sequencedLoop'
import { gridScopes, sameBankScope } from '../grid'

export function useTransport(options: {
  banks: Ref<Bank[]>
  bpm: Ref<number>
  editing: Ref<boolean>
  projectError: Ref<string>
}) {
  const playing = ref(false)
  const triggeredByInput = ref(false)
  const metronomeEnabled = ref(false)
  const transportClock = new TransportClock()
  const beat = ref(0)
  let beatTimer: number | undefined
  let metronomeTimer: number | undefined
  let clickSynth: Tone.Synth | undefined
  let startingTransport = false

  const metronome = new Metronome((currentBeat) => {
    try {
      clickSynth ??= new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.025, sustain: 0, release: 0.01 },
        volume: -14,
      }).connect(Tone.getContext().rawContext.destination)
      clickSynth.triggerAttackRelease(currentBeat % 4 === 0 ? 'C6' : 'G5', 0.03)
    } catch (error) {
      options.projectError.value = `Metronome audio failed: ${error instanceof Error ? error.message : String(error)}`
      console.error(options.projectError.value, error)
    }
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

  function clearMetronomeTimer() {
    if (metronomeTimer !== undefined) window.clearTimeout(metronomeTimer)
    metronomeTimer = undefined
  }

  function scheduleMetronome(lastBeat?: number) {
    if (!playing.value || !metronomeEnabled.value) return
    const position = transportClock.position()
    const remaining = (lastBeat ?? Math.floor(position)) + 1 - position
    metronomeTimer = window.setTimeout(tickMetronome, Math.max(1, Math.ceil(remaining * 60000 / options.bpm.value)))
  }

  function tickMetronome() {
    metronomeTimer = undefined
    if (!playing.value || !metronomeEnabled.value) return
    const position = transportClock.position()
    metronome.tick(position, true)
    scheduleMetronome(Math.floor(position))
  }

  function beginPlayback(fromInput: boolean) {
    triggeredByInput.value = fromInput
    metronome.reset()
    transportClock.start(options.bpm.value)
    playing.value = true
    if (metronomeEnabled.value) tickMetronome()
    beat.value = 0
    updateBeatTimer()
  }

  async function startFromInput(bankId: string): Promise<boolean> {
    if (playing.value) return true
    if (startingTransport || options.editing.value || !gridScopes(options.banks.value).some((bank) =>
      bank.layout.items.some((item) => item.type === 'sequenced-loop' && item.settings.armed &&
        (sameBankScope(options.banks.value, bank.id, bankId) || item.settings.recordScope === 'all')))) return false
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
    if (playing.value) {
      playing.value = false
      transportClock.stop()
      clearMetronomeTimer()
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
    beginPlayback(false)
  }

  watch(options.bpm, () => {
    transportClock.setTempo(options.bpm.value)
    updateBeatTimer()
    clearMetronomeTimer()
    if (playing.value && metronomeEnabled.value) tickMetronome()
  }, { flush: 'sync' })

  watch(metronomeEnabled, (enabled) => {
    clearMetronomeTimer()
    if (playing.value && enabled) {
      metronome.tick(transportClock.position(), false)
      scheduleMetronome()
    }
  }, { flush: 'sync' })

  onUnmounted(() => {
    if (beatTimer !== undefined) window.clearInterval(beatTimer)
    clearMetronomeTimer()
    clickSynth?.dispose()
  })

  return { playing, triggeredByInput, metronomeEnabled, transportClock, beat, togglePlayback, startFromInput }
}
