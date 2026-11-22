import { SampleHit } from './SampleHit'
import { SampleLoop } from './SampleLoop'
import { Bass303 } from './Bass303'
import { Drum808 } from './Drum808'
import type {
  InstrumentType,
  InstrumentInstance,
  AnyInstrumentParams,
  SampleHitParams,
  SampleLoopParams,
  Bass303Params,
  Drum808Params,
} from './types'

export type { InstrumentType, InstrumentInstance, AnyInstrumentParams, DrumType } from './types'
export { SampleHit, SampleLoop, Bass303, Drum808 }

export class InstrumentFactory {
  static create(type: InstrumentType, params: Partial<AnyInstrumentParams>): InstrumentInstance {
    switch (type) {
      case 'sample-hit':
        return new SampleHit(params as Partial<SampleHitParams>)
      case 'sample-loop':
        return new SampleLoop(params as Partial<SampleLoopParams>)
      case '303':
        return new Bass303(params as Partial<Bass303Params>)
      case '808':
        return new Drum808(params as Partial<Drum808Params>)
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
          volume: -12,
          pitch: 0,
          envelope: { attack: 0.01, decay: 0.1, sustain: 0, release: 0.1 },
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
          envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 },
        } as SampleLoopParams

      case '303':
        return {
          transpose: 0,
          resonance: 6,
          volume: -12,
          envelope: { attack: 0.005, decay: 0.3, sustain: 0, release: 0.1 },
          filterFrequency: 1000,
          filterEnvelope: { attack: 0.005, decay: 0.3, sustain: 0, release: 0.1 },
          filterAmount: 0.6,
          slideTime: 0.08,
        } as Bass303Params

      case '808':
        return {
          drum: 'kick',
          pitch: 150,
          volume: -12,
          envelope: { attack: 0.001, decay: 0.5, sustain: 0.1, release: 0.1 },
          tonality: 0.5,
          tone: 0.7,
        } as Drum808Params

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
