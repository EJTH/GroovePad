// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Tone from 'tone'
import type { ExposedPort, GridItem, GridLayout, HeldNote, LfoSettings, ToneElementSettings } from '../grid'
import { audioBoundaryKey, audioInput, audioOutput, isAudioSource, mixerAudioInputs, planAudioRoutes } from './audioRoutes'
import { numericContribution, type NumericSignal } from '../modulation'
import { inputs, outputs } from '../parameters'

type AudioItem = Extract<GridItem, { type: 'tone-element' | 'sub-grid' | 'instrument-pad' }>
type Processor = Tone.Gain | Tone.Filter | Tone.FeedbackDelay | Tone.Reverb | Tone.Envelope
interface Entry {
  type: string
  input: Tone.ToneAudioNode
  output: Tone.ToneAudioNode
  processor?: Processor
  active?: boolean
  muted?: boolean
  bypassed?: boolean
  dry?: Tone.Gain
  wet?: Tone.Gain
  channels?: Map<string, Tone.Channel>
  reverbDecay?: { desired: number; pending: boolean; failed: boolean }
}
export interface BoundaryAudio {
  port: ExposedPort
  node: Tone.ToneAudioNode
}

export interface ModulationOptions {
  bpm?: number
  toneSettings?: ReadonlyMap<string, ToneElementSettings>
  baseItems?: readonly GridItem[]
  signals?: ReadonlyMap<string, number>
  boundaryInputs?: ReadonlySet<string>
  wheelPositions?: ReadonlyMap<string, number>
  automatedWheels?: ReadonlySet<string>
}

type ModulationParam = { rampTo(value: number, rampTime: number): unknown }

let master: { pre: Tone.Gain; post: Tone.Gain; users: number } | undefined
function acquireMaster() {
  if (!master) {
    const pre = new Tone.Gain(1)
    const post = new Tone.Gain(1).toDestination()
    pre.connect(post)
    master = { pre, post, users: 0 }
  }
  master.users++
  return master
}

export class BankAudio {
  readonly input = new Tone.Gain(1)
  readonly output = new Tone.Gain(1)
  private readonly master = acquireMaster()
  private readonly entries = new Map<string, Entry>()
  private readonly ports = new Map<string, Tone.Gain>()
  private readonly reportError: (message: string) => void
  private readonly parentInput?: Tone.ToneAudioNode
  private readonly parentOutput?: Tone.InputNode
  private edges: { from: Tone.ToneAudioNode; to: Tone.InputNode }[] = []
  private signature = ''
  private boundary: BoundaryAudio[] = []
  private lfos = new Map<string, { node: Tone.LFO; waveform: Tone.Waveform; start: number; frequency: number;
    type: LfoSettings['waveform'] }>()
  private modulationNodes: Tone.ToneAudioNode[] = []
  private modulationEdges: { from: Tone.ToneAudioNode; to: Tone.InputNode }[] = []
  private modulationValues: { node: Tone.Signal; read: (items: readonly GridItem[], options: ModulationOptions) => number | undefined }[] = []
  private modulationMonitors = new Map<string, { waveform: Tone.Waveform; center: number; half: number }>()
  private drivenParams = new Set<string>()
  private rateDrivenLfos = new Set<string>()

  constructor(
    reportError: (message: string) => void,
    parentInput?: Tone.ToneAudioNode,
    parentOutput?: Tone.InputNode,
  ) {
    this.reportError = reportError
    this.parentInput = parentInput
    this.parentOutput = parentOutput
    if (parentInput) parentInput.connect(this.input)
  }

  getInput(id: string) { return this.entries.get(id)?.input }
  getOutput(id: string) { return this.entries.get(id)?.output }
  isModulationDriven(id: string, parameter: string) { return this.drivenParams.has(`${id}:${parameter}`) }
  hasModulationMonitor(id: string) { return this.modulationMonitors.has(id) }
  getModulationSample(id: string) {
    const monitor = this.modulationMonitors.get(id)
    if (!monitor || monitor.waveform.context.state !== 'running') return undefined
    const samples = monitor.waveform.getValue()
    const sample = samples[samples.length - 1]
    return sample === undefined ? undefined : monitor.center + sample * monitor.half
  }
  getLfoSample(id: string, settings: LfoSettings, bpm: number) {
    const lfo = this.lfos.get(id)
    const frequency = settings.rateMode === 'sync' ? settings.rate * bpm / 60 : settings.rate
    if (!lfo || lfo.node.context.state !== 'running' || lfo.type !== settings.waveform || lfo.frequency !== frequency) return undefined
    const samples = lfo.waveform.getValue()
    return {
      value: samples[samples.length - 1]!,
      phase: (Math.max(0, lfo.node.context.currentTime - lfo.start) * lfo.frequency) % 1,
    }
  }
  getMixerInputs(id: string) { return [...(this.entries.get(id)?.channels?.keys() ?? [])] }
  getEnvelopeValue(id: string) {
    const node = this.entries.get(id)?.processor
    return node instanceof Tone.Envelope ? node.getValueAtTime(node.context.immediate()) : undefined
  }
  getEnvelopeSignal(id: string) {
    const node = this.entries.get(id)?.processor
    return node instanceof Tone.Envelope ? node : undefined
  }
  getPort(id: string, port: ExposedPort) {
    return this.ports.get(port.direction === 'input' ? audioInput(id, port.id) : audioOutput(id, port.id))
  }

  private makeBypassEntry(type: string, input: Tone.ToneAudioNode, processor: Processor, settings: ToneElementSettings): Entry {
    const bypassed = !!settings.bypassed
    const muted = type === 'envelope' || type === 'mixer' ? undefined : !!settings.muted
    const output = new Tone.Gain(muted ? 0 : 1)
    const wet = new Tone.Gain(bypassed ? 0 : 1)
    const dry = new Tone.Gain(bypassed ? 1 : 0)
    input.connect(wet)
    wet.connect(output)
    dry.connect(output)
    return { type, input, output, processor, muted, bypassed, dry, wet }
  }

  private makeEntry(item: AudioItem): Entry {
    if (item.type === 'sub-grid') {
      return { type: 'sub-grid', input: new Tone.Gain(1), output: new Tone.Gain(1) }
    }
    if (item.type === 'instrument-pad') {
      const node = new Tone.Gain(1)
      return { type: 'instrument-pad', input: node, output: node }
    }
    const { elementType, cutoff, gain, delayTime, feedback, decay, attack, sustain, release } = item.settings
    let node: Processor
    switch (elementType) {
      case 'oscillator':
      case 'noise': node = new Tone.Gain(1); break
      case 'filter': node = new Tone.Filter({ frequency: cutoff, Q: gain, type: 'lowpass' }); break
      case 'gain':
      case 'mixer': node = new Tone.Gain(gain); break
      case 'delay': node = new Tone.FeedbackDelay({ delayTime, feedback: Math.min(feedback, 0.99), maxDelay: 5, wet: Math.min(gain, 1) }); break
      case 'reverb': {
        const reverb = new Tone.Reverb({ decay, wet: Math.min(gain, 1) })
        void reverb.ready.catch((error: unknown) => this.reportError(`Reverb could not be generated: ${error instanceof Error ? error.message : String(error)}`))
        node = reverb
        break
      }
      case 'envelope': {
        const envelope = new Tone.Envelope({ attack, decay, sustain, release })
        const gainNode = new Tone.Gain(0)
        envelope.connect(gainNode.gain)
        return this.makeBypassEntry(elementType, gainNode, envelope, item.settings)
      }
    }
    if (elementType === 'oscillator' || elementType === 'noise') {
      const muted = !!item.settings.muted
      const output = new Tone.Gain(muted ? 0 : 1)
      node.connect(output)
      return { type: elementType, input: node, output, processor: node, muted }
    }
    return this.makeBypassEntry(elementType, node, node, item.settings)
  }

  update(layout: GridLayout, boundary: BoundaryAudio[] = [], modulationOptions: ModulationOptions = {}) {
    if ((this.parentInput || this.parentOutput) && layout.items.some((item) => item.type === 'tone-element' &&
      (item.settings.audioFrom === 'main-pre-fx' || item.settings.audioFrom === 'main-post-fx' ||
        item.settings.audioTo === 'main-out'))) {
      throw new Error('SubGrid audio must route through its enclosing control.')
    }
    const planned = planAudioRoutes(layout, boundary.map((entry) => entry.port))
    const items = layout.items.filter((item): item is AudioItem => item.type === 'tone-element' || item.type === 'sub-grid' || item.type === 'instrument-pad')
    const portKeys = items.flatMap((item) => item.type === 'sub-grid'
      ? item.settings.exposedPorts.filter((port) => port.kind === 'audio' && port.itemId && port.parameterId)
        .map((port) => port.direction === 'input' ? audioInput(item.id, port.id) : audioOutput(item.id, port.id)) : [])
    const changed = items.some((item) => this.entries.get(item.id)?.type !==
      (item.type === 'tone-element' ? item.settings.elementType : item.type)) ||
      [...this.entries.keys()].some((id) => !items.some((item) => item.id === id)) ||
      portKeys.some((key) => !this.ports.has(key)) || [...this.ports.keys()].some((key) => !portKeys.includes(key)) ||
      boundary.length !== this.boundary.length || boundary.some((entry, index) => entry.node !== this.boundary[index]?.node)
    const signature = JSON.stringify([planned, boundary.map(({ port }) => [port.id, port.direction, port.itemId, port.parameterId])])
    const rerouted = changed || signature !== this.signature
    if (rerouted) {
      this.clearModulation()
      this.modulationSignature = ''
      this.appliedParams.clear()
      this.disconnectEdges()
      for (const [key, node] of this.ports) if (!portKeys.includes(key)) {
        node.dispose()
        this.ports.delete(key)
      }
      for (const key of portKeys) if (!this.ports.has(key)) this.ports.set(key, new Tone.Gain(1))
      for (const [id, entry] of this.entries) {
        const item = items.find((candidate) => candidate.id === id)
        const type = item?.type === 'tone-element' ? item.settings.elementType : item?.type
        if (entry.type !== type) {
          this.disposeEntry(entry)
          this.entries.delete(id)
        }
      }
      for (const item of items) if (!this.entries.has(item.id)) this.entries.set(item.id, this.makeEntry(item))
      for (const item of items) {
        if (item.type !== 'tone-element' || item.settings.elementType !== 'mixer') continue
        const entry = this.entries.get(item.id)
        if (!entry) continue
        entry.channels ??= new Map()
        const inputs = new Set(mixerAudioInputs(layout, item.id, boundary.map(({ port }) => port)))
        for (const [key, channel] of entry.channels) if (!inputs.has(key)) {
          channel.dispose()
          entry.channels.delete(key)
        }
        for (const key of inputs) if (!entry.channels.has(key)) {
          entry.channels.set(key, new Tone.Channel({ volume: 0, pan: 0 }))
        }
      }
      const nodes = new Map<string, Tone.ToneAudioNode>([
        ['bank-pre', this.input], ['bank-post', this.output],
        ['main-pre', this.master.pre], ['main-post', this.master.post],
      ])
      for (const item of items) {
        const entry = this.entries.get(item.id)!
        nodes.set(audioInput(item.id), entry.input)
        nodes.set(audioOutput(item.id), entry.output)
      }
      for (const [key, node] of this.ports) nodes.set(key, node)
      for (const edge of planned) {
        if (edge.from === 'main-pre' && edge.to === 'main-post') continue
        if (items.some((item) => !isAudioSource(item) && edge.from === audioInput(item.id) && edge.to === audioOutput(item.id))) continue
        const from = nodes.get(edge.from)
        const to = edge.from === 'bank-post' && edge.to === 'main-pre' && this.parentOutput
          ? this.parentOutput : nodes.get(edge.to)
        if (!from || !to) throw new Error('An audio route references a missing element.')
        const target = items.find((item) => item.type === 'tone-element' && edge.to === audioInput(item.id))
        const targetEntry = target ? this.entries.get(target.id) : undefined
        if (targetEntry?.dry) {
          from.connect(targetEntry.dry)
          this.edges.push({ from, to: targetEntry.dry })
        }
        const channel = targetEntry?.channels?.get(edge.from)
        if (channel) {
          from.connect(channel)
          channel.connect(to)
          this.edges.push({ from, to: channel }, { from: channel, to })
          continue
        }
        from.connect(to)
        this.edges.push({ from, to })
      }
      for (const { port, node } of boundary) {
        if (!port.itemId || !port.parameterId) throw new Error('An exposed audio port has no target.')
        const inner = nodes.get(port.direction === 'input'
          ? audioInput(port.itemId, port.parameterId) : audioOutput(port.itemId, port.parameterId))
        if (!inner) throw new Error('An exposed audio port references a missing element.')
        const mixer = port.direction === 'input' && port.parameterId === 'audio'
          ? items.find((item) => item.id === port.itemId && item.type === 'tone-element' && item.settings.elementType === 'mixer')
          : undefined
        const dry = port.direction === 'input' && port.parameterId === 'audio'
          ? this.entries.get(port.itemId)?.dry : undefined
        if (dry) {
          node.connect(dry)
          this.edges.push({ from: node, to: dry })
        }
        const channel = mixer ? this.entries.get(mixer.id)?.channels?.get(audioBoundaryKey(port)) : undefined
        if (channel) {
          node.connect(channel)
          channel.connect(inner)
          this.edges.push({ from: node, to: channel }, { from: channel, to: inner })
          continue
        }
        const from = port.direction === 'input' ? node : inner
        const to = port.direction === 'input' ? inner : node
        from.connect(to)
        this.edges.push({ from, to })
      }
      this.signature = signature
      this.boundary = boundary
    }
    this.updateModulation(layout, modulationOptions)
    for (const item of items) {
      if (item.type !== 'tone-element') continue
      const entry = this.entries.get(item.id)
      const node = entry?.processor
      const s = item.settings
      if (entry?.output instanceof Tone.Gain && entry.muted !== undefined && entry.muted !== !!s.muted) {
        entry.output.gain.rampTo(s.muted ? 0 : 1, 0.02)
        entry.muted = !!s.muted
      }
      if (entry?.dry && entry.wet && entry.bypassed !== !!s.bypassed) {
        entry.wet.gain.rampTo(s.bypassed ? 0 : 1, 0.02)
        entry.dry.gain.rampTo(s.bypassed ? 1 : 0, 0.02)
        entry.bypassed = !!s.bypassed
      }
      const effective = modulationOptions.toneSettings?.get(item.id) ?? s
      const audioDriven = (parameter: string) => this.drivenParams.has(`${item.id}:${parameter}`)
      // Skips redundant rampTo calls; each one appends automation events to the param.
      const ramp = (key: string, param: ModulationParam, value: number, driven = false) => {
        const cacheKey = `${item.id}:${key}`
        if (driven) {
          this.appliedParams.delete(cacheKey)
          return
        }
        if (this.appliedParams.get(cacheKey) === value) return
        this.appliedParams.set(cacheKey, value)
        param.rampTo(value, 0.02)
      }
      if (node instanceof Tone.Filter) {
        ramp('cutoff', node.frequency, effective.cutoff, audioDriven('cutoff'))
        ramp('gain', node.Q, effective.gain, audioDriven('gain'))
      } else if (node instanceof Tone.FeedbackDelay) {
        ramp('delayTime', node.delayTime, effective.delayTime, audioDriven('delayTime'))
        ramp('feedback', node.feedback, Math.min(effective.feedback, 0.99), audioDriven('feedback'))
        ramp('gain', node.wet, Math.min(effective.gain, 1), audioDriven('gain'))
      } else if (node instanceof Tone.Reverb) {
        this.updateReverbDecay(this.entries.get(item.id)!, node, effective.decay)
        ramp('gain', node.wet, Math.min(effective.gain, 1), audioDriven('gain'))
      } else if (node instanceof Tone.Envelope) {
        node.attack = effective.attack
        node.decay = effective.decay
        node.sustain = effective.sustain
        node.release = effective.release
      } else if (node instanceof Tone.Gain && !isAudioSource(item)) {
        ramp('gain', node.gain, effective.gain, audioDriven('gain'))
      }
      if (item.settings.elementType === 'mixer') {
        const entry = this.entries.get(item.id)
        const soloed = [...(entry?.channels?.keys() ?? [])].some((key) => s.mixerChannels?.[key]?.solo)
        for (const [key, channel] of entry?.channels ?? []) {
          const settings = s.mixerChannels?.[key]
          ramp(`${key}:volume`, channel.volume, settings?.volume ?? 0)
          ramp(`${key}:pan`, channel.pan, settings?.pan ?? 0)
          channel.mute = soloed && !settings?.solo
        }
      }
    }
    return rerouted
  }

  private updateReverbDecay(entry: Entry, node: Tone.Reverb, decay: number) {
    const state = entry.reverbDecay ??= { desired: decay, pending: false, failed: false }
    state.desired = decay
    if (state.pending || (node.decay === decay && !state.failed)) return
    state.pending = true
    void (async () => {
      try {
        if (!state.failed) await node.ready
        while (!node.disposed && (node.decay !== state.desired || state.failed)) {
          state.failed = false
          node.decay = state.desired
          await node.ready
        }
      } catch (error) {
        state.failed = true
        this.reportError(`Reverb could not be generated: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        state.pending = false
      }
    })()
  }

  private getModulationParam(id: string, parameter: string): Tone.InputNode | undefined {
    const entry = this.entries.get(id)
    if (!entry) return undefined
    const node = entry.processor
    if (node instanceof Tone.Filter) {
      if (parameter === 'cutoff') return node.frequency
      if (parameter === 'gain') return node.Q
    } else if (node instanceof Tone.FeedbackDelay) {
      if (parameter === 'delayTime') return node.delayTime
      if (parameter === 'feedback') return node.feedback
      if (parameter === 'gain') return node.wet
    } else if (node instanceof Tone.Reverb) {
      if (parameter === 'gain') return node.wet
    } else if (node instanceof Tone.Gain) {
      if (parameter === 'gain') return node.gain
    }
    return undefined
  }

  private updateModulation(layout: GridLayout, options: ModulationOptions) {
    const items = options.baseItems ?? layout.items
    const lfoItems = items.filter((item) => item.type === 'lfo')
    const signature = JSON.stringify([
      options.bpm ?? 120,
      layout.connections,
      items.map((item) => [item.id, item.type,
        item.type === 'lfo' ? [item.settings.waveform, item.settings.rateMode, item.settings.rate, item.settings.smoothness] :
          item.type === 'knob' ? [item.settings.min, item.settings.max] :
            item.type === 'mod-wheel' ? [item.settings.autoCenter, options.wheelPositions?.has(item.id),
              options.automatedWheels?.has(item.id)] :
              item.type === 'tone-element' ? item.settings.elementType :
                item.type === 'output-selector' ? item.settings : undefined,
        outputs(item)]),
      [...(options.boundaryInputs ?? [])].sort(),
      items.flatMap((item) => outputs(item).filter((output) => output.kind === 'number' &&
        item.type !== 'knob' && item.type !== 'lfo' &&
        !(item.type === 'tone-element' && item.settings.elementType === 'envelope'))
        .map((output) => [item.id, output.id, options.signals?.has(`${item.id}:${output.id}`) ?? false])),
    ])
    if (signature !== this.modulationSignature) {
      this.clearModulation()
      for (const [id, lfo] of this.lfos) {
        const item = lfoItems.find((candidate) => candidate.id === id)
        const frequency = item && (item.settings.rateMode === 'sync'
          ? item.settings.rate * (options.bpm ?? 120) / 60 : item.settings.rate)
        if (!item || lfo.frequency !== frequency || lfo.type !== item.settings.waveform) {
          lfo.waveform.dispose()
          lfo.node.dispose()
          this.lfos.delete(id)
        }
      }
      for (const item of lfoItems) {
        if (this.lfos.has(item.id)) continue
        const frequency = item.settings.rateMode === 'sync'
          ? item.settings.rate * (options.bpm ?? 120) / 60 : item.settings.rate
        const node = new Tone.LFO({
          frequency, min: -1, max: 1,
          type: item.settings.waveform === 'saw' ? 'sawtooth' : item.settings.waveform === 'square' ? 'square' : 'sine',
        })
        const waveform = new Tone.Waveform(16)
        node.connect(waveform)
        const start = node.context.now()
        node.start(start)
        this.lfos.set(item.id, { node, waveform, start, frequency, type: item.settings.waveform })
      }

      type Source = { node: Tone.ToneAudioNode; signal: NumericSignal }
      const sources = new Map<string, Source | null | undefined>()
      const resolving = new Set<string>()
      const create = <T extends Tone.ToneAudioNode>(node: T): T => {
        this.modulationNodes.push(node)
        return node
      }
      const connect = (from: Tone.ToneAudioNode, to: Tone.InputNode) => {
        from.connect(to)
        this.modulationEdges.push({ from, to })
      }
      const constant = (value: number, read?: (items: readonly GridItem[], options: ModulationOptions) => number | undefined) => {
        const node = create(new Tone.Signal(value))
        if (read) this.modulationValues.push({ node, read })
        return node
      }
      const inputBase = (target: GridItem, parameter: string, value: number) => constant(value, (current, next) => {
        const item = current.find((candidate) => candidate.id === target.id)
        if (!item) return undefined
        if (item.type === 'knob' && parameter === 'value') {
          const nextValue = next.signals?.get(`${item.id}:value`) ?? item.settings.value
          return Math.max(item.settings.min, Math.min(item.settings.max, nextValue))
        }
        if ((item.type === 'lfo' || item.type === 'mod-wheel' || item.type === 'tone-element') && parameter in item.settings) {
          const nextValue: unknown = Reflect.get(item.settings, parameter)
          return typeof nextValue === 'number' ? nextValue : undefined
        }
        return undefined
      })
      const canSource = (id: string, parameter: string, path: ReadonlySet<string>): boolean => {
        const key = `${id}:${parameter}`
        if (path.has(key)) return false
        const item = items.find((candidate) => candidate.id === id)
        const output = item && outputs(item).find((entry) => entry.id === parameter && entry.kind === 'number')
        if (!item || !output || output.min === undefined || output.max === undefined || output.min >= output.max ||
          item.type === 'output-selector' || item.type === 'sub-grid') return false
        const next = new Set(path)
        next.add(key)
        if (item.type === 'knob' && parameter === 'value') return canInput(item, parameter, next)
        if (item.type === 'mod-wheel' && parameter === 'value' &&
          options.wheelPositions?.has(id) && !options.automatedWheels?.has(id)) return canInput(item, 'depth', next)
        if (item.type === 'lfo' && parameter === 'value') {
          if (item.settings.smoothness > 0) return false
          if (layout.connections.some((wire) => wire.targetId === id &&
            (wire.targetParameter === 'waveform' || wire.targetParameter === 'rateMode')) ||
            options.boundaryInputs?.has(`${id}:waveform`) || options.boundaryInputs?.has(`${id}:rateMode`)) return false
          return ['depth', 'offset', 'rate'].every((input) => canInput(item, input, next))
        }
        return true
      }
      const canInput = (target: GridItem, parameter: string, path: ReadonlySet<string>): boolean =>
        !options.boundaryInputs?.has(`${target.id}:${parameter}`) &&
        layout.connections.filter((wire) => wire.targetId === target.id && wire.targetParameter === parameter)
          .every((wire) => canSource(wire.sourceId, wire.sourceParameter, path))
      const inputGraph = (target: GridItem, parameter: string, base: number): Tone.ToneAudioNode | null | undefined => {
        const input = inputs(target).find((entry) => entry.id === parameter && entry.kind === 'number')
        if (!input || input.choices || input.min === undefined || input.max === undefined || input.min >= input.max ||
          options.boundaryInputs?.has(`${target.id}:${parameter}`)) return null
        const min = input.min
        const max = input.max
        let absolute: Tone.ToneAudioNode | undefined
        const adjustments: Tone.ToneAudioNode[] = []
        for (const wire of layout.connections.filter((entry) => entry.targetId === target.id && entry.targetParameter === parameter)) {
          const source = sourceGraph(wire.sourceId, wire.sourceParameter)
          if (source === null) return null
          if (!source) continue
          const { signal } = source
          const center = (signal.max + signal.min) / 2
          const half = (signal.max - signal.min) / 2
          const translate = create(new Tone.Add(-center))
          const normalize = create(new Tone.Multiply(1 / half))
          const result = numericContribution(wire, signal, target, min, max)
          const shape = create(new Tone.WaveShaper((value) => {
            const mapped = numericContribution(wire, { ...signal, value: center + value * half }, target, min, max)
            return mapped.absolute ?? mapped.adjustment ?? 0
          }, 2049))
          connect(source.node, translate)
          connect(translate, normalize)
          connect(normalize, shape)
          if (result.absolute !== undefined) absolute = shape
          else adjustments.push(shape)
        }
        if (!absolute && !adjustments.length) return undefined
        const sum = create(new Tone.Gain(1))
        connect(absolute ?? inputBase(target, parameter, base), sum)
        for (const adjustment of adjustments) connect(adjustment, sum)
        const center = (max + min) / 2
        const half = (max - min) / 2
        const translate = create(new Tone.Add(-center))
        const normalize = create(new Tone.Multiply(1 / half))
        const clamp = create(new Tone.WaveShaper((value) => {
          const mapped = center + value * half
          return target.type === 'tone-element' && target.settings.elementType === 'delay' && parameter === 'feedback'
            ? Math.min(0.99, mapped) : mapped
        }, 2049))
        connect(sum, translate)
        connect(translate, normalize)
        connect(normalize, clamp)
        return clamp
      }
      const sourceGraph = (id: string, parameter: string): Source | null | undefined => {
        const key = `${id}:${parameter}`
        if (sources.has(key)) return sources.get(key)
        if (resolving.has(key)) return null
        const item = items.find((candidate) => candidate.id === id)
        const output = item && outputs(item).find((entry) => entry.id === parameter && entry.kind === 'number')
        if (!item || !output || output.min === undefined || output.max === undefined || output.min >= output.max) return null
        if (item.type === 'output-selector' || item.type === 'sub-grid') return null
        resolving.add(key)
        let node: Tone.ToneAudioNode | null | undefined
        let value = options.signals?.get(key)
        if (item.type === 'lfo' && parameter === 'value') {
          if (layout.connections.some((wire) => wire.targetId === id &&
            (wire.targetParameter === 'waveform' || wire.targetParameter === 'rateMode')) ||
            options.boundaryInputs?.has(`${id}:waveform`) || options.boundaryInputs?.has(`${id}:rateMode`)) node = null
          else {
            const oscillator = this.lfos.get(id)?.node
            if (!oscillator) node = null
            else {
              const depthInput = inputGraph(item, 'depth', item.settings.depth)
              const offsetInput = inputGraph(item, 'offset', item.settings.offset)
              const rateInput = inputGraph(item, 'rate', item.settings.rate)
              if (depthInput === null || offsetInput === null || rateInput === null) node = null
              else {
                const depth = create(new Tone.Multiply(0))
                const offset = create(new Tone.Add(0))
                const clamp = create(new Tone.WaveShaper((sample) => sample, 2049))
                connect(depthInput ?? inputBase(item, 'depth', item.settings.depth), depth.factor)
                connect(offsetInput ?? inputBase(item, 'offset', item.settings.offset), offset.addend)
                if (rateInput) {
                  const rate = create(new Tone.Multiply(item.settings.rateMode === 'sync' ? (options.bpm ?? 120) / 60 : 1))
                  connect(rateInput, rate)
                  connect(rate, oscillator.frequency)
                  this.rateDrivenLfos.add(id)
                }
                connect(oscillator, depth)
                connect(depth, offset)
                connect(offset, clamp)
                node = clamp
              }
            }
          }
          value = 0
        } else if (item.type === 'tone-element' && item.settings.elementType === 'envelope' && parameter === 'value') {
          node = this.getEnvelopeSignal(id) ?? null
          value = 0
        } else if (item.type === 'knob' && parameter === 'value') {
          value = Math.max(output.min, Math.min(output.max, value ?? item.settings.value))
          const input = inputGraph(item, parameter, value)
          node = input === null ? null : input ?? inputBase(item, parameter, value)
        } else if (item.type === 'mod-wheel' && parameter === 'value' &&
          options.wheelPositions?.has(id) && !options.automatedWheels?.has(id)) {
          const depth = inputGraph(item, 'depth', item.settings.depth)
          const position = options.wheelPositions.get(id)!
          if (depth === null) node = null
          else {
            const multiply = create(new Tone.Multiply(0))
            const wheel = constant(position, (_items, next) => next.wheelPositions?.get(id))
            connect(depth ?? inputBase(item, 'depth', item.settings.depth), multiply.factor)
            connect(wheel, multiply)
            node = multiply
          }
          value = 0
        } else if (value !== undefined && Number.isFinite(value)) {
          node = constant(value, (_items, next) => next.signals?.get(key))
        }
        const result: Source | null | undefined = node && value !== undefined
          ? { node, signal: { value, min: output.min, max: output.max, source: item } }
          : node === null ? null : undefined
        resolving.delete(key)
        sources.set(key, result)
        return result
      }

      for (const item of items) {
        if (item.type !== 'tone-element' || item.settings.elementType === 'oscillator' || item.settings.elementType === 'noise') continue
        for (const input of inputs(item)) {
          if (input.kind !== 'number') continue
          const param = this.getModulationParam(item.id, input.id)
          const base = this.baseToneParameter(item, input.id)
          if (!param || base === undefined || !canInput(item, input.id, new Set())) continue
          const node = inputGraph(item, input.id, base)
          if (node) {
            connect(node, param)
            this.drivenParams.add(`${item.id}:${input.id}`)
          }
        }
      }
      for (const item of items) {
        if (item.type !== 'knob') continue
        const source = sources.get(`${item.id}:value`)
        if (!source) continue
        const center = (source.signal.max + source.signal.min) / 2
        const half = (source.signal.max - source.signal.min) / 2
        const translate = create(new Tone.Add(-center))
        const normalize = create(new Tone.Multiply(1 / half))
        const waveform = create(new Tone.Waveform(16))
        connect(source.node, translate)
        connect(translate, normalize)
        connect(normalize, waveform)
        this.modulationMonitors.set(item.id, { waveform, center, half })
      }
      this.modulationSignature = signature
    }
    for (const { node, read } of this.modulationValues) {
      const value = read(items, options)
      if (value !== undefined && Number.isFinite(value) && node.value !== value) node.value = value
    }
  }

  private modulationSignature = ''
  private readonly appliedParams = new Map<string, number>()

  private clearModulation() {
    for (const { from, to } of this.modulationEdges) {
      if (!from.disposed) from.disconnect(to)
      if (to instanceof Tone.Signal && !to.disposed) to.overridden = false
    }
    this.modulationEdges = []
    for (const node of this.modulationNodes) node.dispose()
    this.modulationNodes = []
    this.modulationValues = []
    this.modulationMonitors.clear()
    this.drivenParams.clear()
    for (const id of this.rateDrivenLfos) {
      const lfo = this.lfos.get(id)
      if (lfo && !lfo.node.disposed) lfo.node.frequency.value = lfo.frequency
    }
    this.rateDrivenLfos.clear()
  }

  private baseToneParameter(item: Extract<GridItem, { type: 'tone-element' }>, parameter: string): number | undefined {
    const value = item.settings[parameter as keyof typeof item.settings]
    return typeof value === 'number' ? value : undefined
  }

  setNotes(id: string, notes: HeldNote[]) {
    const entry = this.entries.get(id)
    if (!(entry?.processor instanceof Tone.Envelope)) return
    const active = notes.length > 0
    if (active && !entry.active) entry.processor.triggerAttack(undefined, notes[notes.length - 1]!.velocity / 127)
    else if (!active && entry.active) entry.processor.triggerRelease()
    entry.active = active
  }

  private disconnectEdges() {
    for (const edge of this.edges) {
      if (!edge.from.disposed && (!(edge.to instanceof Tone.ToneAudioNode) || !edge.to.disposed)) edge.from.disconnect(edge.to)
    }
    this.edges = []
  }

  private disposeEntry(entry: Entry) {
    for (const channel of entry.channels?.values() ?? []) channel.dispose()
    entry.dry?.dispose()
    entry.wet?.dispose()
    if (entry.processor && entry.processor !== entry.input && entry.processor !== entry.output) entry.processor.dispose()
    entry.input.dispose()
    if (entry.output !== entry.input) entry.output.dispose()
  }

  dispose() {
    this.disconnectEdges()
    this.clearModulation()
    for (const lfo of this.lfos.values()) { lfo.waveform.dispose(); lfo.node.dispose() }
    this.lfos.clear()
    if (this.parentInput && !this.parentInput.disposed) this.parentInput.disconnect(this.input)
    for (const entry of this.entries.values()) {
      this.disposeEntry(entry)
    }
    this.entries.clear()
    for (const node of this.ports.values()) node.dispose()
    this.ports.clear()
    this.input.dispose()
    this.output.dispose()
    if (--this.master.users === 0) {
      this.master.pre.dispose()
      this.master.post.dispose()
      master = undefined
    }
  }
}
