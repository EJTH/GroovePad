// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Tone from 'tone'
import type { HeldNote, ToneElementSettings } from '../grid'

export function oscillatorPitch(settings: ToneElementSettings, baseFrequency: number, notes: HeldNote[]) {
  const note = settings.notePriority === 'last'
    ? notes[notes.length - 1]
    : notes.reduce<HeldNote | undefined>((chosen, candidate) =>
      !chosen || (settings.notePriority === 'highest' ? candidate.note > chosen.note : candidate.note < chosen.note)
        ? candidate : chosen, undefined)
  const pitch = note ? 440 * 2 ** ((note.note + (note.bend ?? 0) - 69) / 12) : settings.frequency
  return { note, frequency: Math.max(0.01, Math.min(20000, pitch + (note ? settings.frequency - baseFrequency : 0))) }
}

type Voice = {
  gain: Tone.Gain
  note?: HeldNote
  held: boolean
  sounding: boolean
  frequency?: number
  sequence: number
} & ({ kind: 'gated'; source: Tone.Synth } | { kind: 'always-on'; source: Tone.Oscillator })

export class ToneOscillator {
  private readonly output: Tone.Gain
  private readonly voices: Voice[] = []
  private mode: Voice['kind']
  private sequence = 0

  constructor(settings: ToneElementSettings, destination?: Tone.InputNode) {
    this.mode = settings.noteMode === 'always-on' ? 'always-on' : 'gated'
    const output = new Tone.Gain(1)
    try {
      if (destination) output.connect(destination)
      else output.toDestination()
    } catch (error) {
      output.dispose()
      throw error
    }
    this.output = output
  }

  private createVoice(settings: ToneElementSettings): Voice {
    const gain = new Tone.Gain(0)
    let source: Tone.Synth | Tone.Oscillator | undefined
    try {
      gain.connect(this.output)
      if (this.mode === 'always-on') {
        const oscillator = new Tone.Oscillator({ type: settings.oscillatorType, volume: -12 })
        source = oscillator
        oscillator.connect(gain).start()
        return { kind: 'always-on', source: oscillator, gain, held: false, sounding: false, sequence: 0 }
      }
      const synth = new Tone.Synth({
        volume: -12,
        oscillator: { type: settings.oscillatorType },
        envelope: { attack: settings.attack, decay: 0.01, sustain: 1, release: settings.release },
      })
      source = synth
      synth.connect(gain)
      return { kind: 'gated', source: synth, gain, held: false, sounding: false, sequence: 0 }
    } catch (error) {
      source?.dispose()
      gain.dispose()
      throw error
    }
  }

  update(settings: ToneElementSettings, baseFrequency: number, notes: HeldNote[], continuous: boolean, time = Tone.immediate()) {
    const mode = settings.noteMode === 'always-on' ? 'always-on' : 'gated'
    if (mode !== this.mode) {
      for (const voice of this.voices.splice(0)) { voice.source.dispose(); voice.gain.dispose() }
      this.mode = mode
    }

    const unique = new Map<number, HeldNote>()
    for (const note of notes) { unique.delete(note.note); unique.set(note.note, note) }
    const ordered = [...unique.values()]
    if (settings.notePriority === 'last') ordered.reverse()
    else ordered.sort((a, b) => settings.notePriority === 'highest' ? b.note - a.note : a.note - b.note)
    const selected = ordered.slice(0, settings.polyphony)
    for (const voice of this.voices) voice.held = !!voice.note && selected.some((note) => note.note === voice.note!.note)
    for (const note of unique.values()) {
      if (!selected.includes(note)) continue
      let voice = this.voices.find((entry) => entry.held && entry.note?.note === note.note)
      if (!voice) {
        voice = this.voices.find((entry) => !entry.held && entry.note?.note === note.note) ??
          this.voices.find((entry) => !entry.held && !entry.note) ??
          this.voices.filter((entry) => !entry.held).sort((a, b) => a.sequence - b.sequence)[0]
        if (!voice && this.voices.length < settings.polyphony) {
          voice = this.createVoice(settings)
          this.voices.push(voice)
        }
        if (!voice) continue
        voice.sequence = ++this.sequence
      }
      voice.note = note
      voice.held = true
    }
    while (this.voices.length > settings.polyphony) {
      const voice = [...this.voices].sort((a, b) => Number(a.held) - Number(b.held) || a.sequence - b.sequence)[0]!
      this.voices.splice(this.voices.indexOf(voice), 1)
      voice.source.dispose()
      voice.gain.dispose()
    }
    if (!selected.length && continuous && !this.voices.length) this.voices.push(this.createVoice(settings))
    const fallback = !selected.length && continuous && this.mode === 'gated' ? this.voices[0] : undefined
    if (fallback) fallback.note = undefined

    for (const voice of this.voices) {
      if (voice.kind === 'gated') {
        voice.source.oscillator.type = settings.oscillatorType
        voice.source.envelope.attack = settings.attack
        voice.source.envelope.release = settings.release
      } else {
        voice.source.type = settings.oscillatorType
      }
      voice.source.detune.rampTo(settings.detune, 0.01, time)
      const active = voice.held || voice.kind === 'always-on' || voice === fallback
      if (!active) {
        if (voice.kind === 'gated' && voice.sounding) voice.source.triggerRelease(time)
        voice.sounding = false
        voice.note = undefined
        voice.frequency = undefined
        continue
      }
      const { frequency } = oscillatorPitch(settings, baseFrequency, voice.note ? [voice.note] : [])
      voice.gain.gain.rampTo(voice.note ? Math.max(0, Math.min(1, voice.note.velocity / 127)) : 0.7, 0.01, time)
      if (voice.kind === 'always-on') {
        if (voice.frequency !== frequency) voice.source.frequency.rampTo(frequency, 0.01, time)
      } else if (!voice.sounding) {
        voice.source.triggerAttack(frequency, time)
      } else if (voice.frequency !== frequency) {
        voice.source.setNote(frequency, time)
      }
      voice.sounding = true
      voice.frequency = frequency
    }
  }

  dispose() {
    for (const voice of this.voices.splice(0)) { voice.source.dispose(); voice.gain.dispose() }
    this.output.dispose()
  }
}
