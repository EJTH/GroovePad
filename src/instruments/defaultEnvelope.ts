import type { ADSREnvelope, InstrumentType } from './types'

export function defaultEnvelope(type: InstrumentType): ADSREnvelope {
  const timing: Record<InstrumentType, { attack: number; decay: number }> = {
    'sample-hit': { attack: 0.01, decay: 0.1 },
    'sample-loop': { attack: 0.01, decay: 0.1 },
    '303': { attack: 0.005, decay: 0.3 },
    '808': { attack: 0.001, decay: 0.5 },
  }
  return { ...timing[type], sustain: 1, release: 0.5 }
}
