// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import { SamplePlayer } from './SamplePlayer'
import { defaultEnvelope } from './defaultEnvelope'
import type { SampleLoopParams } from './types'

export class SampleLoop extends SamplePlayer {
  readonly type = 'sample-loop' as const
  readonly params: SampleLoopParams

  constructor(params: Partial<SampleLoopParams>) {
    super()
    this.params = {
      sample: params.sample ?? '',
      sampleName: params.sampleName ?? '',
      cuts: params.cuts ?? [],
      playback: params.playback ?? 'order',
      volume: params.volume ?? -12,
      pitch: params.pitch ?? 0,
      loopStart: params.loopStart ?? 0,
      loopEnd: params.loopEnd ?? 1,
      envelope: params.envelope ?? defaultEnvelope('sample-loop'),
    }
  }
}
