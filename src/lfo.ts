import type { LfoSettings } from './grid'

export function lfoWaveValue(waveform: LfoSettings['waveform'], position: number, randomValue: number): number {
  switch (waveform) {
    case 'sine': return Math.sin(position * 2 * Math.PI)
    case 'saw': return position * 2 - 1
    case 'square': return position < 0.5 ? 1 : -1
    case 'random': return randomValue
  }
}

export function lfoLevel(raw: number, settings: Pick<LfoSettings, 'depth' | 'offset'>): number {
  return Math.max(-1, Math.min(1, raw * settings.depth + settings.offset))
}
