import type { InstrumentType } from './instruments/types'
import { InstrumentFactory } from './instruments'

export type GridItemType = 'pad' | 'knob' | 'lfo' | 'mod-wheel' | 'piano-roll' | 'arpeggiator' | 'instrument-pad'

interface GridItemBase {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
}

export interface PadSettings {
  color: string
}

export interface InstrumentPadSettings {
  color: string
  instrumentType: InstrumentType
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
}

export interface LfoSettings {
  waveform: 'sine' | 'saw' | 'square' | 'random'
  rateMode: 'free' | 'sync'
  rate: number
  depth: number
  offset: number
  smoothness: number
}

export interface ModWheelSettings { depth: number; autoCenter: boolean }
export type Scale = 'chromatic' | 'major' | 'minor' | 'pentatonic'
export type TempoDivision = '1/1' | '3/4' | '1/2' | '1/4' | '1/8' | '1/16' | '1/32'
export interface PianoRollSettings { color: string; octaves: number; transpose: number; scale: Scale; orientation: 'horizontal' | 'vertical' }
export interface ArpeggiatorSettings { enabled: boolean; style: 'up' | 'down' | 'up-down' | 'random'; rate: TempoDivision; distance: number; steps: number; gate: number; scale: Scale }
export interface HeldNote { note: number; velocity: number; count: number }

export type GridItem = GridItemBase & (
  | { type: 'pad'; settings: PadSettings }
  | { type: 'knob'; settings: KnobSettings }
  | { type: 'lfo'; settings: LfoSettings }
  | { type: 'mod-wheel'; settings: ModWheelSettings }
  | { type: 'piano-roll'; settings: PianoRollSettings }
  | { type: 'arpeggiator'; settings: ArpeggiatorSettings }
  | { type: 'instrument-pad'; settings: InstrumentPadSettings }
)

export interface ParameterOutput {
  parameter: string
  value: number
  on?: boolean
  velocity?: number
}

export const DEFAULT_PIANO_COLOR = '#b8d986'

export function createControl(id: string, x: number, y: number, type: GridItemType, instrumentType?: InstrumentType): GridItem {
  const base = { id, x, y, width: 1, height: 1 }
  switch (type) {
    case 'pad': return { ...base, type, label: 'Pad', settings: { color: '#b8d986' } }
    case 'knob': return { ...base, type, label: 'Knob', settings: { color: '#83c9bb', min: 0, max: 127, defaultValue: 64, value: 64, step: 1, unit: '' } }
    case 'lfo': return { ...base, type, label: 'LFO', settings: { waveform: 'sine', rateMode: 'free', rate: 1, depth: 1, offset: 0, smoothness: 0 } }
    case 'mod-wheel': return { ...base, type, label: 'Mod Wheel', settings: { depth: 1, autoCenter: false } }
    case 'piano-roll': return { ...base, type, label: 'Piano', settings: { color: DEFAULT_PIANO_COLOR, octaves: 1, transpose: 0, scale: 'chromatic', orientation: 'horizontal' } }
    case 'arpeggiator': return { ...base, type, label: 'Arpeggiator', settings: { enabled: true, style: 'up', rate: '1/8', distance: 12, steps: 4, gate: 0.5, scale: 'chromatic' } }
    case 'instrument-pad':
      const iType = instrumentType || 'sample-hit'
      return {
        ...base,
        type,
        label: `${iType} Pad`,
        settings: {
          color: '#ff6b9d',
          instrumentType: iType,
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
