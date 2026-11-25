// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Tone from 'tone'
import type { ExposedPort, GridItem, GridLayout, HeldNote } from '../grid'
import { audioBoundaryKey, audioInput, audioOutput, isAudioSource, mixerAudioInputs, planAudioRoutes } from './audioRoutes'

type AudioItem = Extract<GridItem, { type: 'tone-element' | 'sub-grid' | 'instrument-pad' }>
type Processor = Tone.Gain | Tone.Filter | Tone.FeedbackDelay | Tone.Reverb | Tone.Envelope
interface Entry {
  type: string
  input: Tone.ToneAudioNode
  output: Tone.ToneAudioNode
  processor?: Processor
  active?: boolean
  channels?: Map<string, Tone.Channel>
}
export interface BoundaryAudio {
  port: ExposedPort
  node: Tone.ToneAudioNode
}

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
        return { type: elementType, input: gainNode, output: gainNode, processor: envelope }
      }
    }
    return { type: elementType, input: node, output: node, processor: node }
  }

  update(layout: GridLayout, boundary: BoundaryAudio[] = []) {
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
        const target = items.find((item) => item.type === 'tone-element' && item.settings.elementType === 'mixer' &&
          edge.to === audioInput(item.id))
        const channel = target ? this.entries.get(target.id)?.channels?.get(edge.from) : undefined
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
    for (const item of items) {
      if (item.type !== 'tone-element') continue
      const node = this.entries.get(item.id)?.processor
      const s = item.settings
      if (node instanceof Tone.Filter) {
        node.frequency.rampTo(s.cutoff, 0.02)
        node.Q.rampTo(s.gain, 0.02)
      } else if (node instanceof Tone.FeedbackDelay) {
        node.delayTime.rampTo(s.delayTime, 0.02)
        node.feedback.rampTo(Math.min(s.feedback, 0.99), 0.02)
        node.wet.rampTo(Math.min(s.gain, 1), 0.02)
      } else if (node instanceof Tone.Reverb) {
        if (node.decay !== s.decay) {
          node.decay = s.decay
          void node.ready.catch((error: unknown) => this.reportError(`Reverb could not be generated: ${error instanceof Error ? error.message : String(error)}`))
        }
        node.wet.rampTo(Math.min(s.gain, 1), 0.02)
      } else if (node instanceof Tone.Envelope) {
        node.attack = s.attack
        node.decay = s.decay
        node.sustain = s.sustain
        node.release = s.release
      } else if (node instanceof Tone.Gain && !isAudioSource(item)) {
        node.gain.rampTo(s.gain, 0.02)
      }
      if (item.settings.elementType === 'mixer') {
        const entry = this.entries.get(item.id)
        const soloed = [...(entry?.channels?.keys() ?? [])].some((key) => s.mixerChannels?.[key]?.solo)
        for (const [key, channel] of entry?.channels ?? []) {
          const settings = s.mixerChannels?.[key]
          channel.volume.rampTo(settings?.volume ?? 0, 0.02)
          channel.pan.rampTo(settings?.pan ?? 0, 0.02)
          channel.mute = soloed && !settings?.solo
        }
      }
    }
    return rerouted
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
    if (entry.processor && entry.processor !== entry.input && entry.processor !== entry.output) entry.processor.dispose()
    entry.input.dispose()
    if (entry.output !== entry.input) entry.output.dispose()
  }

  dispose() {
    this.disconnectEdges()
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
