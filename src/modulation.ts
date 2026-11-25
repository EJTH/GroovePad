// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import { copyControl, type Connection, type GridItem, type GridLayout } from './grid'
import { applySelectInput, inputs, outputs, selectedSelectorWire, type ParameterMetadata } from './parameters'

export function normalizeSignal(value: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (value - min) / (max - min)))
}

export function signalSource(layout: GridLayout, wire: Connection): Connection | undefined {
  const source = layout.items.find((item) => item.id === wire.sourceId)
  if (!source) return undefined
  if (source.type !== 'output-selector') return wire
  if (selectedSelectorWire(layout.connections, source)?.id !== wire.id) return undefined
  const incoming = layout.connections.find((entry) => entry.targetId === source.id &&
    entry.targetParameter === wire.sourceParameter)
  return incoming && signalSource(layout, incoming)
}

export interface NumericSignal {
  value: number
  min: number
  max: number
  source: GridItem
}

export interface BoundaryNumeric {
  portId: string
  wire: Connection
  signal: NumericSignal
}

function hasMapping(wire: Connection): boolean {
  return wire.mappingMode !== undefined || wire.modulationMin !== undefined ||
    wire.modulationMax !== undefined || wire.modulationAmount !== undefined
}

export function connectionMappingMode(layout: GridLayout, wire: Connection): 'mod' | 'abs' {
  if (wire.mappingMode) return wire.mappingMode
  if (hasMapping(wire)) return 'mod'
  const target = layout.items.find((item) => item.id === wire.targetId)
  if (target?.type === 'output-selector') return 'abs'
  let sourceWire: Connection | undefined = wire
  while (sourceWire) {
    const source = layout.items.find((item) => item.id === sourceWire!.sourceId)
    if (!source) return 'abs'
    if (source.type !== 'output-selector') {
      return source.type === 'knob' || (source.type === 'mod-wheel' && source.settings.autoCenter) ? 'mod' : 'abs'
    }
    const incoming: Connection | undefined = layout.connections.find((entry) => entry.targetId === source.id && entry.targetParameter === 'value')
    if (!incoming || hasMapping(incoming)) return 'abs'
    sourceWire = incoming
  }
  return 'abs'
}

export function numericSourceRange(layout: GridLayout, wire: Connection): { min: number; max: number } | undefined {
  const source = layout.items.find((item) => item.id === wire.sourceId)
  if (!source) return undefined
  if (source.type === 'output-selector') {
    const incoming = layout.connections.find((entry) => entry.targetId === source.id && entry.targetParameter === 'value')
    if (!incoming) return undefined
    if (hasMapping(incoming)) {
      return { min: 0, max: 127 }
    }
    return numericSourceRange(layout, incoming)
  }
  const output = outputs(source).find((entry) => entry.id === wire.sourceParameter && entry.kind === 'number')
  return output?.min !== undefined && output.max !== undefined ? { min: output.min, max: output.max } : undefined
}

export function mappingEndpoint(layout: GridLayout, wire: Connection, endpoint: 'min' | 'max'): number | undefined {
  if (wire.mappingMode === 'abs') {
    const absolute = endpoint === 'min' ? wire.absoluteMin : wire.absoluteMax
    if (absolute !== undefined) return absolute
    const legacy = endpoint === 'min' ? wire.modulationMin : wire.modulationMax
    if (legacy === undefined) return undefined
    const target = mappingTarget(layout, wire)
    return target.min + legacy / 100 * (target.max - target.min)
  }
  const mapped = endpoint === 'min' ? wire.modulationMin : wire.modulationMax
  if (mapped !== undefined || wire.modulationAmount === undefined) return mapped
  if (endpoint === 'max') return wire.modulationAmount
  const range = numericSourceRange(layout, wire)
  return range && range.min < 0 && range.max > 0 ? -wire.modulationAmount : 0
}

export function mappingTarget(layout: GridLayout, wire: Connection): ParameterMetadata & { min: number; max: number } {
  const target = layout.items.find((item) => item.id === wire.targetId)
  const input = target && inputs(target).find((entry) => entry.id === wire.targetParameter && entry.kind === 'number')
  if (!input || input.min === undefined || input.max === undefined || input.min >= input.max) {
    throw new Error('Numeric mapping destination is unavailable.')
  }
  return { ...input, min: input.min, max: input.max }
}

export function setConnectionMappingMode(layout: GridLayout, wire: Connection, mode: 'mod' | 'abs', updateSelectorBase = true): void {
  const previous = connectionMappingMode(layout, wire)
  const min = mappingEndpoint(layout, wire, 'min')
  const max = mappingEndpoint(layout, wire, 'max')
  const targetInput = mappingTarget(layout, wire)
  delete wire.modulationAmount
  delete wire.modulationMin
  delete wire.modulationMax
  delete wire.absoluteMin
  delete wire.absoluteMax
  wire.mappingMode = mode
  const convert = (value: number) => previous === mode ? value : mode === 'abs'
    ? targetInput.min + Math.max(0, value) / 100 * (targetInput.max - targetInput.min)
    : normalizeSignal(value, targetInput.min, targetInput.max) * 100
  if (min !== undefined) {
    if (mode === 'abs') wire.absoluteMin = convert(min)
    else wire.modulationMin = convert(min)
  }
  if (max !== undefined) {
    if (mode === 'abs') wire.absoluteMax = convert(max)
    else wire.modulationMax = convert(max)
  }
  const target = layout.items.find((item) => item.id === wire.targetId)
  if (updateSelectorBase && mode === 'mod' && target?.type === 'output-selector' && wire.targetParameter === 'selection' &&
    target.settings.baseIndex === undefined) target.settings.baseIndex = target.settings.index
}

export function setMappingEndpoint(layout: GridLayout, wire: Connection, endpoint: 'min' | 'max', value: number | undefined, updateSelectorBase = true): void {
  const mode = connectionMappingMode(layout, wire)
  if (!hasMapping(wire) && value === undefined) return
  setConnectionMappingMode(layout, wire, mode, updateSelectorBase)
  const key = mode === 'abs'
    ? (endpoint === 'min' ? 'absoluteMin' : 'absoluteMax')
    : (endpoint === 'min' ? 'modulationMin' : 'modulationMax')
  if (value === undefined) delete wire[key]
  else wire[key] = value
}

export function absoluteMappingValue(wire: Connection, signal: NumericSignal, targetMin: number, targetMax: number): number {
  const span = targetMax - targetMin
  const min = wire.absoluteMin ?? (wire.modulationMin === undefined ? targetMin : targetMin + wire.modulationMin / 100 * span)
  const max = wire.absoluteMax ?? (wire.modulationMax === undefined ? targetMax : targetMin + wire.modulationMax / 100 * span)
  return min + (max - min) * normalizeSignal(signal.value, signal.min, signal.max)
}

export function modulationOffset(wire: Connection, signal: NumericSignal): number | undefined {
  if (wire.mappingMode !== undefined || wire.modulationMin !== undefined || wire.modulationMax !== undefined) {
    const min = wire.modulationMin ?? (wire.mappingMode !== 'abs' && signal.min < 0 && signal.max > 0 ? -100 : 0)
    const max = wire.modulationMax ?? 100
    return (min + (max - min) * normalizeSignal(signal.value, signal.min, signal.max)) / 100
  }
  if (wire.modulationAmount !== undefined) {
    const value = signal.min < 0 && signal.max > 0
      ? Math.max(-1, Math.min(1, signal.value < 0 ? signal.value / -signal.min : signal.value / signal.max))
      : normalizeSignal(signal.value, signal.min, signal.max)
    return value * wire.modulationAmount / 100
  }
  return undefined
}

export function selectorNumericValue(wire: Connection, signal: NumericSignal, modBase: number): number {
  if (wire.mappingMode === 'abs') return Math.max(0, Math.min(127, absoluteMappingValue(wire, signal, 0, 127)))
  const mapped = modulationOffset(wire, signal)
  if (mapped === undefined) return normalizeSignal(signal.value, signal.min, signal.max) * 127
  const base = wire.mappingMode === 'mod' ? modBase : 0
  return Math.max(0, Math.min(127, base + mapped * 127))
}

export function numericSignal(
  layout: GridLayout,
  wire: Connection,
  signals: ReadonlyMap<string, number>,
  getItem: (id: string) => GridItem | undefined = (id) => layout.items.find((item) => item.id === id),
  boundary: BoundaryNumeric[] = [],
  boundaryOutputs: ReadonlyMap<string, NumericSignal> = new Map(),
): NumericSignal | undefined {
  const source = getItem(wire.sourceId)
  if (!source) return undefined
  if (source.type === 'sub-grid') {
    const key = `${source.id}:${wire.sourceParameter}`
    const signal = boundaryOutputs.get(key)
    if (signal) {
      const value = signals.get(key)
      return value === undefined ? undefined : { ...signal, source, value }
    }
  }
  if (source.type === 'output-selector') {
    if (selectedSelectorWire(layout.connections, source)?.id !== wire.id) return undefined
    const external = boundary.find((entry) => entry.wire.targetId === source.id && entry.wire.targetParameter === 'value')
    const incoming = layout.connections.find((entry) => entry.targetId === source.id && entry.targetParameter === 'value') ?? external?.wire
    if (!incoming) return undefined
    const signal = external?.wire === incoming ? external.signal : numericSignal(layout, incoming, signals, getItem, boundary, boundaryOutputs)
    if (!signal) return undefined
    if (!hasMapping(incoming)) return signal
    const base = normalizeSignal(signal.value, signal.min, signal.max) * 127
    return { source, min: 0, max: 127, value: selectorNumericValue(incoming, signal, base) }
  }
  const output = outputs(source).find((parameter) => parameter.id === wire.sourceParameter && parameter.kind === 'number')
  if (!output || output.min === undefined || output.max === undefined || output.min >= output.max) return undefined
  const value = source.type === 'knob' && wire.sourceParameter === 'value'
    ? source.settings.value : signals.get(`${source.id}:${wire.sourceParameter}`)
  if (value === undefined || !Number.isFinite(value)) return undefined
  return { source, value, min: output.min, max: output.max }
}

function baseValue(item: GridItem, input: ParameterMetadata): number | undefined {
  if (item.type === 'instrument-pad') {
    const [key, nested] = input.id.split('.')
    if (!key) return undefined
    const value: unknown = item.settings.instrumentParams[key]
    if (input.choices) {
      const choice = input.id === 'reverse' ? (value ? 'on' : 'off') : input.id === 'loopMode' && value === 'once' ? 'loop' : value
      const index = input.choices.findIndex((entry) => entry === choice)
      return index < 0 ? undefined : (index + 0.5) * 128 / input.choices.length - 0.5
    }
    if (nested && typeof value === 'object' && value !== null && nested in value) {
      const nestedValue: unknown = Reflect.get(value, nested)
      return typeof nestedValue === 'number' ? nestedValue : undefined
    }
    return typeof value === 'number' ? value : undefined
  }
  if (item.type === 'knob' && input.id === 'value') return item.settings.value
  if (item.type === 'tone-element') {
    const value = item.settings[input.id as keyof typeof item.settings]
    return typeof value === 'number' ? value : undefined
  }
  if (item.type === 'sequenced-loop' && input.id === 'clipIndex') {
    return (item.settings.clipIndex + 0.5) * 128 / input.choices!.length - 0.5
  }
  if (item.type === 'lfo') {
    if (input.id === 'rate') return item.settings.rate
    if (input.id === 'depth') return item.settings.depth
    if (input.id === 'offset') return item.settings.offset
    if (input.id === 'waveform' || input.id === 'rateMode') {
      const index = input.choices?.indexOf(item.settings[input.id]) ?? -1
      return index < 0 ? undefined : (index + 0.5) * 128 / input.choices!.length - 0.5
    }
  }
  if (item.type === 'mod-wheel' && input.id === 'depth') return item.settings.depth
  if (item.type === 'piano-roll' && (input.id === 'scale' || input.id === 'orientation')) {
    const index = input.choices?.indexOf(item.settings[input.id]) ?? -1
    return index < 0 ? undefined : (index + 0.5) * 128 / input.choices!.length - 0.5
  }
  if (item.type === 'arpeggiator' && (input.id === 'enabled' || input.id === 'style' || input.id === 'scale' || input.id === 'rate')) {
    const choice = input.id === 'enabled' ? (item.settings.enabled ? 'on' : 'off') : item.settings[input.id]
    const index = input.choices?.indexOf(choice) ?? -1
    return index < 0 ? undefined : (index + 0.5) * 128 / input.choices!.length - 0.5
  }
  return undefined
}

function setInput(item: GridItem, input: ParameterMetadata, value: number) {
  if (input.choices) {
    const index = Math.min(input.choices.length - 1, Math.floor(value / 128 * input.choices.length))
    applySelectInput(item, input.id, index)
  } else if (item.type === 'instrument-pad') {
    const [key, nested] = input.id.split('.')
    if (!key) return
    if (nested) {
      const envelope: unknown = item.settings.instrumentParams[key]
      if (typeof envelope === 'object' && envelope !== null && nested in envelope) Reflect.set(envelope, nested, value)
    } else {
      item.settings.instrumentParams[key] = value
    }
  } else if (item.type === 'knob' && input.id === 'value') {
    const { min, max, step } = item.settings
    item.settings.value = Number(Math.max(min, Math.min(max, min + Math.round((value - min) / step) * step)).toPrecision(12))
  } else if (item.type === 'tone-element' && input.id in item.settings) {
    Reflect.set(item.settings, input.id, value)
  } else if ((item.type === 'lfo' || item.type === 'mod-wheel') && input.id === 'depth') {
    item.settings.depth = value
  } else if (item.type === 'lfo' && input.id === 'offset') {
    item.settings.offset = value
  } else if (item.type === 'lfo' && input.id === 'rate') {
    item.settings.rate = Number(value.toFixed(2))
  }
}

export function effectiveControls(layout: GridLayout, signals: ReadonlyMap<string, number>, boundary: BoundaryNumeric[] = [],
  boundaryOutputs: ReadonlyMap<string, NumericSignal> = new Map()): GridItem[] {
  const resolved = new Map<string, GridItem>()
  const resolving = new Set<string>()
  const incoming = new Map<string, Map<string, { wire: Connection; signal?: NumericSignal }[]>>()
  for (const wire of layout.connections) {
    let parameters = incoming.get(wire.targetId)
    if (!parameters) { parameters = new Map(); incoming.set(wire.targetId, parameters) }
    let wires = parameters.get(wire.targetParameter)
    if (!wires) { wires = []; parameters.set(wire.targetParameter, wires) }
    wires.push({ wire })
  }
  for (const entry of boundary) {
    let parameters = incoming.get(entry.wire.targetId)
    if (!parameters) { parameters = new Map(); incoming.set(entry.wire.targetId, parameters) }
    let wires = parameters.get(entry.wire.targetParameter)
    if (!wires) { wires = []; parameters.set(entry.wire.targetParameter, wires) }
    wires.push({ wire: entry.wire, signal: entry.signal })
  }

  function resolve(id: string): GridItem | undefined {
    const cached = resolved.get(id)
    if (cached) return cached
    const original = layout.items.find((item) => item.id === id)
    if (!original || resolving.has(id)) return undefined
    resolving.add(id)
    // Recorded events are not modified during modulation resolution.
    const item = original.type === 'sequenced-loop'
      ? { ...original, settings: { ...original.settings } }
      : copyControl(original, original.id)
    if (item.type === 'knob') {
      const value = signals.get(`${item.id}:value`)
      if (value !== undefined) item.settings.value = Math.max(item.settings.min, Math.min(item.settings.max, value))
    }
    const targetWires = incoming.get(id)
    for (const input of targetWires ? inputs(item) : []) {
      if (input.kind !== 'number' || input.min === undefined || input.max === undefined) continue
      const wires = targetWires?.get(input.id)
      if (!wires) continue
      const base = baseValue(item, input)
      if (base === undefined) continue
      let absolute: number | undefined
      let adjustment = 0
      let driven = false
      for (const entry of wires) {
        const { wire } = entry
        const signal = entry.signal ?? numericSignal(layout, wire, signals, resolve, boundary, boundaryOutputs)
        if (!signal) continue
        driven = true
        const offset = modulationOffset(wire, signal)
        if (wire.mappingMode === 'abs') absolute = absoluteMappingValue(wire, signal, input.min, input.max)
        else if (offset !== undefined) adjustment += offset * (input.max - input.min)
        else if (signal.source.type === 'knob') adjustment += signal.value
        else if (signal.source.type === 'mod-wheel' && signal.source.settings.autoCenter) adjustment += signal.value * (input.max - input.min)
        else {
          const normalized = normalizeSignal(signal.value, signal.min, signal.max)
          absolute = input.min + normalized * (input.max - input.min)
        }
      }
      if (driven) setInput(item, input, Math.max(input.min, Math.min(input.max, (absolute ?? base) + adjustment)))
    }
    resolving.delete(id)
    resolved.set(id, item)
    return item
  }
  return layout.items.map((item) => resolve(item.id) ?? copyControl(item, item.id))
}
