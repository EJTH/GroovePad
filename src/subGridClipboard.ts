// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import { copyControl, type GridLayout } from './grid'
import { validateAudioRoutes } from './audio/audioRoutes'
import type { Bank } from './project'

export interface SubGridClipboard {
  title: string
  sourceBankId: string
  layout: GridLayout
  adjustedAudioRoutes: boolean
  externalReferences: boolean
}

function cloneLayout(layout: GridLayout, sourceRoot: string, destinationRoot: string, sourceScope = sourceRoot, destinationScope = destinationRoot): GridLayout {
  const items = layout.items.map((item) => {
    const copy = copyControl(item, item.id)
    if (item.type === 'sub-grid' && copy.type === 'sub-grid') {
      copy.settings.layout = cloneLayout(item.settings.layout, sourceRoot, destinationRoot,
        `${sourceScope}/${item.id}`, `${destinationScope}/${item.id}`)
      copy.settings.surfaceItemIds = [...item.settings.surfaceItemIds]
      copy.settings.exposedPorts = item.settings.exposedPorts.map((port) => ({ ...port }))
    }
    if (copy.type === 'sequenced-loop') {
      const remap = (entry: { bankId?: string }) => {
        const bank = entry.bankId
        if (!bank) return
        if (bank === sourceScope) delete entry.bankId
        else if (bank === sourceRoot || bank.startsWith(`${sourceRoot}/`)) {
          entry.bankId = destinationRoot + bank.slice(sourceRoot.length)
          if (entry.bankId === destinationScope) delete entry.bankId
        }
      }
      for (const notes of Object.values(copy.settings.clips)) notes.forEach(remap)
      for (const events of Object.values(copy.settings.automation)) events.forEach(remap)
      for (const rows of Object.values(copy.settings.mutedRows ?? {})) rows.forEach(remap)
      copy.settings.armed = false
    }
    return copy
  })
  return { columns: layout.columns, rows: layout.rows, items, connections: layout.connections.map((wire) => ({ ...wire })) }
}

export function copyBankAsSubGrid(bank: Bank): SubGridClipboard {
  const layout = cloneLayout(bank.layout, bank.id, bank.id)
  let adjustedAudioRoutes = false
  let externalReferences = false
  function prepare(grid: GridLayout) {
    for (const item of grid.items) {
      if (item.type === 'sub-grid') prepare(item.settings.layout)
      if (item.type === 'tone-element') {
        if (item.settings.audioFrom === 'main-pre-fx') { item.settings.audioFrom = 'bank-pre-fx'; adjustedAudioRoutes = true }
        if (item.settings.audioFrom === 'main-post-fx') { item.settings.audioFrom = 'bank-post-fx'; adjustedAudioRoutes = true }
        if (item.settings.audioTo === 'main-out') { item.settings.audioTo = 'bank-out'; adjustedAudioRoutes = true }
      }
      if (item.type === 'sequenced-loop') {
        const references = [...Object.values(item.settings.clips).flat(), ...Object.values(item.settings.automation).flat(),
          ...Object.values(item.settings.mutedRows ?? {}).flat()]
        if (references.some((entry) => entry.bankId && entry.bankId !== bank.id && !entry.bankId.startsWith(`${bank.id}/`))) {
          externalReferences = true
        }
      }
    }
  }
  prepare(layout)
  validateAudioRoutes(layout)
  return { title: bank.title, sourceBankId: bank.id, layout, adjustedAudioRoutes, externalReferences }
}

export function pasteSubGridLayout(clipboard: SubGridClipboard, destinationId: string): GridLayout {
  return cloneLayout(clipboard.layout, clipboard.sourceBankId, destinationId)
}
