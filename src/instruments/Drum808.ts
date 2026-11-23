import * as Tone from 'tone'
import { defaultEnvelope } from './defaultEnvelope'
import type { Drum808Params, DrumType, InstrumentInstance, ADSREnvelope } from './types'

export class Drum808 implements InstrumentInstance {
  type = '808' as const
  params: Drum808Params
  private synth: Tone.Synth | null = null
  private noiseOsc: Tone.Oscillator | null = null
  private noiseGain: Tone.Gain | null = null
  private filter: Tone.Filter | null = null
  private noiseFilter: Tone.Filter | null = null
  private masterGain: Tone.Gain | null = null
  private currentDrumType: DrumType

  constructor(params: Partial<Drum808Params>) {
    this.currentDrumType = params.drum || 'kick'
    this.params = {
      drum: this.currentDrumType,
      pitch: params.pitch ?? 150,
      volume: params.volume ?? -12,
      envelope: params.envelope ?? defaultEnvelope('808'),
      tonality: params.tonality ?? 0.5,
      tone: params.tone ?? 0.7,
    }
    this.initialize()
  }

  private initialize(): void {
    this.masterGain = new Tone.Gain(10 ** (this.params.volume / 20))

    this.synth = new Tone.Synth({
      oscillator: {
        type: 'sine',
      },
      envelope: this.params.envelope,
    })

    this.noiseOsc = new Tone.Oscillator({
      type: 'square',
      frequency: 50,
    })
    this.noiseGain = new Tone.Gain(0)

    this.filter = new Tone.Filter({
      frequency: 2000,
      type: 'lowpass',
      rolloff: -12,
    })

    this.noiseFilter = new Tone.Filter({
      frequency: 6000,
      type: 'highpass',
      rolloff: -12,
    })

    this.synth.connect(this.filter)
    this.noiseOsc.connect(this.noiseGain)
    this.noiseGain.connect(this.noiseFilter)
    this.noiseFilter.connect(this.filter)
    this.filter.connect(this.masterGain)
    this.masterGain.toDestination()

    this.noiseOsc.start()
  }

  private getDrumParameters(): {
    pitch: number
    decay: number
    attackPitch?: number
    noiseMix: number
  } {
    switch (this.params.drum) {
      case 'kick':
        return { pitch: 60, decay: 0.6, attackPitch: 150, noiseMix: 0 }
      case 'snare':
        return { pitch: 150, decay: 0.15, noiseMix: 0.7 }
      case 'closed-hat':
        return { pitch: 350, decay: 0.08, noiseMix: 0.9 }
      case 'open-hat':
        return { pitch: 300, decay: 0.3, noiseMix: 0.85 }
      case 'rim':
        return { pitch: 400, decay: 0.1, noiseMix: 0.5 }
      case 'tom':
        return { pitch: 250, decay: 0.12, noiseMix: 0.1 }
      default:
        return { pitch: 60, decay: 0.5, noiseMix: 0 }
    }
  }

  trigger(velocity: number): void {
    if (!this.synth || !this.filter || !this.noiseOsc || !this.noiseGain || !this.noiseFilter) return

    const velocityGain = velocity / 127
    const drumParams = this.getDrumParameters()
    const now = Tone.now()

    const pitchShift = (this.params.pitch - 150) / 300
    const finalPitch = drumParams.pitch * (1 + pitchShift * 0.5)
    const finalDecay = drumParams.decay

    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(10 ** (this.params.volume / 20) * velocityGain, now)
    }

    const filterFreqStart = 2000 + this.params.tone * 2000
    const filterFreqEnd = 300 + this.params.tone * 500

    this.filter.frequency.setValueAtTime(filterFreqStart, now)
    this.filter.frequency.exponentialRampToValueAtTime(filterFreqEnd, now + finalDecay * 0.5)

    if (this.params.drum === 'kick' && drumParams.attackPitch) {
      const startPitch = drumParams.attackPitch * (1 + pitchShift * 0.5)
      this.synth.frequency.setValueAtTime(startPitch, now)
      this.synth.frequency.exponentialRampToValueAtTime(finalPitch, now + finalDecay * 0.25)
      this.synth.triggerAttackRelease(finalDecay, now)
      this.noiseGain.gain.setValueAtTime(0, now)
    } else {
      this.synth.triggerAttackRelease(finalPitch, finalDecay * 0.6, now)
      
      const noiseMix = Math.min(1, drumParams.noiseMix * 2 * (1 - this.params.tonality))
      if (noiseMix > 0) {
        this.noiseGain.gain.setValueAtTime(noiseMix * velocityGain * 0.6, now)
        this.noiseGain.gain.exponentialRampToValueAtTime(0.01, now + finalDecay * 0.8)
        
        const noiseFilterStart = this.params.drum === 'closed-hat' ? 10000 : this.params.drum === 'open-hat' ? 9000 : 6000
        this.noiseFilter.frequency.setValueAtTime(noiseFilterStart, now)
        this.noiseFilter.frequency.exponentialRampToValueAtTime(2000, now + finalDecay * 0.7)
      } else {
        this.noiseGain.gain.setValueAtTime(0, now)
      }
    }
  }

  release(): void {
    // Drum hits finish their own envelope after the pad is released.
  }

  setPitchBend(semitones: number): void {
    this.synth?.detune.setValueAtTime(semitones * 100, Tone.now())
  }

  updateParameter(param: string, value: number | string): void {
    if (param.startsWith('envelope.')) {
      const envParam = param.split('.')[1] as keyof ADSREnvelope
      const env = this.params.envelope as ADSREnvelope
      env[envParam] = value as any
      if (this.synth) {
        this.synth.set({ envelope: { [envParam]: value } })
      }
    } else {
      switch (param) {
        case 'drum':
          this.params.drum = value as DrumType
          this.currentDrumType = value as DrumType
          break
        case 'pitch':
          this.params.pitch = value as number
          break
        case 'volume':
          this.params.volume = value as number
          if (this.masterGain) {
            this.masterGain.gain.rampTo(10 ** (Number(value) / 20), 0.1)
          }
          break
        case 'tonality':
          this.params.tonality = value as number
          break
        case 'tone':
          this.params.tone = value as number
          break
      }
    }
  }

  dispose(): void {
    this.synth?.dispose()
    this.noiseOsc?.stop()
    this.noiseOsc?.dispose()
    this.noiseGain?.dispose()
    this.filter?.dispose()
    this.noiseFilter?.dispose()
    this.masterGain?.dispose()
  }
}
