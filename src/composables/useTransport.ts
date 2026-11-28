// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import { nextTick, onUnmounted, ref, watch, type Ref } from 'vue'
import * as Tone from 'tone'
import type { Bank } from '../project'
import { TransportClock } from '../sequencedLoop'
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
  const transport = Tone.getTransport()
  const transportClock = new TransportClock(() => Tone.immediate() * 1000,
    () => transport.getTicksAtTime(Tone.immediate()) / transport.PPQ)
  const beat = ref(0)
  let clickSynth: Tone.Synth | undefined
  let startingTransport = false
  let generation = 0

  function click(currentBeat: number, time: number) {
    try {
      clickSynth ??= new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.025, sustain: 0, release: 0.01 },
        volume: -14,
      }).connect(Tone.getContext().rawContext.destination)
      clickSynth.triggerAttackRelease(currentBeat % 4 === 0 ? 'C6' : 'G5', 0.03, time)
    } catch (error) {
      options.projectError.value = `Metronome audio failed: ${error instanceof Error ? error.message : String(error)}`
      console.error(options.projectError.value, error)
    }
  }

  function cancelClicks() {
    if (!clickSynth) return
    const time = Tone.immediate()
    clickSynth.envelope.cancel(time)
    clickSynth.triggerRelease(time)
  }

  const beatEvent = transport.scheduleRepeat((time) => {
    const currentBeat = Math.round(transport.getTicksAtTime(time) / transport.PPQ)
    if (metronomeEnabled.value) click(currentBeat, time)
    const scheduledGeneration = generation
    Tone.getDraw().schedule(() => {
      if (playing.value && generation === scheduledGeneration) beat.value = currentBeat % 4
    }, time)
  }, '4n')

  function beginPlayback(fromInput: boolean) {
    triggeredByInput.value = fromInput
    transport.bpm.setValueAtTime(options.bpm.value, Tone.immediate())
    transport.start(Tone.immediate(), 0)
    transportClock.start(options.bpm.value)
    playing.value = true
    beat.value = 0
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
      generation++
      transport.stop(Tone.immediate())
      cancelClicks()
      beat.value = 0
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
    transport.bpm.setValueAtTime(options.bpm.value, Tone.immediate())
  }, { flush: 'sync' })

  watch(metronomeEnabled, (enabled) => {
    if (!enabled) cancelClicks()
  }, { flush: 'sync' })

  onUnmounted(() => {
    generation++
    if (playing.value) transport.stop(Tone.immediate())
    transport.clear(beatEvent)
    clickSynth?.dispose()
  })

  return { playing, triggeredByInput, metronomeEnabled, transportClock, beat, togglePlayback, startFromInput }
}
