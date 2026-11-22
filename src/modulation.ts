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

export function numericSourceRange(layout: GridLayout, wire: Connection): { min: number; max: number } | undefined {
  const source = layout.items.find((item) => item.id === wire.sourceId)
  if (!source) return undefined
  if (source.type === 'output-selector') {
    const incoming = layout.connections.find((entry) => entry.targetId === source.id && entry.targetParameter === 'value')
    if (!incoming) return undefined
    if (incoming.modulationMin !== undefined || incoming.modulationMax !== undefined || incoming.modulationAmount !== undefined) {
      return { min: 0, max: 127 }
    }
    return numericSourceRange(layout, incoming)
  }
  const output = outputs(source).find((entry) => entry.id === wire.sourceParameter && entry.kind === 'number')
  return output?.min !== undefined && output.max !== undefined ? { min: output.min, max: output.max } : undefined
}

export function modulationOffset(wire: Connection, signal: NumericSignal): number | undefined {
  if (wire.modulationMin !== undefined || wire.modulationMax !== undefined) {
    const min = wire.modulationMin ?? (signal.min < 0 && signal.max > 0 ? -100 : 0)
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

export function numericSignal(
  layout: GridLayout,
  wire: Connection,
  signals: ReadonlyMap<string, number>,
  getItem: (id: string) => GridItem | undefined = (id) => layout.items.find((item) => item.id === id),
): NumericSignal | undefined {
  const source = getItem(wire.sourceId)
  if (!source) return undefined
  if (source.type === 'output-selector') {
    if (selectedSelectorWire(layout.connections, source)?.id !== wire.id) return undefined
    const incoming = layout.connections.find((entry) => entry.targetId === source.id && entry.targetParameter === 'value')
    if (!incoming) return undefined
    const signal = numericSignal(layout, incoming, signals, getItem)
    if (!signal) return undefined
    const offset = modulationOffset(incoming, signal)
    return offset === undefined ? signal : { source, min: 0, max: 127, value: Math.max(0, Math.min(127, offset * 127)) }
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
  if (item.type === 'arpeggiator' && (input.id === 'style' || input.id === 'scale' || input.id === 'rate')) {
    const index = input.choices?.indexOf(item.settings[input.id]) ?? -1
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
  } else if ((item.type === 'lfo' || item.type === 'mod-wheel') && input.id === 'depth') {
    item.settings.depth = value
  } else if (item.type === 'lfo' && input.id === 'offset') {
    item.settings.offset = value
  } else if (item.type === 'lfo' && input.id === 'rate') {
    item.settings.rate = Number(value.toFixed(2))
  }
}

export function effectiveControls(layout: GridLayout, signals: ReadonlyMap<string, number>): GridItem[] {
  const resolved = new Map<string, GridItem>()
  const resolving = new Set<string>()

  function resolve(id: string): GridItem | undefined {
    const cached = resolved.get(id)
    if (cached) return cached
    const original = layout.items.find((item) => item.id === id)
    if (!original || resolving.has(id)) return undefined
    resolving.add(id)
    const item = copyControl(original, original.id)
    for (const input of inputs(item)) {
      if (input.kind !== 'number' || input.min === undefined || input.max === undefined) continue
      const base = baseValue(item, input)
      if (base === undefined) continue
      let absolute: number | undefined
      let adjustment = 0
      let driven = false
      for (const wire of layout.connections) {
        if (wire.targetId !== id || wire.targetParameter !== input.id) continue
        const signal = numericSignal(layout, wire, signals, resolve)
        if (!signal) continue
        driven = true
        const offset = modulationOffset(wire, signal)
        if (offset !== undefined) adjustment += offset * (input.max - input.min)
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
