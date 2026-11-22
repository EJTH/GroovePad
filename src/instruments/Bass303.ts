import * as Tone from 'tone'
import { defaultEnvelope } from './defaultEnvelope'
import type { Bass303Params, InstrumentInstance } from './types'

export class Bass303 implements InstrumentInstance {
  readonly type = '303' as const
  readonly params: Bass303Params
  private readonly synth: Tone.MonoSynth
  private activeNote: number | undefined

  constructor(params: Partial<Bass303Params>) {
    this.params = {
      transpose: params.transpose ?? 0,
      resonance: params.resonance ?? 6,
      volume: params.volume ?? -12,
      envelope: { ...(params.envelope ?? defaultEnvelope('303')) },
      filterFrequency: params.filterFrequency ?? 1000,
      filterEnvelope: { ...(params.filterEnvelope ?? defaultEnvelope('303')) },
      filterAmount: params.filterAmount ?? 0.6,
      slideTime: params.slideTime ?? 0.08,
    }
    this.synth = new Tone.MonoSynth({
      volume: this.params.volume,
      oscillator: { type: 'square' },
      envelope: this.params.envelope,
      filter: { type: 'lowpass', rolloff: -24, Q: this.params.resonance },
      filterEnvelope: {
        ...this.params.filterEnvelope,
        baseFrequency: this.params.filterFrequency,
        octaves: this.params.filterAmount * 4,
      },
      portamento: this.params.slideTime,
    }).toDestination()
  }

  trigger(velocity: number, note = 60): void {
    this.activeNote = note
    const pitch = Math.max(0, Math.min(127, note + this.params.transpose))
    this.synth.triggerAttack(Tone.Frequency(pitch, 'midi').toFrequency(), Tone.now(), velocity / 127)
  }

  release(): void {
    this.activeNote = undefined
    this.synth.triggerRelease()
  }

  updateParameter(param: string, value: number): void {
    switch (param) {
      case 'transpose':
        this.params.transpose = value
        if (this.activeNote !== undefined) {
          this.synth.setNote(Tone.Frequency(Math.max(0, Math.min(127, this.activeNote + value)), 'midi').toFrequency())
        }
        break
      case 'volume': this.params.volume = value; this.synth.volume.rampTo(value, 0.02); break
      case 'resonance': this.params.resonance = value; this.synth.filter.Q.rampTo(value, 0.02); break
      case 'slideTime': this.params.slideTime = value; this.synth.portamento = value; break
      case 'filterFrequency': this.params.filterFrequency = value; this.synth.filterEnvelope.baseFrequency = value; break
      case 'filterAmount': this.params.filterAmount = value; this.synth.filterEnvelope.octaves = value * 4; break
      case 'envelope.attack': this.params.envelope.attack = value; this.synth.envelope.attack = value; break
      case 'envelope.decay': this.params.envelope.decay = value; this.synth.envelope.decay = value; break
      case 'envelope.sustain': this.params.envelope.sustain = value; this.synth.envelope.sustain = value; break
      case 'envelope.release': this.params.envelope.release = value; this.synth.envelope.release = value; break
      case 'filterEnvelope.attack': this.params.filterEnvelope.attack = value; this.synth.filterEnvelope.attack = value; break
      case 'filterEnvelope.decay': this.params.filterEnvelope.decay = value; this.synth.filterEnvelope.decay = value; break
      case 'filterEnvelope.sustain': this.params.filterEnvelope.sustain = value; this.synth.filterEnvelope.sustain = value; break
      case 'filterEnvelope.release': this.params.filterEnvelope.release = value; this.synth.filterEnvelope.release = value; break
    }
  }

  dispose(): void {
    this.synth.dispose()
  }
}
