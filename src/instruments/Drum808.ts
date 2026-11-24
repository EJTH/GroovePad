// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import { DrumKit } from './DrumKit'
import type { Drum808Params } from './types'

export class Drum808 extends DrumKit<'808'> {
  constructor(params: Partial<Drum808Params>) {
    super(params, '808')
  }
}
