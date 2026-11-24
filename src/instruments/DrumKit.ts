// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Tone from 'tone'
import { defaultEnvelope } from './defaultEnvelope'
import type { ADSREnvelope, DrumKitParams, DrumKitType, DrumType, InstrumentInstance } from './types'

interface NoiseLayer {
  synth: Tone.NoiseSynth
  gain: Tone.Gain
  filter: Tone.Filter
}

type DrumVoice =
  | { kind: 'kick'; membrane: Tone.MembraneSynth; click?: NoiseLayer }
  | { kind: 'snare'; body: Tone.Synth; noise: NoiseLayer }
  | { kind: 'hat'; synth: Tone.MetalSynth }
  | { kind: 'rim'; body: Tone.Synth; noise: NoiseLayer }
  | { kind: 'tom'; membrane: Tone.MembraneSynth }

export class DrumKit<T extends DrumKitType> implements InstrumentInstance {
  readonly type: T
  readonly params: DrumKitParams
  private readonly masterGain: Tone.Gain
  private voice: DrumVoice
  private envelopes: Tone.Envelope[] = []
  private pitchBend = 0

  constructor(params: Partial<DrumKitParams>, type: T) {
    this.type = type
    this.params = {
      drum: params.drum ?? 'kick',
      pitch: params.pitch ?? 150,
      volume: params.volume ?? -12,
      envelope: { ...(params.envelope ?? defaultEnvelope(type)) },
      tonality: params.tonality ?? 0.5,
      tone: params.tone ?? 0.7,
    }

    this.masterGain = new Tone.Gain(10 ** (this.params.volume / 20)).toDestination()
    this.voice = this.createVoice(this.params.drum)
    this.updateTone()
  }

  trigger(velocity: number): void {
    const now = Tone.now()
    const level = Math.max(0, Math.min(1, velocity / 127))
    const pitchScale = 2 ** (this.pitchBend / 12) * this.params.pitch / 150
    const hit = (duration: number): number => Math.max(0.02, Math.min(duration, this.params.envelope.decay * 2))

    switch (this.voice.kind) {
      case 'kick':
        this.voice.membrane.triggerAttackRelease(Math.max(30, 50 * pitchScale), hit(0.45), now, level)
        this.voice.click?.synth.triggerAttackRelease(0.025, now, level)
        break
      case 'snare':
        this.voice.body.triggerAttackRelease(Math.max(80, 180 * pitchScale * (this.type === '909' ? 1.1 : 1)), hit(0.16), now, level)
        const noiseLevel = Math.min(1, level * (1 - this.params.tonality) * (this.type === '909' ? 1.25 : 1))
        if (noiseLevel > 0) this.voice.noise.synth.triggerAttackRelease(hit(0.2), now, noiseLevel)
        break
      case 'hat':
        this.voice.synth.triggerAttackRelease(Math.max(100, 250 * pitchScale),
          hit(this.params.drum === 'closed-hat' ? 0.055 : 0.32), now, level)
        break
      case 'rim':
        this.voice.body.triggerAttackRelease(Math.max(200, 900 * pitchScale), hit(0.045), now, level)
        this.voice.noise.synth.triggerAttackRelease(hit(0.035), now, level * 0.35)
        break
      case 'tom':
        this.voice.membrane.triggerAttackRelease(Math.max(50, 125 * pitchScale), hit(0.22), now, level)
        break
    }
  }

  release(): void {
    // Drum hits finish their own envelope after the pad is released.
  }

  setPitchBend(semitones: number): void {
    this.pitchBend = semitones
  }

  updateParameter(param: string, value: number | string): void {
    if (param.startsWith('envelope.')) {
      const envParam = param.slice('envelope.'.length) as keyof ADSREnvelope
      if (envParam in this.params.envelope && typeof value === 'number') {
        this.params.envelope[envParam] = value
        for (const envelope of this.envelopes) envelope[envParam] = value
      }
      return
    }

    switch (param) {
      case 'drum': {
        const drum = value as DrumType
        if (drum === this.params.drum) break
        const bothAreHats = (this.params.drum === 'closed-hat' || this.params.drum === 'open-hat') &&
          (drum === 'closed-hat' || drum === 'open-hat')
        this.params.drum = drum
        if (!bothAreHats) {
          this.disposeVoice(this.voice)
          this.voice = this.createVoice(drum)
          this.updateTone()
        }
        break
      }
      case 'pitch':
        this.params.pitch = Number(value)
        break
      case 'volume':
        this.params.volume = Number(value)
        this.masterGain.gain.rampTo(10 ** (this.params.volume / 20), 0.02)
        break
      case 'tonality':
        this.params.tonality = Number(value)
        break
      case 'tone':
        this.params.tone = Number(value)
        this.updateTone()
        break
    }
  }

  private createVoice(drum: DrumType): DrumVoice {
    const envelope = { ...this.params.envelope }
    switch (drum) {
      case 'kick': {
        const membrane = new Tone.MembraneSynth({
          pitchDecay: this.type === '909' ? 0.025 : 0.04,
          octaves: this.type === '909' ? 5 : 6,
          oscillator: { type: 'sine' },
          envelope,
        }).connect(this.masterGain)
        const click = this.type === '909'
          ? this.createNoiseLayer(0.25, 'highpass', 2500, { attack: 0.001, decay: 0.015, sustain: 0, release: 0.01 })
          : undefined
        this.envelopes = [membrane.envelope]
        return { kind: 'kick', membrane, click }
      }
      case 'snare': {
        const body = new Tone.Synth({
          oscillator: { type: 'sine' },
          envelope,
        }).connect(this.masterGain)
        const noise = this.createNoiseLayer(1, 'bandpass', 5000, envelope)
        this.envelopes = [body.envelope, noise.synth.envelope]
        return { kind: 'snare', body, noise }
      }
      case 'closed-hat':
      case 'open-hat': {
        const synth = new Tone.MetalSynth({
          harmonicity: this.type === '909' ? 5.5 : 5.1,
          modulationIndex: this.type === '909' ? 45 : 32,
          resonance: this.type === '909' ? 7000 : 6000,
          octaves: 1.5,
          envelope,
        }).connect(this.masterGain)
        this.envelopes = [synth.envelope]
        return { kind: 'hat', synth }
      }
      case 'rim': {
        const body = new Tone.Synth({
          oscillator: { type: 'sine' },
          envelope,
        }).connect(this.masterGain)
        const noise = this.createNoiseLayer(0.35, 'highpass', 5000, envelope)
        this.envelopes = [body.envelope, noise.synth.envelope]
        return { kind: 'rim', body, noise }
      }
      case 'tom': {
        const membrane = new Tone.MembraneSynth({
          pitchDecay: 0.08,
          octaves: 3,
          oscillator: { type: 'sine' },
          envelope,
        }).connect(this.masterGain)
        this.envelopes = [membrane.envelope]
        return { kind: 'tom', membrane }
      }
    }
  }

  private createNoiseLayer(
    gainLevel: number,
    filterType: 'bandpass' | 'highpass',
    frequency: number,
    envelope: ADSREnvelope,
  ): NoiseLayer {
    const synth = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { ...envelope },
    })
    const gain = new Tone.Gain(gainLevel)
    const filter = new Tone.Filter({ type: filterType, frequency, Q: 0.7 })
    synth.connect(gain)
    gain.connect(filter)
    filter.connect(this.masterGain)
    return { synth, gain, filter }
  }

  private disposeNoiseLayer(layer: NoiseLayer): void {
    layer.synth.dispose()
    layer.gain.dispose()
    layer.filter.dispose()
  }

  private disposeVoice(voice: DrumVoice): void {
    switch (voice.kind) {
      case 'kick':
        voice.membrane.dispose()
        if (voice.click) this.disposeNoiseLayer(voice.click)
        break
      case 'snare':
        voice.body.dispose()
        this.disposeNoiseLayer(voice.noise)
        break
      case 'hat':
        voice.synth.dispose()
        break
      case 'rim':
        voice.body.dispose()
        this.disposeNoiseLayer(voice.noise)
        break
      case 'tom':
        voice.membrane.dispose()
        break
    }
  }

  private updateTone(): void {
    const now = Tone.now()
    if (this.voice.kind === 'snare') {
      this.voice.noise.filter.frequency.setValueAtTime(2500 + this.params.tone * 6500, now)
    } else if (this.voice.kind === 'rim') {
      this.voice.noise.filter.frequency.setValueAtTime(2000 + this.params.tone * 6000, now)
    } else if (this.voice.kind === 'hat') {
      this.voice.synth.resonance = 3000 + this.params.tone * 4000
    }
  }

  dispose(): void {
    this.disposeVoice(this.voice)
    this.masterGain.dispose()
  }
}
