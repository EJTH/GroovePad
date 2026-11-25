// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import { SampleHit } from './SampleHit'
import { SampleLoop } from './SampleLoop'
import { Bass303 } from './Bass303'
import { Drum808 } from './Drum808'
import { Drum909 } from './Drum909'
import { DrumKit } from './DrumKit'
import { defaultEnvelope } from './defaultEnvelope'
import type { InputNode } from 'tone'
import type {
  InstrumentType,
  InstrumentInstance,
  AnyInstrumentParams,
  SampleHitParams,
  SampleLoopParams,
  Bass303Params,
  Drum808Params,
  Drum909Params,
} from './types'

export type { InstrumentType, InstrumentInstance, AnyInstrumentParams, DrumType } from './types'
export { SampleHit, SampleLoop, Bass303, Drum808, Drum909, DrumKit }

export class InstrumentFactory {
  static create(type: InstrumentType, params: Partial<AnyInstrumentParams>, output?: InputNode): InstrumentInstance {
    switch (type) {
      case 'sample-hit':
        return new SampleHit(params as Partial<SampleHitParams>, output)
      case 'sample-loop':
        return new SampleLoop(params as Partial<SampleLoopParams>, output)
      case '303':
        return new Bass303(params as Partial<Bass303Params>, output)
      case '808':
        return new Drum808(params as Partial<Drum808Params>, output)
      case '909':
        return new Drum909(params as Partial<Drum909Params>, output)
      default:
        const exhaustive: never = type
        throw new Error(`Unknown instrument type: ${exhaustive}`)
    }
  }

  static getDefaultParams(type: InstrumentType): AnyInstrumentParams {
    switch (type) {
      case 'sample-hit':
        return {
          sample: '',
          sampleName: '',
          start: 0,
          end: 1,
          cuts: [],
          playback: 'order',
          loopMode: 'once',
          reverse: false,
          polyphony: 1,
          volume: -12,
          pitch: 0,
          envelope: defaultEnvelope(type),
        } as SampleHitParams

      case 'sample-loop':
        return {
          sample: '',
          sampleName: '',
          cuts: [],
          playback: 'order',
          volume: -12,
          pitch: 0,
          loopStart: 0,
          loopEnd: 1,
          envelope: defaultEnvelope(type),
        } as SampleLoopParams

      case '303':
        return {
          transpose: 0,
          resonance: 6,
          volume: -12,
          envelope: defaultEnvelope(type),
          filterFrequency: 1000,
          filterEnvelope: defaultEnvelope(type),
          filterAmount: 0.6,
          slideTime: 0.08,
        } as Bass303Params

      case '808':
        return {
          drum: 'kick',
          pitch: 150,
          volume: -12,
          envelope: defaultEnvelope(type),
          tonality: 0.5,
          tone: 0.7,
        } as Drum808Params

      case '909':
        return {
          drum: 'kick',
          pitch: 150,
          volume: -12,
          envelope: defaultEnvelope(type),
          tonality: 0.5,
          tone: 0.7,
        } as Drum909Params

      default:
        const exhaustive: never = type
        throw new Error(`Unknown instrument type: ${exhaustive}`)
    }
  }
}

export class InstrumentManager {
  private instruments: Map<string, InstrumentInstance> = new Map()

  createInstrument(id: string, type: InstrumentType, params?: Partial<AnyInstrumentParams>): InstrumentInstance {
    const existing = this.instruments.get(id)
    if (existing) {
      existing.dispose()
    }

    const instrument = InstrumentFactory.create(type, params || {})
    this.instruments.set(id, instrument)
    return instrument
  }

  getInstrument(id: string): InstrumentInstance | undefined {
    return this.instruments.get(id)
  }

  removeInstrument(id: string): void {
    const instrument = this.instruments.get(id)
    if (instrument) {
      instrument.dispose()
      this.instruments.delete(id)
    }
  }

  dispose(): void {
    for (const instrument of this.instruments.values()) {
      instrument.dispose()
    }
    this.instruments.clear()
  }
}
