// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import { onBeforeUnmount, watch } from 'vue'
import * as Tone from 'tone'
import type { RepeatDivision } from '../grid'
import type { TransportClock } from '../sequencedLoop'

export function useNoteRepeat<T>(options: {
  division: () => RepeatDivision | undefined
  bpm: () => number
  playing: () => boolean | undefined
  clock: () => TransportClock | undefined
  send: (value: T, on: boolean, time?: number) => void
}) {
  const held = new Map<string | number, { value: T; count: number; sounding: number }>()
  const sounding = new Map<number, { key: string | number; value: T }>()
  const transport = Tone.getTransport()
  const releaseEvents = new Set<number>()
  let transportEvent: number | undefined
  let freeClock: Tone.Clock | undefined
  let freeGateClock: Tone.Clock | undefined
  let voiceSequence = 0
  let localBeat = 0
  let localStart = performance.now()
  let localTempo = options.bpm()

  function localPosition() {
    return localBeat + (performance.now() - localStart) * localTempo / 60000
  }
  function position() { return options.clock()?.repeatPosition() ?? localPosition() }
  function stepBeats() {
    const division = options.division()
    return division ? 4 / Number(division.slice(2)) : 0
  }
  function releaseVoices(time: number) {
    for (const [id, voice] of sounding) {
      sounding.delete(id)
      const note = held.get(voice.key)
      if (note) note.sounding = Math.max(0, note.sounding - 1)
      options.send(voice.value, false, time)
    }
  }
  function attack(time: number) {
    for (const [key, note] of held) {
      while (note.sounding < note.count) {
        note.sounding++
        const id = ++voiceSequence
        sounding.set(id, { key, value: note.value })
        options.send(note.value, true, time)
      }
    }
  }
  function releaseAfterStep(time: number) {
    const delay = stepBeats() * 0.8
    if (options.playing() && options.clock()) {
      const beat = transport.getTicksAtTime(time) / transport.PPQ
      const ticks = Math.round((beat + delay) * transport.PPQ)
      let event = -1
      event = transport.scheduleOnce((releaseTime) => {
        releaseEvents.delete(event)
        releaseVoices(releaseTime)
      }, `${ticks}i`)
      releaseEvents.add(event)
    } else {
      freeGateClock?.dispose()
      freeGateClock = new Tone.Clock((releaseTime) => {
        freeGateClock?.dispose()
        freeGateClock = undefined
        releaseVoices(releaseTime)
      }, 1)
      freeGateClock.start(time + delay * 60 / options.bpm())
    }
  }
  function step(time: number) {
    releaseVoices(time)
    attack(time)
    releaseAfterStep(time)
  }
  function scheduleTransportStep(beat: number) {
    const ticks = Math.max(0, Math.round(beat * transport.PPQ))
    transportEvent = transport.scheduleOnce((time) => {
      transportEvent = undefined
      step(time)
      if (held.size && options.division() && options.playing() && options.clock()) {
        scheduleTransportStep(beat + stepBeats())
      }
    }, `${ticks}i`)
  }
  function stopClocks(release = true) {
    if (transportEvent !== undefined) transport.clear(transportEvent)
    transportEvent = undefined
    for (const event of releaseEvents) transport.clear(event)
    releaseEvents.clear()
    freeClock?.dispose()
    freeClock = undefined
    freeGateClock?.dispose()
    freeGateClock = undefined
    if (release) releaseVoices(Tone.immediate())
  }
  function updateScheduler() {
    const division = options.division()
    stopClocks(!!division)
    if (!held.size) return
    if (!division) {
      attack(Tone.immediate())
      return
    }
    if (options.playing() && options.clock()) {
      const beat = transport.getTicksAtTime(Tone.immediate()) / transport.PPQ
      const duration = stepBeats()
      scheduleTransportStep(Math.ceil(beat / duration) * duration)
      return
    }
    const beat = position()
    const duration = stepBeats()
    const next = Math.ceil(beat / duration) * duration
    freeClock = new Tone.Clock((time) => step(time), 1 / (duration * 60 / options.bpm()))
    freeClock.start(Tone.immediate() + Math.max(0, next - beat) * 60 / options.bpm())
  }
  function change(key: string | number, value: T, on: boolean) {
    const previous = held.get(key)
    if (on) {
      const immediate = !options.division()
      const note = { value, count: (previous?.count ?? 0) + 1,
        sounding: (previous?.sounding ?? 0) + (immediate ? 1 : 0) }
      held.set(key, note)
      if (immediate) {
        const id = ++voiceSequence
        sounding.set(id, { key, value })
        options.send(value, true, Tone.immediate())
      }
    } else if (previous) {
      if (previous.sounding > 0) {
        const voice = [...sounding].find(([, entry]) => entry.key === key)
        if (voice) {
          sounding.delete(voice[0])
          options.send(previous.value, false, Tone.immediate())
          previous.sounding--
        }
      }
      if (--previous.count === 0) held.delete(key)
    }
    if (!previous || !held.size) updateScheduler()
  }
  function update(key: string | number, changeValue: (value: T) => T) {
    const note = held.get(key)
    if (!note) return
    note.value = changeValue(note.value)
    for (const voice of sounding.values()) if (voice.key === key) voice.value = note.value
  }
  watch(options.bpm, (bpm) => {
    localBeat = localPosition()
    localStart = performance.now()
    localTempo = bpm
    updateScheduler()
  }, { flush: 'sync' })
  watch([options.division, options.playing], ([division], [previousDivision]) => {
    if (division && !previousDivision) releaseVoices(Tone.immediate())
    updateScheduler()
  }, { flush: 'sync' })
  onBeforeUnmount(stopClocks)
  return { change, update }
}
