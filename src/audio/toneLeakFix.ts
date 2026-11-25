// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Tone from 'tone'

interface OscillatorNodeLike {
  frequency: Tone.Param<'frequency'>
  detune: Tone.Param<'cents'>
  dispose(): unknown
}

interface OscillatorInternals {
  _start(time: unknown): void
  _oscillator: OscillatorNodeLike | null
  frequency: Tone.Signal<'frequency'>
  detune: Tone.Signal<'cents'>
}

// Tone.Oscillator connects its long-lived frequency/detune signals to the params of a fresh
// native oscillator on every start, but never disconnects them when that oscillator is
// disposed. Every note therefore leaves a dead node and its params retained by the signal.
const prototype = Tone.Oscillator.prototype as unknown as OscillatorInternals
const start = prototype._start
prototype._start = function (this: OscillatorInternals, time: unknown) {
  start.call(this, time)
  const node = this._oscillator
  if (!node) return
  const dispose = node.dispose.bind(node)
  node.dispose = () => {
    try {
      this.frequency.disconnect(node.frequency)
      this.detune.disconnect(node.detune)
    } catch {
      // The owning oscillator was already disposed along with its signals.
    }
    return dispose()
  }
}
