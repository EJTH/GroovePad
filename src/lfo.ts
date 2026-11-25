// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LfoSettings } from './grid'

export function lfoWaveValue(waveform: LfoSettings['waveform'], position: number): number {
  switch (waveform) {
    case 'sine': return Math.sin(position * 2 * Math.PI)
    case 'saw': return position * 2 - 1
    case 'square': return position < 0.5 ? 1 : -1
  }
}

export function lfoLevel(raw: number, settings: Pick<LfoSettings, 'depth' | 'offset'>): number {
  return Math.max(-1, Math.min(1, raw * settings.depth + settings.offset))
}

export function migrateLegacyLfos(layout: unknown): void {
  if (!layout || typeof layout !== 'object' || !('items' in layout) || !Array.isArray(layout.items)) return
  for (const item of layout.items) {
    if (!item || typeof item !== 'object' || !('type' in item) || !('settings' in item) ||
      !item.settings || typeof item.settings !== 'object') continue
    const settings = item.settings
    if (item.type === 'lfo' && 'waveform' in settings && settings.waveform === 'random') settings.waveform = 'sine'
    if (item.type === 'sub-grid' && 'layout' in settings) migrateLegacyLfos(settings.layout)
    if (item.type !== 'sequenced-loop' || !('automation' in settings) ||
      !settings.automation || typeof settings.automation !== 'object') continue
    for (const events of Object.values(settings.automation)) {
      if (!Array.isArray(events)) continue
      for (const event of events) {
        if (event && typeof event === 'object' && event.parameter === 'setting:lfo:waveform' &&
          typeof event.value === 'number' && Math.round(event.value) === 3) event.value = 0
      }
    }
  }
}
