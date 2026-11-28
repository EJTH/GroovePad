// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Tone from 'tone'
import type { InstrumentInstance, SampleHitParams, SampleLoopParams } from './types'
import { createSampleRegion, oneShotGateDuration } from './sampleRegion'
import { createHitLoop, createSliceLoop, scheduleLoopRelease, type HitLoopPlan } from './sampleHitLoop'

interface Voice {
  player: Tone.ToneBufferSource
  gain: Tone.Gain
  envelope: Tone.AmplitudeEnvelope
  note: number
  id?: string
  bend?: number
  startedAt: number
  looping: boolean
  released: boolean
  retired?: Set<Tone.ToneBufferSource>
  loopPlan?: { plan: HitLoopPlan; reversed?: AudioBuffer; lastTime: number; elapsedFrames: number; rate: number }
}

export abstract class SamplePlayer implements InstrumentInstance {
  abstract readonly type: 'sample-hit' | 'sample-loop'
  abstract readonly params: SampleHitParams | SampleLoopParams
  private readonly buffer = new Tone.ToneAudioBuffer()
  private loading: Promise<Tone.ToneAudioBuffer> | undefined
  private readonly voices = new Set<Voice>()
  private readonly retiredPlayers = new Set<Tone.ToneBufferSource>()
  private generation = 0
  private chokeGeneration = 0
  private nextCut = 0
  private disposed = false
  private pitchBend = 0
  private readonly noteGenerations = new Map<string, number>()
  private readonly noteBends = new Map<string, number>()

  private readonly output?: Tone.InputNode

  constructor(output?: Tone.InputNode) { this.output = output }

  async prepare(): Promise<void> {
    if (!this.params.sample || !/^data:[^,]*;base64,/.test(this.params.sample)) {
      throw new Error('Choose a sample file in the pad settings.')
    }
    if (!this.buffer.loaded) {
      this.loading ??= this.buffer.load(this.params.sample)
      try {
        await this.loading
      } catch (error) {
        this.loading = undefined
        throw error
      }
    }
  }

  async trigger(velocity: number, note = 60, time = Tone.immediate(), id?: string, bend = 0): Promise<void> {
    if (!this.params.sample || !/^data:[^,]*;base64,/.test(this.params.sample)) {
      throw new Error('Choose a sample file in the pad settings.')
    }
    const generation = this.generation
    const chokeGeneration = this.chokeGeneration
    const noteGeneration = id === undefined ? undefined : (this.noteGenerations.get(id) ?? 0)
    if (id !== undefined) this.noteBends.set(id, bend)
    const hit = 'start' in this.params ? this.params : undefined
    const looping = this.type === 'sample-loop' || (hit !== undefined && hit.loopMode !== 'once')
    if (!this.buffer.loaded) {
      await this.prepare()
    }
    if (this.disposed || chokeGeneration !== this.chokeGeneration || (looping && generation !== this.generation) ||
      (id !== undefined && noteGeneration !== (this.noteGenerations.get(id) ?? 0))) return

    const loop = this.type === 'sample-loop' && 'loopStart' in this.params ? this.params : undefined
    const start = loop ? loop.loopStart : hit!.start
    const end = loop ? loop.loopEnd : hit!.end
    const boundaries = [start, ...this.params.cuts, end]
    if (boundaries.some((value, index) => !Number.isFinite(value) || value < 0 || value > 1 ||
      (index > 0 && value <= boundaries[index - 1]!))) throw new Error('Sample markers must be in order.')
    const hitLooping = hit !== undefined && hit.loopMode !== 'once'
    const count = boundaries.length - 1
    let index = 0
    if (hitLooping) index = 0
    else if (this.params.playback === 'random') index = Math.floor(Math.random() * count)
    else if (this.params.playback === 'order') {
      index = this.nextCut % count
      this.nextCut = (index + 1) % count
    } else {
      index = Number(this.params.playback.slice(4))
      if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error('Selected cut is unavailable.')
    }
    let offset = boundaries[index]! * this.buffer.duration
    let length = (boundaries[index + 1]! - boundaries[index]!) * this.buffer.duration
    let loopStart = offset
    let loopEnd = offset + length
    let source: Tone.ToneAudioBuffer | AudioBuffer = this.buffer
    let hitPlan: HitLoopPlan | undefined
    let reversed: AudioBuffer | undefined
    const createBuffer = (channels: number, frames: number, sampleRate: number) =>
      Tone.getContext().createBuffer(channels, frames, sampleRate)
    if (hitLooping && hit) {
      const original = this.buffer.get()
      if (!original) throw new Error('Sample audio is not loaded.')
      hitPlan = createHitLoop(original, start, end, hit.cuts, hit.reverse, hit.loopMode === 'back-and-forth', createBuffer)
      if (hit.reverse || hit.loopMode === 'back-and-forth') {
        reversed = createSampleRegion(original, start, end, true, false, createBuffer)
      }
      source = hitPlan.buffer
      offset = 0
      length = source.duration
      loopStart = hitPlan.loopStartOffset / original.sampleRate
      loopEnd = hitPlan.loopEndOffset / original.sampleRate
    } else if (loop) {
      const original = this.buffer.get()
      if (!original) throw new Error('Sample audio is not loaded.')
      hitPlan = createSliceLoop(original, boundaries[index]!, boundaries[index + 1]!, end)
      offset = hitPlan.startFrame / original.sampleRate
      length = (hitPlan.endFrame - hitPlan.startFrame) / original.sampleRate
      loopStart = offset
      loopEnd = hitPlan.loopEndFrame / original.sampleRate
    } else if (hit?.reverse) {
      const original = this.buffer.get()
      if (!original) throw new Error('Sample audio is not loaded.')
      source = createSampleRegion(original, boundaries[index]!, boundaries[index + 1]!, hit.reverse,
        false, createBuffer)
      offset = 0
      length = source.duration
    }
    const voiceBend = id === undefined ? undefined : (this.noteBends.get(id) ?? bend)
    const rate = 2 ** ((note - 60 + this.params.pitch + (voiceBend ?? this.pitchBend)) / 12)
    if (hit) this.limitVoices(hit.polyphony - 1)
    const envelope = new Tone.AmplitudeEnvelope(this.params.envelope)
    if (this.output) envelope.connect(this.output)
    else envelope.toDestination()
    const gain = new Tone.Gain(10 ** (this.params.volume / 20)).connect(envelope)
    const player = new Tone.ToneBufferSource({
      url: source,
      playbackRate: rate,
      loop: looping,
      loopStart: looping ? loopStart : 0,
      loopEnd: looping ? loopEnd : 0,
    }).connect(gain)
    const now = Math.max(time, Tone.immediate())
    const voice: Voice = { player, gain, envelope, note, id, bend: voiceBend, startedAt: now, looping, released: false }
    if (hitPlan) voice.loopPlan = { plan: hitPlan, reversed, lastTime: now, elapsedFrames: 0, rate }
    this.voices.add(voice)
    player.onended = () => {
      if (!this.voices.delete(voice)) return
      player.dispose()
      gain.dispose()
      envelope.dispose()
    }
    if (looping) player.start(now, offset)
    else player.start(now, offset, length)
    if (looping) envelope.triggerAttack(now, velocity / 127)
    else envelope.triggerAttackRelease(
      oneShotGateDuration(length / rate, this.params.envelope.attack, this.params.envelope.release), now, velocity / 127,
    )
  }

  updateParameters(params: SampleHitParams | SampleLoopParams): void {
    const pitchChanged = this.params.pitch !== params.pitch
    const volumeChanged = this.params.volume !== params.volume
    Object.assign(this.params, params)
    if ('polyphony' in params) this.limitVoices(params.polyphony)
    const now = Tone.immediate()
    for (const voice of this.voices) {
      if (volumeChanged) voice.gain.gain.rampTo(10 ** (params.volume / 20), 0.02)
      Object.assign(voice.envelope, params.envelope)
      if (pitchChanged && !voice.released) {
        this.updateVoicePitch(voice, now)
      }
    }
  }

  setPitchBend(semitones: number, time = Tone.immediate()): void {
    if (this.pitchBend === semitones) return
    this.pitchBend = semitones
    const now = time
    for (const voice of this.voices) if (!voice.released && voice.bend === undefined) this.updateVoicePitch(voice, now)
  }

  setVoicePitchBend(id: string, semitones: number, time = Tone.immediate()): void {
    this.noteBends.set(id, semitones)
    const now = time
    for (const voice of this.voices) {
      if (voice.id !== id || voice.released || voice.bend === semitones) continue
      voice.bend = semitones
      this.updateVoicePitch(voice, now)
    }
  }

  private updateVoicePitch(voice: Voice, now: number): void {
    const rate = 2 ** ((voice.note - 60 + this.params.pitch + (voice.bend ?? this.pitchBend)) / 12)
    if (voice.loopPlan) {
      const sampleRate = this.buffer.get()?.sampleRate
      if (sampleRate !== undefined) {
        voice.loopPlan.elapsedFrames += (now - voice.loopPlan.lastTime) * sampleRate * voice.loopPlan.rate
      }
      voice.loopPlan.lastTime = now
      voice.loopPlan.rate = rate
    }
    voice.player.playbackRate.setValueAtTime(rate, now)
  }

  private limitVoices(limit: number): void {
    while (this.voices.size > limit) {
      const voice = this.voices.values().next().value
      if (!voice) break
      this.voices.delete(voice)
      voice.player.dispose()
      voice.gain.dispose()
      voice.envelope.dispose()
      for (const player of voice.retired ?? []) {
        this.retiredPlayers.delete(player)
        player.dispose()
      }
    }
  }

  release(id?: string, time = Tone.immediate()): void {
    if (id === undefined) {
      this.generation++
      for (const key of this.noteBends.keys()) this.noteGenerations.set(key, (this.noteGenerations.get(key) ?? 0) + 1)
      this.noteBends.clear()
    } else {
      this.noteGenerations.set(id, (this.noteGenerations.get(id) ?? 0) + 1)
      this.noteBends.delete(id)
    }
    const now = time
    for (const voice of this.voices) {
      if (id !== undefined && voice.id !== id) continue
      if (now < voice.startedAt) {
        voice.released = true
        voice.envelope.triggerRelease(now)
        voice.player.stop(now)
        continue
      }
      if (!voice.looping || voice.released) continue
      voice.released = true
      if (voice.loopPlan) {
        const { plan, reversed, lastTime, elapsedFrames, rate } = voice.loopPlan
        const original = this.buffer.get()
        if (!original) throw new Error('Sample audio is not loaded.')
        const framesPerSecond = original.sampleRate * rate
        const release = this.params.envelope.release
        const schedule = scheduleLoopRelease(plan, elapsedFrames + (now - lastTime) * framesPerSecond, release * framesPerSecond)
        voice.envelope.triggerRelease(now)
        if (!schedule) {
          voice.player.stop(now + release)
          continue
        }
        const switchTime = now + schedule.waitFrames / framesPerSecond
        const source = schedule.reverse ? reversed : original
        if (!source) throw new Error('Reverse sample audio is not available.')
        const offset = (schedule.reverse ? plan.endFrame - 1 - schedule.frame : schedule.frame) / original.sampleRate
        const duration = Math.min(schedule.tailFrames / original.sampleRate,
          Math.max(0, now + release - switchTime) * rate)
        if (duration <= 0) {
          voice.player.stop(switchTime)
          continue
        }
        const tail = new Tone.ToneBufferSource({ url: source, playbackRate: rate }).connect(voice.gain)
        const previous = voice.player
        this.retiredPlayers.add(previous)
        voice.retired ??= new Set()
        voice.retired.add(previous)
        previous.onended = () => { this.retiredPlayers.delete(previous); voice.retired?.delete(previous); previous.dispose() }
        voice.player = tail
        tail.onended = () => {
          if (!this.voices.delete(voice)) return
          tail.dispose()
          voice.gain.dispose()
          voice.envelope.dispose()
        }
        tail.start(switchTime, offset, duration)
        previous.stop(switchTime)
      } else {
        voice.envelope.triggerRelease(now)
        voice.player.stop(now + this.params.envelope.release)
      }
    }
  }

  choke(time = Tone.immediate()): void {
    this.generation++
    this.chokeGeneration++
    const now = time
    for (const voice of this.voices) {
      voice.player.stop(now)
      for (const player of voice.retired ?? []) player.stop(now)
    }
  }

  dispose(): void {
    this.disposed = true
    this.generation++
    for (const { player, gain, envelope } of this.voices) {
      player.dispose()
      gain.dispose()
      envelope.dispose()
    }
    this.voices.clear()
    for (const player of this.retiredPlayers) player.dispose()
    this.retiredPlayers.clear()
    this.buffer.dispose()
  }
}
