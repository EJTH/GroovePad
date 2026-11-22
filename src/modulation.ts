import { copyControl, type GridItem, type GridLayout } from './grid'
import { applySelectInput, inputs, outputs, type ParameterMetadata } from './parameters'

function baseValue(item: GridItem, input: ParameterMetadata): number | undefined {
  if (item.type === 'instrument-pad' && item.settings.instrumentType === '303') {
    const [key, nested] = input.id.split('.')
    if (!key) return undefined
    const value: unknown = item.settings.instrumentParams[key]
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
  } else if (item.type === 'instrument-pad' && item.settings.instrumentType === '303') {
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
        const source = resolve(wire.sourceId)
        if (!source) continue
        const output = outputs(source).find((parameter) => parameter.id === wire.sourceParameter)
        if (!output || output.min === undefined || output.max === undefined) continue
        const signal = source.type === 'knob' && wire.sourceParameter === 'value'
          ? source.settings.value : signals.get(`${source.id}:${wire.sourceParameter}`)
        if (signal === undefined || !Number.isFinite(signal)) continue
        driven = true
        if (source.type === 'knob') adjustment += signal
        else if (source.type === 'mod-wheel' && source.settings.autoCenter) adjustment += signal * (input.max - input.min)
        else {
          const normalized = Math.max(0, Math.min(1, (signal - output.min) / (output.max - output.min)))
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
