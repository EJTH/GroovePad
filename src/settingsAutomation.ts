// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import { copyControl, validPianoRollSettings, type GridItem } from './grid'
import { inputs, rateModes, scales, tempoDivisions, waveforms, arpStyles } from './parameters'
import { PIANO_ROOT_NOTES } from './music'
import type { InjectionKey } from 'vue'

export const settingGestureKey: InjectionKey<(active: boolean) => void> = Symbol('setting-gesture')

interface Setting {
  id: string
  value: number
  continuous: boolean
  set: (value: number) => void
}

function settings(item: GridItem): Setting[] {
  const result: Setting[] = []
  const prefix = item.type === 'instrument-pad'
    ? `setting:${item.type}:${item.settings.instrumentType}:` : `setting:${item.type}:`
  function number(id: string, value: number, set: (value: number) => void, min: number, max: number, integer = false) {
    if (!Number.isFinite(value)) return
    result.push({ id: prefix + id, value, continuous: true, set: (next) => {
      if (!Number.isFinite(next)) return
      set(Math.max(min, Math.min(max, integer ? Math.round(next) : next)))
    } })
  }
  function choice<T extends string>(id: string, value: T, choices: readonly T[], set: (value: T) => void) {
    const index = choices.indexOf(value)
    if (index < 0) return
    result.push({ id: prefix + id, value: index, continuous: false, set: (next) => {
      const selected = choices[Math.round(next)]
      if (selected !== undefined) set(selected)
    } })
  }
  function boolean(id: string, value: boolean, set: (value: boolean) => void) {
    result.push({ id: prefix + id, value: value ? 1 : 0, continuous: false, set: (next) => set(next >= 0.5) })
  }

  if (item.type === 'instrument-pad') {
    const s = item.settings
    const params = s.instrumentParams
    choice('mode', s.mode, ['trigger', 'toggle'], (value) => { s.mode = value })
    for (const input of inputs(item)) {
      if (input.kind !== 'number' || input.choices || input.min === undefined || input.max === undefined) continue
      const [key, nested] = input.id.split('.')
      if (!key) continue
      const target: unknown = nested ? params[key] : params
      const property = nested ?? key
      if (typeof target !== 'object' || target === null) continue
      const value: unknown = Reflect.get(target, property)
      if (typeof value === 'number') number(input.id, value, (next) => { Reflect.set(target, property, next) }, input.min, input.max)
    }
    if (s.instrumentType === 'sample-hit' || s.instrumentType === 'sample-loop') {
      const start = s.instrumentType === 'sample-hit' ? 'start' : 'loopStart'
      const end = s.instrumentType === 'sample-hit' ? 'end' : 'loopEnd'
      number(start, params[start], (value) => { params[start] = value }, 0, 1)
      number(end, params[end], (value) => { params[end] = value }, 0, 1)
      const playback = ['random', 'order', 'loop', ...Array.from({ length: params.cuts.length + 1 }, (_, index) => `cut:${index}`)]
      choice('playback', params.playback, playback, (value) => {
        if (value === 'loop' && s.instrumentType === 'sample-loop') return
        params.playback = value
        if (s.instrumentType === 'sample-hit') params.loopMode = value === 'loop' ? (params.loopMode === 'back-and-forth' ? 'back-and-forth' : 'loop') : 'once'
      })
      if (s.instrumentType === 'sample-hit') {
        number('polyphony', params.polyphony, (value) => { params.polyphony = value }, 1, 16, true)
        boolean('reverse', params.reverse, (value) => { params.reverse = value })
        choice('loopMode', params.loopMode, ['once', 'loop', 'back-and-forth'], (value) => {
          if (params.playback === 'loop' && value !== 'once') params.loopMode = value
        })
      }
    } else if (s.instrumentType === '808' || s.instrumentType === '909') {
      choice('drum', params.drum, ['kick', 'snare', 'closed-hat', 'open-hat', 'rim', 'tom'], (value) => { params.drum = value })
    }
  } else if (item.type === 'tone-element' && item.settings.elementType === 'envelope') {
    const s = item.settings
    number('attack', s.attack, (value) => { s.attack = value }, 0.001, 5)
    number('decay', s.decay, (value) => { s.decay = value }, 0.01, 10)
    number('sustain', s.sustain, (value) => { s.sustain = value }, 0, 1)
    number('release', s.release, (value) => { s.release = value }, 0.01, 10)
  } else if (item.type === 'knob') {
    const s = item.settings
    number('min', s.min, (value) => { s.min = value }, -Number.MAX_VALUE, Number.MAX_VALUE)
    number('max', s.max, (value) => { s.max = value }, -Number.MAX_VALUE, Number.MAX_VALUE)
    number('value', s.value, (value) => { s.value = value }, -Number.MAX_VALUE, Number.MAX_VALUE)
    number('defaultValue', s.defaultValue, (value) => { s.defaultValue = value }, -Number.MAX_VALUE, Number.MAX_VALUE)
    number('step', s.step, (value) => { s.step = value }, Number.MIN_VALUE, Number.MAX_VALUE)
  } else if (item.type === 'lfo') {
    const s = item.settings
    choice('waveform', s.waveform, waveforms, (value) => { s.waveform = value })
    choice('rateMode', s.rateMode, rateModes, (value) => { s.rateMode = value })
    number('rate', s.rate, (value) => { s.rate = value }, 0.01, 20)
    number('depth', s.depth, (value) => { s.depth = value }, 0, 1)
    number('offset', s.offset, (value) => { s.offset = value }, -1, 1)
    number('smoothness', s.smoothness, (value) => { s.smoothness = value }, 0, 0.99)
  } else if (item.type === 'mod-wheel') {
    const s = item.settings
    number('depth', s.depth, (value) => { s.depth = value }, 0, 1)
    boolean('autoCenter', s.autoCenter, (value) => { s.autoCenter = value })
  } else if (item.type === 'piano-roll') {
    const s = item.settings
    number('octaves', s.octaves, (value) => { s.octaves = value }, 1, 3, true)
    number('numRows', s.numRows, (value) => { s.numRows = value }, 1, 8, true)
    number('octaveTranspose', s.octaveTranspose, (value) => { s.octaveTranspose = value }, -3, 3, true)
    choice('rootNote', s.rootNote, PIANO_ROOT_NOTES, (value) => { s.rootNote = value })
    choice('scale', s.scale, scales, (value) => { s.scale = value })
    choice('orientation', s.orientation, ['horizontal', 'vertical'], (value) => { s.orientation = value })
    choice('style', s.style, ['pads', 'whites-blacks', 'glide-strip'], (value) => { s.style = value })
    choice('pressureMode', s.pressureMode, ['position', 'pressure'], (value) => { s.pressureMode = value })
  } else if (item.type === 'arpeggiator') {
    const s = item.settings
    boolean('enabled', s.enabled, (value) => { s.enabled = value })
    choice('style', s.style, arpStyles, (value) => { s.style = value })
    choice('rate', s.rate, tempoDivisions, (value) => { s.rate = value })
    choice('scale', s.scale, scales, (value) => { s.scale = value })
    number('distance', s.distance, (value) => { s.distance = value }, -24, 24, true)
    number('steps', s.steps, (value) => { s.steps = value }, 0, 16, true)
    number('gate', s.gate, (value) => { s.gate = value }, 0.05, 1)
  }
  return result
}

export function captureSettings(item: GridItem) {
  return settings(item).map(({ id, value, continuous }) => ({ id, value, continuous }))
}

export function applySettingsAutomation(item: GridItem, values: ReadonlyMap<string, number>): GridItem {
  const copy = copyControl(item, item.id)
  for (const setting of settings(copy)) {
    const value = values.get(setting.id)
    if (value !== undefined) setting.set(value)
  }
  if (copy.type === 'knob') {
    const s = copy.settings
    if (s.min >= s.max) s.min = item.type === 'knob' ? item.settings.min : s.min
    if (s.min >= s.max) s.max = item.type === 'knob' ? item.settings.max : s.max
    s.step = Math.min(s.step, s.max - s.min)
    s.value = Math.max(s.min, Math.min(s.max, s.value))
    s.defaultValue = Math.max(s.min, Math.min(s.max, s.defaultValue))
  } else if (copy.type === 'piano-roll' && !validPianoRollSettings(copy.settings) && item.type === 'piano-roll') {
    const s = copy.settings
    const candidates = Array.from({ length: 8 }, (_, row) => row + 1)
      .flatMap((numRows) => Array.from({ length: 3 }, (_, octave) => octave + 1)
        .flatMap((octaves) => Array.from({ length: 7 }, (_, transpose) => ({ numRows, octaves, octaveTranspose: transpose - 3 }))))
      .sort((a, b) => (Math.abs(s.numRows - a.numRows) + Math.abs(s.octaves - a.octaves) + Math.abs(s.octaveTranspose - a.octaveTranspose)) -
        (Math.abs(s.numRows - b.numRows) + Math.abs(s.octaves - b.octaves) + Math.abs(s.octaveTranspose - b.octaveTranspose)))
    const nearest = candidates.find((candidate) => validPianoRollSettings({ ...s, ...candidate }))
    if (nearest) Object.assign(s, nearest)
  } else if (copy.type === 'instrument-pad' &&
    (copy.settings.instrumentType === 'sample-hit' || copy.settings.instrumentType === 'sample-loop')) {
    const params = copy.settings.instrumentParams
    const start = copy.settings.instrumentType === 'sample-hit' ? 'start' : 'loopStart'
    const end = copy.settings.instrumentType === 'sample-hit' ? 'end' : 'loopEnd'
    if (params[start] >= params[end]) params[start] = Math.max(0, params[end] - Number.EPSILON)
    if (params[start] >= params[end]) params[end] = Number.EPSILON
    params.cuts = params.cuts.filter((cut: number) => cut > params[start] && cut < params[end])
    if (typeof params.playback === 'string' && params.playback.startsWith('cut:') &&
      Number(params.playback.slice(4)) > params.cuts.length) params.playback = 'order'
  }
  return copy
}
