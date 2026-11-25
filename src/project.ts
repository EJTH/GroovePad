// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import { canResizeGrid, DEFAULT_GRID_COLOR, DEFAULT_PIANO_COLOR, isValidPlacement, LOOP_WIDGET_BUTTONS, MAX_LOOP_CLIP_INDEX, validPianoRollNoteRange, type Connection, type GridItem, type GridLayout } from './grid'
import { createsCycle, inputs, outputs, scales as scaleChoices, selectorConnectionsCompatible, selectorRoutingCompatible, tempoDivisions } from './parameters'
import { PIANO_ROOT_NOTES } from './music'
import type { SampleAsset } from './sampleAssets'
import { RECORDING_FORMATS, type RecordingFormat } from './audio/sessionRecording'
import type { SubGridPreset } from './presets'
import { AudioRouteError, validateAudioRoutes } from './audio/audioRoutes'

export const DEFAULT_INFO_SCROLL_SPEED = 20
export const MIN_INFO_SCROLL_SPEED = 1
export const MAX_INFO_SCROLL_SPEED = 100

export interface Bank {
  id: string
  title: string
  icon: string
  color: string
  layout: GridLayout
}

export interface SavedProject {
  version: 1
  bpm: number
  infoText?: string
  infoScrollSpeed?: number
  recordingFormat?: RecordingFormat
  banks: Bank[]
  selectedBankId: string
  assets?: SampleAsset[]
  subGridPresets?: SubGridPreset[]
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const within = (value: unknown, min: number, max: number): value is number => finite(value) && value >= min && value <= max
const integer = (value: unknown, min: number, max: number): value is number => within(value, min, max) && Number.isSafeInteger(value)
const color = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
const oneOf = (value: unknown, choices: string[]): boolean => typeof value === 'string' && choices.includes(value)

function validEnvelope(value: unknown): boolean {
  return object(value) && within(value.attack, 0.001, 1) && within(value.decay, 0.001, 2) &&
    within(value.sustain, 0, 1) && within(value.release, 0.01, 10)
}

function validSample(params: Record<string, unknown>, start: unknown, end: unknown, allowLoop = false): boolean {
  if (typeof params.sample !== 'string' || (params.sample !== '' && !/^data:[^,]*;base64,/.test(params.sample)) ||
    typeof params.sampleName !== 'string' ||
    !within(params.pitch, -12, 12) || !within(start, 0, 1) || !within(end, 0, 1) || start >= end ||
    !Array.isArray(params.cuts)) return false
  let previous = start
  for (const cut of params.cuts) {
    if (!finite(cut) || cut <= previous || cut >= end) return false
    previous = cut
  }
  if (params.playback === 'random' || params.playback === 'order') return true
  if (params.playback === 'loop') return allowLoop
  if (typeof params.playback !== 'string' || !/^cut:(0|[1-9]\d*)$/.test(params.playback)) return false
  return Number(params.playback.slice(4)) <= params.cuts.length
}

function validInstrument(settings: Record<string, unknown>): boolean {
  const params = settings.instrumentParams
  if (!color(settings.color) || !oneOf(settings.mode, ['trigger', 'toggle']) ||
    (settings.muted !== undefined && typeof settings.muted !== 'boolean') ||
    !object(params) || !within(params.volume, -48, 0) || !validEnvelope(params.envelope)) return false
  switch (settings.instrumentType) {
    case 'sample-hit':
      return validSample(params, params.start, params.end, true) &&
        oneOf(params.loopMode, ['once', 'loop', 'back-and-forth']) &&
        (params.playback === 'loop' ? params.loopMode !== 'once' : params.loopMode === 'once') &&
        typeof params.reverse === 'boolean' && integer(params.polyphony, 1, 16)
    case 'sample-loop':
      return validSample(params, params.loopStart, params.loopEnd)
    case '303':
      return within(params.transpose, -36, 36) && within(params.resonance, 0.1, 30) &&
        within(params.slideTime, 0, 0.5) && within(params.filterFrequency, 50, 5000) &&
        within(params.filterAmount, 0, 1) && validEnvelope(params.filterEnvelope)
    case '808':
    case '909':
      return oneOf(params.drum, ['kick', 'snare', 'closed-hat', 'open-hat', 'rim', 'tom']) &&
        within(params.pitch, 50, 300) && within(params.tonality, 0, 1) && within(params.tone, 0, 1)
    default: return false
  }
}

function isItem(value: unknown): value is GridItem {
  if (!object(value) || typeof value.id !== 'string' || !value.id || typeof value.label !== 'string' ||
    !value.label.trim() || !integer(value.x, 0, 7) || !integer(value.y, 0, 9) ||
    !integer(value.width, 1, 8) || !integer(value.height, 1, 10) ||
    (value.orientation !== undefined && !oneOf(value.orientation, ['horizontal', 'vertical'])) || !object(value.settings)) return false
  const s = value.settings
  switch (value.type) {
    case 'pad': return color(s.color)
    case 'instrument-pad': return validInstrument(s)
    case 'knob': return color(s.color) && finite(s.min) && finite(s.max) && s.min < s.max &&
      finite(s.step) && s.step > 0 && s.step <= s.max - s.min &&
      within(s.defaultValue, s.min, s.max) && within(s.value, s.min, s.max) && typeof s.unit === 'string' &&
      typeof s.recordAutomation === 'boolean'
    case 'lfo': return color(s.color) && oneOf(s.waveform, ['sine', 'saw', 'square', 'random']) &&
      oneOf(s.rateMode, ['free', 'sync']) && within(s.rate, 0.01, 20) &&
      within(s.depth, 0, 1) && within(s.offset, -1, 1) && within(s.smoothness, 0, 0.99)
    case 'mod-wheel': return within(s.depth, 0, 1) && typeof s.autoCenter === 'boolean' && typeof s.recordAutomation === 'boolean'
    case 'piano-roll': return color(s.color) && integer(s.octaves, 1, 3) && integer(s.octaveTranspose, -3, 3) &&
      oneOf(s.rootNote, [...PIANO_ROOT_NOTES]) &&
      oneOf(s.scale, [...scaleChoices]) &&
      oneOf(s.orientation, ['horizontal', 'vertical']) &&
      integer(s.numRows, 1, 8) && oneOf(s.style, ['pads', 'whites-blacks', 'glide-strip']) &&
      oneOf(s.pressureMode, ['pressure', 'position']) &&
      validPianoRollNoteRange(s.scale, s.rootNote, s.octaves, s.octaveTranspose, s.numRows, s.style)
    case 'arpeggiator': return color(s.color) && typeof s.enabled === 'boolean' && oneOf(s.style, ['up', 'down', 'up-down', 'random']) &&
      oneOf(s.rate, [...tempoDivisions]) && integer(s.distance, -24, 24) && integer(s.steps, 0, 16) &&
      within(s.gate, 0.05, 1) &&
      oneOf(s.scale, [...scaleChoices])
    case 'output-selector': return integer(s.index, 0, Number.MAX_SAFE_INTEGER) &&
      (s.baseIndex === undefined || integer(s.baseIndex, 0, Number.MAX_SAFE_INTEGER))
    case 'sequenced-loop': return color(s.color) && (s.volume === undefined || within(s.volume, 0, 1)) &&
      (s.muted === undefined || typeof s.muted === 'boolean') && integer(s.barLength, 1, 64) && integer(s.clipIndex, 0, MAX_LOOP_CLIP_INDEX) &&
      typeof s.armed === 'boolean' && (s.playing === undefined || typeof s.playing === 'boolean') &&
      typeof s.countIn === 'boolean' && typeof s.metronome === 'boolean' && oneOf(s.syncMode, ['immediate', 'sync']) &&
      (s.widgetButtons === undefined || (object(s.widgetButtons) && LOOP_WIDGET_BUTTONS.every((button) => typeof (s.widgetButtons as Record<string, unknown>)[button.id] === 'boolean'))) &&
      oneOf(s.quantize, ['off', '1/4', '1/8', '1/16', '1/32']) && oneOf(s.recordScope, ['bank', 'all']) && object(s.clips) &&
      (s.mutedRows === undefined || (object(s.mutedRows) && Object.entries(s.mutedRows).every(([index, rows]) =>
        /^(0|[1-9]\d{0,2})$/.test(index) && Number(index) <= MAX_LOOP_CLIP_INDEX && Array.isArray(rows) &&
        rows.every((row: unknown) => object(row) && (row.bankId === undefined || (typeof row.bankId === 'string' && !!row.bankId)) &&
          (row.kind === 'note' ? typeof row.instrumentId === 'string' && !!row.instrumentId && integer(row.note, 0, 127)
            : row.kind === 'automation' && typeof row.sourceId === 'string' && !!row.sourceId && typeof row.parameter === 'string' && !!row.parameter))))) &&
      Array.isArray(s.clips[String(s.clipIndex)]) &&
      object(s.automation) && Object.entries(s.automation).every(([index, events]) =>
        /^(0|[1-9]\d{0,2})$/.test(index) && Array.isArray(events) &&
        events.every((event: unknown) => object(event) && typeof event.sourceId === 'string' && !!event.sourceId &&
          (event.bankId === undefined || (typeof event.bankId === 'string' && !!event.bankId)) &&
          typeof event.parameter === 'string' && !!event.parameter && finite(event.value) &&
          (event.active === undefined || typeof event.active === 'boolean') &&
          finite(event.position) && event.position >= 0 && event.position < (s.barLength as number) * 4)) &&
      Object.entries(s.clips).every(([index, notes]) => /^(0|[1-9]\d{0,2})$/.test(index) &&
        Array.isArray(notes) && notes.every((note: unknown) => object(note) &&
          (note.bankId === undefined || (typeof note.bankId === 'string' && !!note.bankId)) &&
          typeof note.instrumentId === 'string' && !!note.instrumentId &&
          integer(note.note, 0, 127) && within(note.velocity, 0, 127) &&
          (note.bend === undefined || finite(note.bend)) &&
          within(note.position, 0, s.barLength as number * 4) && note.position < (s.barLength as number) * 4 &&
          finite(note.duration) && note.duration > 0 && note.duration <= (s.barLength as number) * 4))
    case 'sub-grid':
      return typeof s.layout === 'object' && s.layout !== null &&
        isLayout(s.layout) &&
        (s.presetId === undefined || (typeof s.presetId === 'string' && !!s.presetId)) &&
        Array.isArray(s.exposedPorts) &&
        s.exposedPorts.every((port: unknown) => object(port) &&
          typeof port.id === 'string' && !!port.id &&
          typeof port.name === 'string' && !!port.name &&
          oneOf(port.kind, ['audio', 'note', 'numeric']) &&
          oneOf(port.direction, ['input', 'output']) &&
          ((port.itemId === undefined && port.parameterId === undefined) ||
            (typeof port.itemId === 'string' && typeof port.parameterId === 'string' &&
              port.id !== 'audio' &&
              (() => {
                const item = (s.layout as GridLayout).items.find((entry) => entry.id === port.itemId)
                return !!item &&
                  (port.direction === 'input' ? inputs(item) : outputs(item))
                  .some((parameter) => parameter.id === port.parameterId && parameter.kind === (port.kind === 'numeric' ? 'number' : port.kind))
              })()))) &&
        new Set(s.exposedPorts.map((port: { id: string }) => port.id)).size === s.exposedPorts.length &&
        Array.isArray(s.surfaceItemIds) &&
        s.surfaceItemIds.every((id: unknown) => typeof id === 'string')
    case 'tone-element':
      return oneOf(s.elementType, ['oscillator', 'noise', 'filter', 'gain', 'delay', 'reverb', 'envelope', 'mixer']) &&
        color(s.color) && finite(s.frequency) && finite(s.detune) &&
        within(s.cutoff, 20, 20000) && within(s.gain, 0, 2) &&
        within(s.delayTime, 0, 5) && within(s.feedback, 0, 1) &&
        within(s.decay, 0.01, 10) && within(s.attack, 0.001, 5) &&
        within(s.sustain, 0, 1) &&
        within(s.release, 0.01, 10) &&
        (s.showVisualizer === undefined || typeof s.showVisualizer === 'boolean') &&
        (s.showKnobs === undefined || typeof s.showKnobs === 'boolean') &&
        oneOf(s.oscillatorType, ['sine', 'triangle', 'square', 'sawtooth']) &&
        oneOf(s.noiseType, ['white', 'pink', 'brown']) &&
        oneOf(s.noteMode, ['gated', 'continuous', 'always-on']) &&
        oneOf(s.notePriority, ['last', 'highest', 'lowest']) &&
        integer(s.polyphony, 1, 16) &&
        oneOf(s.audioFrom, ['auto', 'wires', 'bank-pre-fx', 'bank-post-fx', 'main-pre-fx', 'main-post-fx']) &&
        oneOf(s.audioTo, ['auto', 'wires', 'bank-out', 'main-out']) &&
        oneOf(s.routeMode, ['insert', 'parallel']) &&
        (s.mixerChannels === undefined || (object(s.mixerChannels) && Object.values(s.mixerChannels).every((channel) =>
          object(channel) && within(channel.volume, -60, 6) && within(channel.pan, -1, 1) && typeof channel.solo === 'boolean')))
    default: return false
  }
}

function isConnection(value: unknown): value is Connection {
  return object(value) && typeof value.id === 'string' && !!value.id &&
    typeof value.sourceId === 'string' && typeof value.sourceParameter === 'string' &&
    typeof value.targetId === 'string' && typeof value.targetParameter === 'string' &&
    (value.modulationAmount === undefined || within(value.modulationAmount, -100, 100)) &&
    (value.mappingMode === undefined || oneOf(value.mappingMode, ['mod', 'abs'])) &&
    (value.modulationMin === undefined || within(value.modulationMin, value.mappingMode === 'abs' ? 0 : -100, 100)) &&
    (value.modulationMax === undefined || within(value.modulationMax, value.mappingMode === 'abs' ? 0 : -100, 100)) &&
    (value.absoluteMin === undefined || finite(value.absoluteMin)) &&
    (value.absoluteMax === undefined || finite(value.absoluteMax)) &&
    ((value.absoluteMin === undefined && value.absoluteMax === undefined) ||
      (value.mappingMode === 'abs' && value.modulationMin === undefined && value.modulationMax === undefined)) &&
    (value.modulationAmount === undefined || (value.modulationMin === undefined && value.modulationMax === undefined && value.mappingMode === undefined))
}

function isLayout(value: unknown): value is GridLayout {
  if (!object(value) || !integer(value.columns, 1, 8) || !integer(value.rows, 1, 10) ||
    !Array.isArray(value.items) || !value.items.every(isItem) ||
    !Array.isArray(value.connections) || !value.connections.every(isConnection)) return false
  const layout: GridLayout = { columns: value.columns, rows: value.rows, items: value.items, connections: value.connections }
  if (!canResizeGrid(layout, layout.columns, layout.rows) ||
    new Set(layout.items.map((item) => item.id)).size !== layout.items.length ||
    !layout.items.every((item) => isValidPlacement(layout, item))) return false
  const seen: Connection[] = []
  for (const connection of layout.connections) {
    const source = layout.items.find((item) => item.id === connection.sourceId)
    const target = layout.items.find((item) => item.id === connection.targetId)
    if (!source || !target || !selectorConnectionsCompatible(layout.items, seen, connection) ||
      createsCycle(seen, connection.sourceId, connection.targetId) ||
      seen.some((entry) => entry.id === connection.id || (entry.sourceId === connection.sourceId &&
        entry.sourceParameter === connection.sourceParameter && entry.targetId === connection.targetId &&
        entry.targetParameter === connection.targetParameter))) return false
    seen.push(connection)
  }
  if (!selectorRoutingCompatible(layout)) return false
  try {
    validateAudioRoutes(layout)
  } catch (error) {
    if (error instanceof AudioRouteError) return false
    throw error
  }
  return true
}

export function migrateSavedProject(value: unknown): void {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.banks)) return
  if (value.bpm === undefined) value.bpm = 120
  function migrateLayout(layout: unknown) {
    if (!object(layout) || !Array.isArray(layout.items)) return
    for (const item of layout.items) {
      if (!object(item)) continue
      if (item.orientation === undefined) item.orientation = 'horizontal'
      if (item.type === 'sub-grid' && object(item.settings) && object(item.settings.layout)) {
        if (!Array.isArray(item.settings.exposedPorts)) item.settings.exposedPorts = []
        if (!Array.isArray(item.settings.surfaceItemIds)) item.settings.surfaceItemIds = []
        migrateLayout(item.settings.layout)
      }
      if (item.type === 'tone-element' && object(item.settings)) {
        if (item.settings.elementType === undefined) item.settings.elementType = 'oscillator'
        if (item.settings.color === undefined) item.settings.color = '#83c9bb'
        if (item.settings.frequency === undefined) item.settings.frequency = 440
        if (item.settings.detune === undefined) item.settings.detune = 0
        if (item.settings.cutoff === undefined) item.settings.cutoff = 1000
        if (item.settings.gain === undefined) item.settings.gain = 0.8
        if (item.settings.delayTime === undefined) item.settings.delayTime = 0.25
        if (item.settings.feedback === undefined) item.settings.feedback = 0.25
        if (item.settings.decay === undefined) item.settings.decay = 0.5
        if (item.settings.attack === undefined) item.settings.attack = 0.01
        if (item.settings.sustain === undefined) item.settings.sustain = 1
        if (item.settings.release === undefined) item.settings.release = 0.25
        if (item.settings.oscillatorType === undefined) item.settings.oscillatorType = 'sine'
        if (item.settings.noiseType === undefined) item.settings.noiseType = 'white'
        if (item.settings.noteMode === undefined) item.settings.noteMode = 'gated'
        if (item.settings.alwaysOn === true && item.settings.elementType === 'oscillator') item.settings.noteMode = 'always-on'
        delete item.settings.alwaysOn
        if (item.settings.notePriority === undefined) item.settings.notePriority = 'last'
        if (item.settings.polyphony === undefined) item.settings.polyphony = 1
        if (item.settings.audioFrom === undefined) item.settings.audioFrom = 'wires'
        if (item.settings.audioTo === undefined) item.settings.audioTo = 'wires'
        if (item.settings.routeMode === undefined) item.settings.routeMode = 'insert'
        if (item.settings.showVisualizer === undefined) item.settings.showVisualizer = true
        if (item.settings.showKnobs === undefined) item.settings.showKnobs = true
      }
    }
  }
  let armedLoopFound = false
  for (const bank of value.banks) {
    if (!object(bank) || !object(bank.layout) || !Array.isArray(bank.layout.items)) continue
    migrateLayout(bank.layout)
    for (const item of bank.layout.items) {
      if (object(item) && item.orientation === undefined) item.orientation = 'horizontal'
      if (object(item) && item.type === 'sequenced-loop' && item.label === 'Sequenced Loop') item.label = 'Loop sequencer'
      if (object(item) && (item.type === 'lfo' || item.type === 'arpeggiator' || item.type === 'sequenced-loop') &&
        object(item.settings) && item.settings.color === undefined) item.settings.color = DEFAULT_GRID_COLOR
      if (object(item) && (item.type === 'knob' || item.type === 'mod-wheel') &&
        object(item.settings) && item.settings.recordAutomation === undefined) item.settings.recordAutomation = true
      if (object(item) && item.type === 'sequenced-loop' && object(item.settings) && item.settings.automation === undefined) {
        item.settings.automation = {}
      }
      if (object(item) && item.type === 'sequenced-loop' && object(item.settings)) {
        if (item.settings.armed === true) {
          if (armedLoopFound) item.settings.armed = false
          else armedLoopFound = true
        }
        if (item.settings.countIn === undefined) item.settings.countIn = false
        if (item.settings.metronome === undefined) item.settings.metronome = false
      }
      if (object(item) && item.type === 'sequenced-loop' && object(item.settings) && item.settings.quantize === undefined) {
        item.settings.quantize = 'off'
      }
      if (object(item) && item.type === 'sequenced-loop' && object(item.settings) && item.settings.recordScope === undefined) {
        item.settings.recordScope = 'bank'
      }
      if (object(item) && item.type === 'instrument-pad' && object(item.settings) && item.settings.mode === undefined) {
        item.settings.mode = 'trigger'
      }
      if (object(item) && item.type === 'instrument-pad' && object(item.settings) &&
        (item.settings.instrumentType === 'sample-hit' || item.settings.instrumentType === 'sample-loop') &&
        object(item.settings.instrumentParams)) {
        const params = item.settings.instrumentParams
        if (typeof params.sample === 'string' && params.sample && !/^data:[^,]*;base64,/.test(params.sample)) {
          params.sample = ''
          params.sampleName = ''
        }
        if (params.sampleName === undefined) params.sampleName = ''
        if (params.cuts === undefined) params.cuts = []
        if (params.playback === undefined) params.playback = 'order'
        if (item.settings.instrumentType === 'sample-hit') {
          if (params.start === undefined) params.start = 0
          if (params.end === undefined) params.end = 1
          if (params.loopMode === undefined) params.loopMode = 'once'
          if (params.reverse === undefined) params.reverse = false
          if (params.polyphony === undefined) params.polyphony = 1
          if (params.loopMode === 'loop' || params.loopMode === 'back-and-forth') params.playback = 'loop'
        }
      }
      if (object(item) && item.type === 'instrument-pad' && object(item.settings) &&
        item.settings.instrumentType === '303' && object(item.settings.instrumentParams) &&
        item.settings.instrumentParams.transpose === undefined) {
        item.settings.instrumentParams.transpose = 0
      }
      if (object(item) && item.type === 'lfo' && object(item.settings) && item.settings.offset === undefined) {
        item.settings.offset = 0
      }
      if (object(item) && item.type === 'piano-roll' && object(item.settings)) {
        if (item.settings.scale === 'pentatonic') item.settings.scale = 'major-pentatonic'
        if (item.settings.color === undefined) item.settings.color = DEFAULT_PIANO_COLOR
        if (item.settings.numRows === undefined) item.settings.numRows = 1
        if (item.settings.style === undefined) item.settings.style = 'pads'
        const legacyTranspose = item.settings.transpose
        let migratedRoot: unknown = 'C'
        let migratedOctaveTranspose: unknown = legacyTranspose === undefined ? 0 : legacyTranspose
        if (typeof legacyTranspose === 'number' && Number.isSafeInteger(legacyTranspose) &&
          legacyTranspose >= -36 && legacyTranspose <= 36) {
          migratedRoot = PIANO_ROOT_NOTES[((legacyTranspose % 12) + 12) % 12]
          migratedOctaveTranspose = item.settings.style === 'whites-blacks'
            ? Math.trunc(legacyTranspose / 12)
            : Math.floor(legacyTranspose / 12)
        }
        if (item.settings.rootNote === undefined) {
          item.settings.rootNote = migratedRoot
        }
        if (item.settings.octaveTranspose === undefined) {
          item.settings.octaveTranspose = migratedOctaveTranspose
        }
        delete item.settings.transpose
        if (item.settings.pressureMode === undefined) item.settings.pressureMode = 'position'
      }
      if (object(item) && item.type === 'arpeggiator' && object(item.settings) &&
        finite(item.settings.rate) && item.settings.rate > 0) {
        const oldSeconds = 1 / item.settings.rate
        item.settings.rate = tempoDivisions.reduce((best, division) => {
          const duration = (value: string) => {
            const [numerator, denominator] = value.split('/').map(Number)
            return 2 * numerator! / denominator!
          }
          return Math.abs(duration(division) - oldSeconds) < Math.abs(duration(best) - oldSeconds) ? division : best
        })
      }
      if (object(item) && item.type === 'arpeggiator' && object(item.settings) &&
        item.settings.scale === 'pentatonic') {
        item.settings.scale = 'major-pentatonic'
      }
      if (object(item) && item.type === 'arpeggiator' && object(item.settings) && item.settings.enabled === undefined) {
        item.settings.enabled = true
      }
    }
  }
  if (Array.isArray(value.subGridPresets)) {
    for (const preset of value.subGridPresets) if (object(preset)) migrateLayout(preset.layout)
  }
}

export function isSavedProject(value: unknown): value is SavedProject {
  if (!object(value) || value.version !== 1 || typeof value.selectedBankId !== 'string' ||
    !within(value.bpm, 1, 300) || (value.infoText !== undefined && typeof value.infoText !== 'string') ||
    (value.infoScrollSpeed !== undefined && !within(value.infoScrollSpeed, MIN_INFO_SCROLL_SPEED, MAX_INFO_SCROLL_SPEED)) ||
    (value.recordingFormat !== undefined && !oneOf(value.recordingFormat, RECORDING_FORMATS.map((format) => format.id))) ||
    !Array.isArray(value.banks) || !value.banks.length) return false
  if (value.assets !== undefined && (!Array.isArray(value.assets) ||
    !value.assets.every((asset: unknown) => object(asset) && typeof asset.name === 'string' &&
      typeof asset.source === 'string' && /^data:[^,]*;base64,/.test(asset.source)) ||
    new Set(value.assets.map((asset: SampleAsset) => asset.source)).size !== value.assets.length)) return false
  if (value.subGridPresets !== undefined && (!Array.isArray(value.subGridPresets) ||
    !value.subGridPresets.every((preset: unknown) => object(preset) &&
      typeof preset.id === 'string' && !!preset.id &&
      typeof preset.name === 'string' && !!preset.name &&
      preset.schemaVersion === 1 && isLayout(preset.layout) &&
      Array.isArray(preset.assets) &&
      preset.assets.every((asset: unknown) => object(asset) &&
        typeof asset.name === 'string' && typeof asset.source === 'string')))) return false
  if (!value.banks.every((bank: unknown) => object(bank) && typeof bank.id === 'string' && !!bank.id &&
    typeof bank.title === 'string' && typeof bank.icon === 'string' && color(bank.color) && isLayout(bank.layout))) return false
  const ids = value.banks.map((bank: Bank) => bank.id)
  return new Set(ids).size === ids.length && ids.includes(value.selectedBankId)
}
