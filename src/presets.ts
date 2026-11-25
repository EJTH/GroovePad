// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import { copyGridLayout, type GridLayout } from './grid'

export interface SubGridPreset {
  id: string
  name: string
  description?: string
  schemaVersion: 1
  layout: GridLayout
  assets: { name: string; source: string }[]
}

export interface PresetCollection {
  schemaVersion: 1
  presets: SubGridPreset[]
}

export type PresetConflictAction = 'keep-both' | 'replace' | 'cancel'

export function createSubGridPreset(name: string, layout: GridLayout, assets: SubGridPreset['assets'] = []): SubGridPreset {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `preset-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: name.trim() || 'SubGrid',
    schemaVersion: 1,
    layout: copyGridLayout(layout),
    assets: assets.map((asset) => ({ ...asset })),
  }
}

export function cloneSubGridPreset(preset: SubGridPreset): SubGridPreset {
  return {
    ...preset,
    layout: copyGridLayout(preset.layout),
    assets: preset.assets.map((asset) => ({ ...asset })),
  }
}

export function mergePresets(
  existing: SubGridPreset[],
  incoming: SubGridPreset[],
  resolve: (existing: SubGridPreset, incoming: SubGridPreset) => PresetConflictAction,
): SubGridPreset[] {
  const merged = existing.map(cloneSubGridPreset)
  for (const preset of incoming) {
    const collision = merged.find((entry) => entry.id === preset.id)
    if (!collision) {
      merged.push(cloneSubGridPreset(preset))
      continue
    }
    const action = JSON.stringify(collision.layout) === JSON.stringify(preset.layout) &&
      JSON.stringify(collision.assets) === JSON.stringify(preset.assets)
      ? 'keep-both'
      : resolve(collision, preset)
    if (action === 'keep-both') {
      merged.push(cloneSubGridPreset({ ...preset, id: `${preset.id}-copy` }))
    } else if (action === 'replace') {
      merged.splice(merged.indexOf(collision), 1, cloneSubGridPreset(preset))
    }
  }
  return merged
}

export function exportPresetCollection(presets: SubGridPreset[]): string {
  return JSON.stringify({ schemaVersion: 1, presets } satisfies PresetCollection, null, 2)
}

export function importPresetCollection(value: string | unknown): SubGridPreset[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  if (!parsed || typeof parsed !== 'object' || !('schemaVersion' in parsed) ||
    parsed.schemaVersion !== 1 || !('presets' in parsed) || !Array.isArray(parsed.presets)) {
    throw new Error('Unsupported preset collection version.')
  }
  return parsed.presets.map((preset: unknown) => {
    if (!preset || typeof preset !== 'object' || !('id' in preset) || typeof preset.id !== 'string' ||
      !('name' in preset) || typeof preset.name !== 'string' ||
      !('schemaVersion' in preset) || preset.schemaVersion !== 1 ||
      !('layout' in preset) || typeof preset.layout !== 'object' ||
      !preset.layout || !('assets' in preset) || !Array.isArray(preset.assets)) {
      throw new Error('A preset in the collection is invalid or unsupported.')
    }
    return preset as unknown as SubGridPreset
  })
}
