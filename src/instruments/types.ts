export type InstrumentType = 'sample-hit' | 'sample-loop' | '303' | '808'
export type DrumType = 'kick' | 'snare' | 'closed-hat' | 'open-hat' | 'rim' | 'tom'

export interface ADSREnvelope {
  attack: number
  decay: number
  sustain: number
  release: number
}

export type SamplePlayback = 'random' | 'order' | 'loop' | `cut:${number}`

export interface SampleHitParams {
  sample: string
  sampleName: string
  start: number
  end: number
  cuts: number[]
  playback: SamplePlayback
  loopMode: 'once' | 'loop' | 'back-and-forth'
  reverse: boolean
  polyphony: number
  volume: number
  pitch: number
  envelope: ADSREnvelope
}

export interface SampleLoopParams {
  sample: string
  sampleName: string
  cuts: number[]
  playback: SamplePlayback
  volume: number
  pitch: number
  loopStart: number
  loopEnd: number
  envelope: ADSREnvelope
}

export interface Bass303Params {
  transpose: number
  resonance: number
  volume: number
  envelope: ADSREnvelope
  filterFrequency: number
  filterEnvelope: ADSREnvelope
  filterAmount: number
  slideTime: number
}

export interface Drum808Params {
  drum: DrumType
  pitch: number
  volume: number
  envelope: ADSREnvelope
  tonality: number
  tone: number
}

export type AnyInstrumentParams = SampleHitParams | SampleLoopParams | Bass303Params | Drum808Params

export interface InstrumentInstance {
  type: InstrumentType
  params: AnyInstrumentParams
  trigger(velocity: number, note?: number): void | Promise<void>
  setPitchBend?(semitones: number): void
  release(): void
  dispose(): void
}

export interface InstrumentFactory {
  create(params: Partial<AnyInstrumentParams>): InstrumentInstance
}
