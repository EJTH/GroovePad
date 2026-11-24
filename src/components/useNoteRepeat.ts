// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import { onBeforeUnmount, watch } from 'vue'
import type { RepeatDivision } from '../grid'
import type { TransportClock } from '../sequencedLoop'

export function useNoteRepeat<T>(options: {
  division: () => RepeatDivision | undefined
  bpm: () => number
  playing: () => boolean | undefined
  clock: () => TransportClock | undefined
  send: (value: T, on: boolean) => void
}) {
  const held = new Map<string | number, { value: T; count: number; sounding: number }>()
  let timer: ReturnType<typeof setInterval> | undefined
  let attackTimer: ReturnType<typeof setTimeout> | undefined
  let localBeat = 0
  let localStart = performance.now()
  let localTempo = options.bpm()
  let lastStep = -1

  function localPosition() { return localBeat + (performance.now() - localStart) * localTempo / 60000 }
  function position() { return options.clock()?.repeatPosition() ?? localPosition() }
  function phase() {
    const division = options.division()
    return division ? position() * Number(division.slice(2)) / 4 : -1
  }
  function release() {
    for (const note of held.values()) {
      for (let i = 0; i < note.sounding; i++) options.send(note.value, false)
      note.sounding = 0
    }
  }
  function attack() {
    attackTimer = undefined
    for (const note of held.values()) {
      while (note.sounding < note.count) { options.send(note.value, true); note.sounding++ }
    }
  }
  function tick() {
    const current = phase()
    if (current < 0) return
    const currentStep = Math.floor(current)
    if (currentStep !== lastStep) {
      lastStep = currentStep
      const needsGap = [...held.values()].some((note) => note.sounding > 0)
      if (needsGap) {
        release()
        attackTimer = setTimeout(attack, 0)
      } else attack()
    } else if (current - currentStep >= 0.8 && attackTimer === undefined) {
      release()
    }
  }
  function updateTimer() {
    if (timer !== undefined) clearInterval(timer)
    if (attackTimer !== undefined) clearTimeout(attackTimer)
    timer = undefined
    attackTimer = undefined
    lastStep = Math.floor(phase())
    if (!options.division()) attack()
    if (held.size && options.division()) timer = setInterval(tick, 8)
  }
  function change(key: string | number, value: T, on: boolean) {
    const previous = held.get(key)
    if (on) {
      const immediate = !options.division()
      held.set(key, { value, count: (previous?.count ?? 0) + 1, sounding: (previous?.sounding ?? 0) + (immediate ? 1 : 0) })
      if (immediate) options.send(value, true)
    } else if (previous) {
      if (previous.sounding > 0) { options.send(value, false); previous.sounding-- }
      if (--previous.count === 0) held.delete(key)
    }
    if (!previous || !held.size) updateTimer()
  }
  function update(key: string | number, changeValue: (value: T) => T) {
    const note = held.get(key)
    if (note) note.value = changeValue(note.value)
  }
  watch(options.bpm, (bpm) => {
    localBeat = localPosition()
    localStart = performance.now()
    localTempo = bpm
  }, { flush: 'sync' })
  watch([options.division, options.playing], ([division], [previousDivision]) => {
    if (division && !previousDivision) release()
    updateTimer()
  }, { flush: 'sync' })
  onBeforeUnmount(() => {
    if (timer !== undefined) clearInterval(timer)
    if (attackTimer !== undefined) clearTimeout(attackTimer)
  })
  return { change, update }
}
