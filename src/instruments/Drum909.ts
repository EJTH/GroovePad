import { DrumKit } from './DrumKit'
import type { Drum909Params } from './types'

export class Drum909 extends DrumKit<'909'> {
  constructor(params: Partial<Drum909Params>) {
    super(params, '909')
  }
}
