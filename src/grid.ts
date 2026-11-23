import type { InstrumentType } from './instruments/types'
import { InstrumentFactory } from './instruments'
import { PIANO_ROOT_NOTES, scaleNote, scales, type PianoRootNote } from './music'

export type GridItemType = 'pad' | 'knob' | 'lfo' | 'mod-wheel' | 'piano-roll' | 'arpeggiator' | 'instrument-pad' | 'output-selector' | 'sequenced-loop'

interface GridItemBase {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
  orientation?: 'horizontal' | 'vertical'
}

export interface PadSettings {
  color: string
}

export interface InstrumentPadSettings {
  color: string
  instrumentType: InstrumentType
  mode: 'trigger' | 'toggle'
  instrumentParams: Record<string, any>
}

export interface KnobSettings {
  color: string
  min: number
  max: number
  defaultValue: number
  value: number
  step: number
  unit: string
  recordAutomation: boolean
}

export interface LfoSettings {
  color: string
  waveform: 'sine' | 'saw' | 'square' | 'random'
  rateMode: 'free' | 'sync'
  rate: number
  depth: number
  offset: number
  smoothness: number
}

export interface ModWheelSettings { depth: number; autoCenter: boolean; recordAutomation: boolean }
export type Scale = 'chromatic' | 'major' | 'minor' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'locrian' | 'major-pentatonic' | 'minor-pentatonic' | 'blues'
export type TempoDivision = '1/1' | '3/4' | '1/2' | '1/4' | '1/8' | '1/16' | '1/32'
export type PianoRollStyle = 'pads' | 'whites-blacks' | 'glide-strip'
export interface PianoRollSettings { color: string; octaves: number; rootNote: PianoRootNote; octaveTranspose: number; scale: Scale; orientation: 'horizontal' | 'vertical'; numRows: number; style: PianoRollStyle; pressureMode: 'pressure' | 'position' }
export function validPianoRollNoteRange(scale: unknown, rootNote: unknown, octaves: unknown, octaveTranspose: unknown, numRows: unknown, style: unknown) {
  if (typeof scale !== 'string' || !Object.prototype.hasOwnProperty.call(scales, scale) ||
    typeof rootNote !== 'string' || !PIANO_ROOT_NOTES.includes(rootNote as PianoRootNote) ||
    typeof octaves !== 'number' || !Number.isSafeInteger(octaves) ||
    typeof octaveTranspose !== 'number' || !Number.isSafeInteger(octaveTranspose) ||
    typeof numRows !== 'number' || !Number.isSafeInteger(numRows)) return false
  const degreeCount = (style === 'whites-blacks' ? 12 : scales[scale as Scale].length) * octaves * numRows
  if (degreeCount < 1) return false
  const lastNoteOffset = style === 'whites-blacks'
    ? degreeCount - 1
    : scaleNote(scale as Scale, degreeCount - 1, rootNote as PianoRootNote)
  const firstNote = 48 + octaveTranspose * 12 + (style === 'whites-blacks' ? 0 : PIANO_ROOT_NOTES.indexOf(rootNote as PianoRootNote))
  return firstNote >= 0 && firstNote + lastNoteOffset <= 127
}

export function validPianoRollSettings(settings: PianoRollSettings) {
  return Number.isSafeInteger(settings.numRows) && settings.numRows >= 1 && settings.numRows <= 8 &&
    Number.isSafeInteger(settings.octaves) && settings.octaves >= 1 && settings.octaves <= 3 &&
    Number.isSafeInteger(settings.octaveTranspose) && settings.octaveTranspose >= -3 && settings.octaveTranspose <= 3 &&
    ['pads', 'whites-blacks', 'glide-strip'].includes(settings.style) &&
    validPianoRollNoteRange(settings.scale, settings.rootNote, settings.octaves, settings.octaveTranspose, settings.numRows, settings.style)
}
export interface ArpeggiatorSettings { color: string; enabled: boolean; style: 'up' | 'down' | 'up-down' | 'random'; rate: TempoDivision; distance: number; steps: number; gate: number; scale: Scale }
export interface HeldNote { note: number; velocity: number; count: number; bend?: number }
export interface OutputSelectorSettings { index: number; baseIndex?: number }
export interface LoopNote { bankId?: string; instrumentId: string; note: number; velocity: number; bend?: number; position: number; duration: number }
export interface LoopAutomation { bankId?: string; sourceId: string; parameter: string; value: number; active?: boolean; position: number }
export type LoopQuantize = 'off' | '1/4' | '1/8' | '1/16' | '1/32'
export const MAX_LOOP_CLIP_INDEX = 15
export interface SequencedLoopSettings {
  color: string
  barLength: number
  clipIndex: number
  armed: boolean
  countIn: boolean
  metronome: boolean
  syncMode: 'immediate' | 'sync'
  quantize: LoopQuantize
  recordScope: 'bank' | 'all'
  clips: Record<string, LoopNote[]>
  automation: Record<string, LoopAutomation[]>
}

export type GridItem = GridItemBase & (
  | { type: 'pad'; settings: PadSettings }
  | { type: 'knob'; settings: KnobSettings }
  | { type: 'lfo'; settings: LfoSettings }
  | { type: 'mod-wheel'; settings: ModWheelSettings }
  | { type: 'piano-roll'; settings: PianoRollSettings }
  | { type: 'arpeggiator'; settings: ArpeggiatorSettings }
  | { type: 'instrument-pad'; settings: InstrumentPadSettings }
  | { type: 'output-selector'; settings: OutputSelectorSettings }
  | { type: 'sequenced-loop'; settings: SequencedLoopSettings }
)

export interface ParameterOutput {
  parameter: string
  value: number
  delta?: number
  active?: boolean
  on?: boolean
  velocity?: number
  bend?: number
  user?: boolean
  pointer?: boolean
}

export const DEFAULT_GRID_COLOR = '#b8d986'
export const DEFAULT_PIANO_COLOR = DEFAULT_GRID_COLOR

export function createControl(id: string, x: number, y: number, type: GridItemType, instrumentType?: InstrumentType): GridItem {
  const base = { id, x, y, width: 1, height: 1, orientation: 'horizontal' as const }
  switch (type) {
    case 'pad': return { ...base, type, label: 'Pad', settings: { color: '#b8d986' } }
    case 'knob': return { ...base, type, label: 'Knob', settings: { color: '#83c9bb', min: 0, max: 127, defaultValue: 64, value: 64, step: 1, unit: '', recordAutomation: true } }
    case 'lfo': return { ...base, type, label: 'LFO', settings: { color: DEFAULT_GRID_COLOR, waveform: 'sine', rateMode: 'free', rate: 1, depth: 1, offset: 0, smoothness: 0 } }
    case 'mod-wheel': return { ...base, type, label: 'Mod Wheel', settings: { depth: 1, autoCenter: false, recordAutomation: true } }
    case 'piano-roll': return { ...base, type, label: 'Piano', settings: { color: DEFAULT_PIANO_COLOR, octaves: 1, rootNote: 'C', octaveTranspose: 0, scale: 'chromatic', orientation: 'horizontal', numRows: 1, style: 'pads', pressureMode: 'position' } }
    case 'arpeggiator': return { ...base, type, label: 'Arpeggiator', settings: { color: DEFAULT_GRID_COLOR, enabled: true, style: 'up', rate: '1/8', distance: 12, steps: 0, gate: 0.5, scale: 'chromatic' } }
    case 'output-selector': return { ...base, type, label: 'Output Selector', settings: { index: 0 } }
    case 'sequenced-loop': return { ...base, type, label: 'Loop sequencer', settings: { color: DEFAULT_GRID_COLOR, barLength: 1, clipIndex: 0, armed: false, countIn: false, metronome: false, syncMode: 'sync', quantize: 'off', recordScope: 'bank', clips: { 0: [] }, automation: { 0: [] } } }
    case 'instrument-pad':
      const iType = instrumentType || 'sample-hit'
      return {
        ...base,
        type,
        label: `${iType} Pad`,
        settings: {
          color: '#ff6b9d',
          instrumentType: iType,
          mode: 'trigger',
          instrumentParams: InstrumentFactory.getDefaultParams(iType),
        },
      }
  }
}

export interface Connection {
  id: string
  sourceId: string
  sourceParameter: string
  targetId: string
  targetParameter: string
  modulationAmount?: number
  modulationMin?: number
  modulationMax?: number
  mappingMode?: 'mod' | 'abs'
  absoluteMin?: number
  absoluteMax?: number
}

export interface GridLayout {
  columns: number
  rows: number
  items: GridItem[]
  connections: Connection[]
}

export const MAX_GRID_COLUMNS = 8
export const MAX_GRID_ROWS = 10

export function isValidPlacement(layout: GridLayout, candidate: GridItem): boolean {
  const { x, y, width, height } = candidate
  if (
    ![x, y, width, height].every(Number.isSafeInteger) ||
    x < 0 || y < 0 || width < 1 || height < 1 ||
    x + width > layout.columns || y + height > layout.rows
  ) return false

  return layout.items.every((item) =>
    item.id === candidate.id ||
    x + width <= item.x || item.x + item.width <= x ||
    y + height <= item.y || item.y + item.height <= y,
  )
}

function deepCopyInstrumentParams(params: Record<string, any>): Record<string, any> {
  const copy: Record<string, any> = {}
  for (const key in params) {
    const value = params[key]
    if (Array.isArray(value)) {
      copy[key] = [...value]
    } else if (value && typeof value === 'object') {
      copy[key] = { ...value }
    } else {
      copy[key] = value
    }
  }
  return copy
}

export function copyControl(item: GridItem, id: string): GridItem {
  switch (item.type) {
    case 'pad': return { ...item, id, settings: { ...item.settings } }
    case 'knob': return { ...item, id, settings: { ...item.settings } }
    case 'lfo': return { ...item, id, settings: { ...item.settings } }
    case 'mod-wheel': return { ...item, id, settings: { ...item.settings } }
    case 'piano-roll': return { ...item, id, settings: { ...item.settings } }
    case 'arpeggiator': return { ...item, id, settings: { ...item.settings } }
    case 'output-selector': return { ...item, id, settings: { ...item.settings } }
    case 'sequenced-loop': return { ...item, id, settings: { ...item.settings,
      clips: Object.fromEntries(Object.entries(item.settings.clips).map(([index, notes]) => [index, notes.map((note) => ({ ...note }))])),
      automation: Object.fromEntries(Object.entries(item.settings.automation).map(([index, events]) => [index, events.map((event) => ({ ...event }))])) } }
    case 'instrument-pad': return { ...item, id, settings: { ...item.settings, instrumentParams: deepCopyInstrumentParams(item.settings.instrumentParams) } }
  }
}

export function canSwapItems(layout: GridLayout, first: GridItem, second: GridItem): boolean {
  if (first.id === second.id) return false
  const remaining = layout.items.filter((item) => item.id !== first.id && item.id !== second.id)
  const movedFirst = { ...first, x: second.x, y: second.y }
  const movedSecond = { ...second, x: first.x, y: first.y }
  const temporary = { ...layout, items: remaining }
  return isValidPlacement(temporary, movedFirst) &&
    isValidPlacement({ ...temporary, items: [...remaining, movedFirst] }, movedSecond)
}

export function canResizeGrid(layout: GridLayout, columns: number, rows: number): boolean {
  return Number.isSafeInteger(columns) && columns > 0 && columns <= MAX_GRID_COLUMNS &&
    Number.isSafeInteger(rows) && rows > 0 && rows <= MAX_GRID_ROWS &&
    layout.items.every((item) => item.x + item.width <= columns && item.y + item.height <= rows)
}
