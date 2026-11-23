import type { ADSREnvelope, InstrumentType } from './types'

export function defaultEnvelope(type: InstrumentType): ADSREnvelope {
  if (type === '808' || type === '909') {
    return { attack: 0.001, decay: 0.25, sustain: 0, release: 0.05 }
  }
  const timing: Record<Exclude<InstrumentType, '808' | '909'>, { attack: number; decay: number }> = {
    'sample-hit': { attack: 0.01, decay: 0.1 },
    'sample-loop': { attack: 0.01, decay: 0.1 },
    '303': { attack: 0.005, decay: 0.3 },
  }
  return { ...timing[type], sustain: 1, release: 0.5 }
}
