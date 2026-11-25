// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MAX_LOOP_CLIP_INDEX, type Connection, type GridItem, type GridLayout } from './grid'

export interface ParameterMetadata {
  id: string
  label: string
  kind: 'number' | 'note' | 'audio'
  min?: number
  max?: number
  choices?: readonly string[]
}

// Common parameter metadata and utility functions for GroovePad components
export const waveforms = ['sine', 'saw', 'square'] as const
export const rateModes = ['free', 'sync'] as const
export const scales = ['chromatic', 'major', 'minor', 'major-pentatonic', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian', 'minor-pentatonic', 'blues'] as const
export const orientations = ['horizontal', 'vertical'] as const
export const arpStyles = ['up', 'down', 'up-down', 'random'] as const
export const tempoDivisions = ['1/1', '3/4', '1/2', '1/4', '1/8', '1/16', '1/32'] as const
export const loopClipIndices = Array.from({ length: MAX_LOOP_CLIP_INDEX + 1 }, (_, index) => String(index))

// Common parameter metadata and utility functions for GroovePad components
export const filterTypes = ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'notch', 'allpass', 'peaking'] as const


const velocityOutput: ParameterMetadata = { id: 'velocity', label: 'Velocity', kind: 'number', min: 0, max: 127 }
const pressureOutput: ParameterMetadata = { id: 'pressure', label: 'Pressure', kind: 'number', min: 0, max: 127 }

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

function instrumentInputs(item: Extract<GridItem, { type: 'instrument-pad' }>): ParameterMetadata[] {
  const { instrumentType, instrumentParams } = item.settings
  const volume = { id: 'volume', label: 'Volume', kind: 'number' as const, min: -48, max: 0 }
  const envelope = envelopeInputs('envelope', 'Amplitude envelope')
  if (instrumentType === '303') return [
    { id: 'transpose', label: 'Transpose', kind: 'number', min: -36, max: 36 },
    { id: 'resonance', label: 'Resonance', kind: 'number', min: 0.1, max: 30 },
    volume,
    { id: 'slideTime', label: 'Slide time', kind: 'number', min: 0, max: 0.5 },
    { id: 'filterFrequency', label: 'Filter frequency', kind: 'number', min: 50, max: 5000 },
    { id: 'filterAmount', label: 'Filter amount', kind: 'number', min: 0, max: 1 },
    ...envelope,
    ...envelopeInputs('filterEnvelope', 'Filter envelope'),
  ]
  if (instrumentType === '808' || instrumentType === '909') return [
    select('drum', 'Drum type', ['kick', 'snare', 'closed-hat', 'open-hat', 'rim', 'tom']),
    { id: 'pitch', label: 'Pitch', kind: 'number', min: 50, max: 300 },
    volume,
    { id: 'tonality', label: 'Tonality', kind: 'number', min: 0, max: 1 },
    { id: 'tone', label: 'Tone', kind: 'number', min: 0, max: 1 },
    ...envelope,
  ]
  const cuts: unknown = instrumentParams.cuts
  const count = Array.isArray(cuts) ? cuts.length : 0
  const playback = ['random', 'order', ...Array.from({ length: count ? count + 1 : 0 }, (_, i) => `cut:${i}`)]
  if (instrumentType === 'sample-hit') playback.push('loop')
  return [
    volume,
    { id: 'pitch', label: 'Transpose', kind: 'number', min: -12, max: 12 },
    ...envelope,
    select('playback', 'Playback', playback),
    ...(instrumentType === 'sample-hit' ? [
      select('loopMode', 'Loop mode', ['loop', 'back-and-forth']),
      select('reverse', 'Reverse playback', ['off', 'on']),
    ] : []),
  ]
}

export function outputs(item: GridItem): ParameterMetadata[] {
  switch (item.type) {
    case 'knob': return [{ id: 'value', label: 'Value', kind: 'number', min: item.settings.min, max: item.settings.max }]
    case 'lfo': return [{ id: 'value', label: 'Modulation', kind: 'number', min: -1, max: 1 }]
    case 'mod-wheel': return [{ id: 'value', label: 'Position', kind: 'number', min: item.settings.autoCenter ? -1 : 0, max: 1 }]
    case 'piano-roll': return [{ id: 'note', label: 'Notes', kind: 'note' }, velocityOutput, pressureOutput]
    case 'arpeggiator': return [{ id: 'note', label: 'Notes', kind: 'note' }, velocityOutput]
    case 'output-selector': return [
      { id: 'value', label: 'Number', kind: 'number', min: 0, max: 127 },
      { id: 'note', label: 'Notes', kind: 'note' },
    ]
    case 'instrument-pad': return [
      velocityOutput,
      pressureOutput,
      { id: 'gate', label: 'Gate', kind: 'number', min: 0, max: 1 },
      { id: 'audio', label: 'Audio output', kind: 'audio' },
    ]
    case 'pad': return [
      velocityOutput,
      pressureOutput,
      { id: 'gate', label: 'Gate', kind: 'number', min: 0, max: 1 },
    ]
    case 'tone-element': return [
      { id: 'audio', label: 'Audio', kind: 'audio' },
      ...(item.settings.elementType === 'oscillator'
        ? [{ id: 'frequency', label: 'Frequency', kind: 'number' as const, min: 20, max: 20000 }]
        : []),
      ...(item.settings.elementType === 'envelope'
        ? [{ id: 'value', label: 'Envelope', kind: 'number' as const, min: 0, max: 1 }]
        : []),
    ]
    case 'sub-grid': return [
      { id: 'audio', label: 'Audio output', kind: 'audio' },
      ...exposedPorts(item, 'output'),
    ]
    default: return []
  }
}

export function inputs(item: GridItem): ParameterMetadata[] {
  switch (item.type) {
    case 'output-selector': return [
      { id: 'value', label: 'Number', kind: 'number', min: 0, max: 127 },
      { id: 'note', label: 'Notes', kind: 'note' },
      { id: 'selection', label: 'Output selection', kind: 'number', min: 0, max: 127 },
    ]
    case 'knob': return [{ id: 'value', label: 'Current value', kind: 'number', min: item.settings.min, max: item.settings.max }]
    case 'instrument-pad': return [
      { id: 'note', label: 'Note input', kind: 'note' },
      ...instrumentInputs(item),
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
      select('enabled', 'On/off', ['off', 'on']),
      select('style', 'Style', arpStyles), select('rate', 'Rate', tempoDivisions), select('scale', 'Scale', scales),
    ]
    case 'sequenced-loop': return [select('clipIndex', 'Clip index', loopClipIndices)]
    case 'sub-grid': return [
      { id: 'audio', label: 'Audio input', kind: 'audio' },
      ...exposedPorts(item, 'input'),
    ]
    case 'tone-element': {
      const numeric = (id: string, label: string, min: number, max: number): ParameterMetadata =>
        ({ id, label, kind: 'number', min, max })
      const ports: ParameterMetadata[] = []
      if (item.settings.elementType !== 'oscillator' && item.settings.elementType !== 'noise') {
        ports.push({ id: 'audio', label: 'Audio input', kind: 'audio' })
      }
      if (item.settings.elementType === 'oscillator') {
        ports.push({ id: 'note', label: 'Note input', kind: 'note' },
          numeric('frequency', 'Frequency', 20, 20000),
          numeric('detune', 'Detune', -1200, 1200))
      }
      if (item.settings.elementType === 'noise') {
        ports.push({ id: 'note', label: 'Note input', kind: 'note' }, numeric('gain', 'Gain', 0, 2))
      }
      if (item.settings.elementType === 'filter') {
        ports.push(numeric('cutoff', 'Filter cutoff', 20, 20000), numeric('gain', 'Resonance', 0, 2))
      }
      if (item.settings.elementType === 'gain' || item.settings.elementType === 'mixer') {
        ports.push(numeric('gain', 'Gain', 0, 2))
      }
      if (item.settings.elementType === 'delay') {
        ports.push(numeric('delayTime', 'Delay time', 0, 5),
          numeric('feedback', 'Feedback', 0, 1),
          numeric('gain', 'Wet level', 0, 1))
      }
      if (item.settings.elementType === 'reverb') {
        ports.push(numeric('decay', 'Decay', 0.01, 10), numeric('gain', 'Wet level', 0, 1))
      }
      if (item.settings.elementType === 'envelope') {
        ports.push({ id: 'note', label: 'Note input', kind: 'note' },
          numeric('attack', 'Attack', 0.001, 5),
          numeric('decay', 'Decay', 0.01, 10),
          numeric('sustain', 'Sustain', 0, 1),
          numeric('release', 'Release', 0.01, 10))
      }
      return ports
    }
    default: return []
  }
}

function exposedPorts(item: Extract<GridItem, { type: 'sub-grid' }>, direction: 'input' | 'output'): ParameterMetadata[] {
  return item.settings.exposedPorts.flatMap((port) => {
    if (port.direction !== direction || !port.itemId || !port.parameterId) return []
    const child = item.settings.layout.items.find((entry) => entry.id === port.itemId)
    if (!child) return []
    const parameter = (direction === 'input' ? inputs(child) : outputs(child))
      .find((entry) => entry.id === port.parameterId && entry.kind === (port.kind === 'numeric' ? 'number' : port.kind))
    return parameter ? [{ ...parameter, id: port.id, label: port.name }] : []
  })
}

export function applySelectInput(item: GridItem, parameter: string, index: number): void {
  if (item.type === 'instrument-pad') {
    const choice = inputs(item).find((input) => input.id === parameter)?.choices?.[index]
    if (choice === undefined) return
    const params = item.settings.instrumentParams
    if (parameter === 'reverse') params.reverse = choice === 'on'
    else if (parameter === 'playback') {
      params.playback = choice
      if (item.settings.instrumentType === 'sample-hit') {
        params.loopMode = choice === 'loop' ? (params.loopMode === 'back-and-forth' ? 'back-and-forth' : 'loop') : 'once'
      }
    } else if (parameter === 'loopMode') {
      if (params.playback === 'loop') params.loopMode = choice
    } else if (parameter === 'drum') params.drum = choice
  } else if (item.type === 'lfo') {
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
    if (parameter === 'enabled' && (index === 0 || index === 1)) item.settings.enabled = index === 1
    else if (parameter === 'scale' && scale !== undefined) item.settings.scale = scale
    else if (parameter === 'style' && style !== undefined) item.settings.style = style
    else if (parameter === 'rate' && rate !== undefined) item.settings.rate = rate
  } else if (item.type === 'sequenced-loop' && parameter === 'clipIndex' && index >= 0 && index < loopClipIndices.length) {
    item.settings.clipIndex = index
  }
}

export function isCompatible(source: GridItem, sourceParameter: string, target: GridItem, targetParameter: string): boolean {
  const output = outputs(source).find((parameter) => parameter.id === sourceParameter)
  const input = inputs(target).find((parameter) => parameter.id === targetParameter)
  return source.id !== target.id && !!output && !!input && output.kind === input.kind
}

export function selectorConnectionsCompatible(items: GridItem[], connections: Connection[], candidate: Connection): boolean {
  const source = items.find((item) => item.id === candidate.sourceId)
  const target = items.find((item) => item.id === candidate.targetId)
  if (!source || !target || !isCompatible(source, candidate.sourceParameter, target, candidate.targetParameter)) return false
  const kind = outputs(source).find((parameter) => parameter.id === candidate.sourceParameter)!.kind
  for (const selector of [source, target]) {
    if (selector.type !== 'output-selector') continue
    const related = connections.filter((wire) => wire.id !== candidate.id &&
      (wire.sourceId === selector.id || wire.targetId === selector.id))
    if (target.id === selector.id && candidate.targetParameter === 'selection') {
      if (related.some((wire) => wire.targetId === selector.id && wire.targetParameter === 'selection')) return false
      continue
    }
    const signalWires = related.filter((wire) => wire.targetId !== selector.id || wire.targetParameter !== 'selection')
    if (target.id === selector.id && signalWires.some((wire) => wire.targetId === selector.id)) return false
    for (const wire of signalWires) {
      const parameter = wire.sourceId === selector.id ? wire.sourceParameter : wire.targetParameter
      if (parameter !== (kind === 'note' ? 'note' : 'value')) return false
    }
  }
  return true
}

export function selectorRoutingCompatible(
  root: GridLayout,
  replacement?: { layout: GridLayout; connections?: Connection[]; items?: GridItem[] },
): boolean {
  const selectors = new Map<string, { incoming: number; selection: number; kinds: Set<string> }>()
  const current = (layout: GridLayout) => replacement?.layout === layout
    ? { ...layout, items: replacement.items ?? layout.items, connections: replacement.connections ?? layout.connections }
    : layout
  function resolve(layout: GridLayout, path: string[], id: string, parameter: string, direction: 'input' | 'output'):
    { key: string; item: GridItem; parameter: string } | undefined {
    const item = current(layout).items.find((entry) => entry.id === id)
    if (!item) return undefined
    if (item.type === 'sub-grid' && parameter !== 'audio') {
      const port = item.settings.exposedPorts.find((entry) => entry.id === parameter && entry.direction === direction)
      if (!port?.itemId || !port.parameterId) return undefined
      return resolve(item.settings.layout, [...path, item.id], port.itemId, port.parameterId, direction)
    }
    return { key: JSON.stringify([...path, item.id]), item, parameter }
  }
  function state(key: string) {
    let value = selectors.get(key)
    if (!value) { value = { incoming: 0, selection: 0, kinds: new Set() }; selectors.set(key, value) }
    return value
  }
  function visit(layout: GridLayout, path: string[]) {
    const grid = current(layout)
    for (const wire of grid.connections) {
      const source = resolve(layout, path, wire.sourceId, wire.sourceParameter, 'output')
      const target = resolve(layout, path, wire.targetId, wire.targetParameter, 'input')
      if (!source || !target) continue
      if (source.item.type === 'output-selector') state(source.key).kinds.add(source.parameter)
      if (target.item.type === 'output-selector') {
        const entry = state(target.key)
        if (target.parameter === 'selection') entry.selection++
        else { entry.incoming++; entry.kinds.add(target.parameter) }
      }
    }
    for (const item of grid.items) if (item.type === 'sub-grid') visit(item.settings.layout, [...path, item.id])
  }
  visit(root, [])
  return [...selectors.values()].every((entry) => entry.incoming <= 1 && entry.selection <= 1 && entry.kinds.size <= 1)
}

export function selectedSelectorWire(connections: Connection[], item: GridItem): Connection | undefined {
  if (item.type !== 'output-selector') return undefined
  const outgoing = connections.filter((wire) => wire.sourceId === item.id)
  return outgoing[item.settings.index % outgoing.length]
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
