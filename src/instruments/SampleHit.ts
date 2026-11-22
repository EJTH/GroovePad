import { SamplePlayer } from './SamplePlayer'
import type { SampleHitParams } from './types'

export class SampleHit extends SamplePlayer {
  readonly type = 'sample-hit' as const
  readonly params: SampleHitParams

  constructor(params: Partial<SampleHitParams>) {
    super()
    this.params = {
      sample: params.sample ?? '',
      sampleName: params.sampleName ?? '',
      start: params.start ?? 0,
      end: params.end ?? 1,
      cuts: params.cuts ?? [],
      playback: params.playback ?? 'order',
      loopMode: params.loopMode ?? 'once',
      reverse: params.reverse ?? false,
      volume: params.volume ?? -12,
      pitch: params.pitch ?? 0,
      envelope: params.envelope ?? { attack: 0.01, decay: 0.1, sustain: 0, release: 0.1 },
    }
  }
}
