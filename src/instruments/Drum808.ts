import { DrumKit } from './DrumKit'
import type { Drum808Params } from './types'

export class Drum808 extends DrumKit<'808'> {
  constructor(params: Partial<Drum808Params>) {
    super(params, '808')
  }
}
