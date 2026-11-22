import { canResizeGrid, DEFAULT_PIANO_COLOR, isValidPlacement, type Connection, type GridItem, type GridLayout } from './grid'
import { createsCycle, isCompatible, tempoDivisions } from './parameters'

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
  banks: Bank[]
  selectedBankId: string
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
  if (!color(settings.color) || !object(params) || !within(params.volume, -48, 0) || !validEnvelope(params.envelope)) return false
  switch (settings.instrumentType) {
    case 'sample-hit':
      return validSample(params, params.start, params.end, true) &&
        oneOf(params.loopMode, ['once', 'loop', 'back-and-forth']) &&
        (params.playback === 'loop' ? params.loopMode !== 'once' : params.loopMode === 'once') &&
        typeof params.reverse === 'boolean'
    case 'sample-loop':
      return validSample(params, params.loopStart, params.loopEnd)
    case '303':
      return within(params.transpose, -36, 36) && within(params.resonance, 0.1, 30) &&
        within(params.slideTime, 0, 0.5) && within(params.filterFrequency, 50, 5000) &&
        within(params.filterAmount, 0, 1) && validEnvelope(params.filterEnvelope)
    case '808':
      return oneOf(params.drum, ['kick', 'snare', 'closed-hat', 'open-hat', 'rim', 'tom']) &&
        within(params.pitch, 50, 300) && within(params.tonality, 0, 1) && within(params.tone, 0, 1)
    default: return false
  }
}

function isItem(value: unknown): value is GridItem {
  if (!object(value) || typeof value.id !== 'string' || !value.id || typeof value.label !== 'string' ||
    !value.label.trim() || !integer(value.x, 0, 7) || !integer(value.y, 0, 9) ||
    !integer(value.width, 1, 8) || !integer(value.height, 1, 10) || !object(value.settings)) return false
  const s = value.settings
  switch (value.type) {
    case 'pad': return color(s.color)
    case 'instrument-pad': return validInstrument(s)
    case 'knob': return color(s.color) && finite(s.min) && finite(s.max) && s.min < s.max &&
      finite(s.step) && s.step > 0 && s.step <= s.max - s.min &&
      within(s.defaultValue, s.min, s.max) && within(s.value, s.min, s.max) && typeof s.unit === 'string'
    case 'lfo': return oneOf(s.waveform, ['sine', 'saw', 'square', 'random']) &&
      oneOf(s.rateMode, ['free', 'sync']) && within(s.rate, 0.01, 20) &&
      within(s.depth, 0, 1) && within(s.offset, -1, 1) && within(s.smoothness, 0, 0.99)
    case 'mod-wheel': return within(s.depth, 0, 1) && typeof s.autoCenter === 'boolean'
    case 'piano-roll': return color(s.color) && integer(s.octaves, 1, 3) && integer(s.transpose, -36, 36) &&
      oneOf(s.scale, ['chromatic', 'major', 'minor', 'pentatonic']) && oneOf(s.orientation, ['horizontal', 'vertical'])
    case 'arpeggiator': return typeof s.enabled === 'boolean' && oneOf(s.style, ['up', 'down', 'up-down', 'random']) &&
      oneOf(s.rate, [...tempoDivisions]) && integer(s.distance, -24, 24) && integer(s.steps, 1, 16) &&
      within(s.gate, 0.05, 1) && oneOf(s.scale, ['chromatic', 'major', 'minor', 'pentatonic'])
    default: return false
  }
}

function isConnection(value: unknown): value is Connection {
  return object(value) && typeof value.id === 'string' && !!value.id &&
    typeof value.sourceId === 'string' && typeof value.sourceParameter === 'string' &&
    typeof value.targetId === 'string' && typeof value.targetParameter === 'string'
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
    if (!source || !target || !isCompatible(source, connection.sourceParameter, target, connection.targetParameter) ||
      createsCycle(seen, connection.sourceId, connection.targetId) ||
      seen.some((entry) => entry.id === connection.id || (entry.sourceId === connection.sourceId &&
        entry.sourceParameter === connection.sourceParameter && entry.targetId === connection.targetId &&
        entry.targetParameter === connection.targetParameter))) return false
    seen.push(connection)
  }
  return true
}

export function migrateSavedProject(value: unknown): void {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.banks)) return
  if (value.bpm === undefined) value.bpm = 120
  for (const bank of value.banks) {
    if (!object(bank) || !object(bank.layout) || !Array.isArray(bank.layout.items)) continue
    for (const item of bank.layout.items) {
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
      if (object(item) && item.type === 'piano-roll' && object(item.settings) && item.settings.color === undefined) {
        item.settings.color = DEFAULT_PIANO_COLOR
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
      if (object(item) && item.type === 'arpeggiator' && object(item.settings) && item.settings.enabled === undefined) {
        item.settings.enabled = true
      }
    }
  }
}

export function isSavedProject(value: unknown): value is SavedProject {
  if (!object(value) || value.version !== 1 || typeof value.selectedBankId !== 'string' ||
    !within(value.bpm, 1, 300) || !Array.isArray(value.banks) || !value.banks.length) return false
  if (!value.banks.every((bank: unknown) => object(bank) && typeof bank.id === 'string' && !!bank.id &&
    typeof bank.title === 'string' && typeof bank.icon === 'string' && color(bank.color) && isLayout(bank.layout))) return false
  const ids = value.banks.map((bank: Bank) => bank.id)
  return new Set(ids).size === ids.length && ids.includes(value.selectedBankId)
}
