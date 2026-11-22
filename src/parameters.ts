import type { Connection, GridItem } from './grid'

export interface ParameterMetadata {
  id: string
  label: string
  kind: 'number' | 'note'
  min?: number
  max?: number
  choices?: readonly string[]
}

export const waveforms = ['sine', 'saw', 'square', 'random'] as const
export const rateModes = ['free', 'sync'] as const
export const scales = ['chromatic', 'major', 'minor', 'pentatonic'] as const
export const orientations = ['horizontal', 'vertical'] as const
export const arpStyles = ['up', 'down', 'up-down', 'random'] as const
export const tempoDivisions = ['1/1', '3/4', '1/2', '1/4', '1/8', '1/16', '1/32'] as const

function select(id: string, label: string, choices: readonly string[]): ParameterMetadata {
  return { id, label, kind: 'number', min: 0, max: 127, choices }
}

function envelopeInputs(id: string, label: string): ParameterMetadata[] {
  return [
    { id: `${id}.attack`, label: `${label} attack`, kind: 'number', min: 0.001, max: 1 },
    { id: `${id}.decay`, label: `${label} decay`, kind: 'number', min: 0.001, max: 2 },
    { id: `${id}.sustain`, label: `${label} sustain`, kind: 'number', min: 0, max: 1 },
    { id: `${id}.release`, label: `${label} release`, kind: 'number', min: 0.01, max: 10 },
  ]
}

export function outputs(item: GridItem): ParameterMetadata[] {
  switch (item.type) {
    case 'knob': return [{ id: 'value', label: 'Value', kind: 'number', min: item.settings.min, max: item.settings.max }]
    case 'lfo': return [{ id: 'value', label: 'Modulation', kind: 'number', min: -1, max: 1 }]
    case 'mod-wheel': return [{ id: 'value', label: 'Position', kind: 'number', min: item.settings.autoCenter ? -1 : 0, max: 1 }]
    case 'piano-roll':
    case 'arpeggiator': return [{ id: 'note', label: 'Notes', kind: 'note' }]
    case 'instrument-pad':
    case 'pad': return [
      { id: 'velocity', label: 'Velocity', kind: 'number', min: 0, max: 127 },
      { id: 'gate', label: 'Gate', kind: 'number', min: 0, max: 1 },
    ]
    default: return []
  }
}

export function inputs(item: GridItem): ParameterMetadata[] {
  switch (item.type) {
    case 'knob': return [{ id: 'value', label: 'Current value', kind: 'number', min: item.settings.min, max: item.settings.max }]
    case 'instrument-pad': return [
      { id: 'note', label: 'Note input', kind: 'note' },
      ...(item.settings.instrumentType === '303' ? [
        { id: 'transpose', label: 'Transpose', kind: 'number' as const, min: -36, max: 36 },
        { id: 'resonance', label: 'Resonance', kind: 'number' as const, min: 0.1, max: 30 },
        { id: 'volume', label: 'Volume', kind: 'number' as const, min: -48, max: 0 },
        { id: 'slideTime', label: 'Slide time', kind: 'number' as const, min: 0, max: 0.5 },
        { id: 'filterFrequency', label: 'Filter frequency', kind: 'number' as const, min: 50, max: 5000 },
        { id: 'filterAmount', label: 'Filter amount', kind: 'number' as const, min: 0, max: 1 },
        ...envelopeInputs('envelope', 'Amplitude envelope'),
        ...envelopeInputs('filterEnvelope', 'Filter envelope'),
      ] : []),
    ]
    case 'pad': return [{ id: 'note', label: 'Note input', kind: 'note' }]
    case 'lfo': return [
      select('waveform', 'Waveform', waveforms),
      select('rateMode', 'Rate mode', rateModes),
      { id: 'rate', label: 'Rate', kind: 'number', min: 0.01, max: 20 },
      { id: 'depth', label: 'Depth', kind: 'number', min: 0, max: 1 },
      { id: 'offset', label: 'Offset', kind: 'number', min: -1, max: 1 },
    ]
    case 'mod-wheel': return [{ id: 'depth', label: 'Depth', kind: 'number', min: 0, max: 1 }]
    case 'piano-roll': return [select('scale', 'Scale', scales), select('orientation', 'Orientation', orientations)]
    case 'arpeggiator': return [
      { id: 'note', label: 'Note input', kind: 'note' },
      select('style', 'Style', arpStyles), select('rate', 'Rate', tempoDivisions), select('scale', 'Scale', scales),
    ]
    default: return []
  }
}

export function applySelectInput(item: GridItem, parameter: string, index: number): void {
  if (item.type === 'lfo') {
    const waveform = waveforms[index]
    const mode = rateModes[index]
    if (parameter === 'waveform' && waveform !== undefined) item.settings.waveform = waveform
    else if (parameter === 'rateMode' && mode !== undefined) item.settings.rateMode = mode
  } else if (item.type === 'piano-roll') {
    const scale = scales[index]
    const orientation = orientations[index]
    if (parameter === 'scale' && scale !== undefined) item.settings.scale = scale
    else if (parameter === 'orientation' && orientation !== undefined) item.settings.orientation = orientation
  } else if (item.type === 'arpeggiator') {
    const scale = scales[index]
    const style = arpStyles[index]
    const rate = tempoDivisions[index]
    if (parameter === 'scale' && scale !== undefined) item.settings.scale = scale
    else if (parameter === 'style' && style !== undefined) item.settings.style = style
    else if (parameter === 'rate' && rate !== undefined) item.settings.rate = rate
  }
}

export function isCompatible(source: GridItem, sourceParameter: string, target: GridItem, targetParameter: string): boolean {
  const output = outputs(source).find((parameter) => parameter.id === sourceParameter)
  const input = inputs(target).find((parameter) => parameter.id === targetParameter)
  return source.id !== target.id && !!output && !!input && output.kind === input.kind
}

export function createsCycle(connections: Connection[], sourceId: string, targetId: string): boolean {
  const pending = [targetId]
  const visited = new Set<string>()
  while (pending.length) {
    const id = pending.pop()!
    if (id === sourceId) return true
    if (visited.has(id)) continue
    visited.add(id)
    for (const connection of connections) if (connection.sourceId === id) pending.push(connection.targetId)
  }
  return false
}
