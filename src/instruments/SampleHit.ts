// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import { SamplePlayer } from './SamplePlayer'
import type { InputNode } from 'tone'
import { defaultEnvelope } from './defaultEnvelope'
import type { SampleHitParams } from './types'

export class SampleHit extends SamplePlayer {
  readonly type = 'sample-hit' as const
  readonly params: SampleHitParams

  constructor(params: Partial<SampleHitParams>, output?: InputNode) {
    super(output)
    this.params = {
      sample: params.sample ?? '',
      sampleName: params.sampleName ?? '',
      start: params.start ?? 0,
      end: params.end ?? 1,
      cuts: params.cuts ?? [],
      playback: params.playback ?? 'order',
      loopMode: params.loopMode ?? 'once',
      reverse: params.reverse ?? false,
      polyphony: params.polyphony ?? 1,
      volume: params.volume ?? -12,
      pitch: params.pitch ?? 0,
      envelope: params.envelope ?? defaultEnvelope('sample-hit'),
    }
  }
}
