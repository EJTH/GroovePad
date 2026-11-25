// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ExposedPort, GridItem, GridLayout } from '../grid'
import { inputs, outputs } from '../parameters'

type AudioItem = Extract<GridItem, { type: 'tone-element' | 'sub-grid' | 'instrument-pad' }>
export interface AudioEdge { from: string; to: string }
export class AudioRouteError extends Error {}

export function audioInput(id: string, parameter = 'audio') {
  return parameter === 'audio' ? `item:${id}:in` : JSON.stringify(['port', id, parameter, 'in'])
}
export function audioOutput(id: string, parameter = 'audio') {
  return parameter === 'audio' ? `item:${id}:out` : JSON.stringify(['port', id, parameter, 'out'])
}
export function audioBoundaryKey(port: ExposedPort) {
  return JSON.stringify(['boundary', port.id])
}
export function isAudioSource(item: AudioItem) {
  return item.type === 'instrument-pad' || (item.type === 'tone-element' &&
    (item.settings.elementType === 'oscillator' || item.settings.elementType === 'noise'))
}

export function mixerAudioInputs(layout: GridLayout, id: string, boundary: ExposedPort[] = []): string[] {
  const inputs = planAudioRoutes(layout, boundary)
    .filter((edge) => edge.to === audioInput(id))
    .map((edge) => edge.from)
  for (const port of boundary) {
    if (port.kind === 'audio' && port.direction === 'input' && port.itemId === id && port.parameterId === 'audio') {
      inputs.push(audioBoundaryKey(port))
    }
  }
  return [...new Set(inputs)]
}

export function planAudioRoutes(layout: GridLayout, boundary: ExposedPort[] = []): AudioEdge[] {
  const items = layout.items.filter((item): item is AudioItem => item.type === 'tone-element' || item.type === 'sub-grid' || item.type === 'instrument-pad')
  const wires = layout.connections.filter((wire) => {
    const source = layout.items.find((item) => item.id === wire.sourceId)
    const target = layout.items.find((item) => item.id === wire.targetId)
    return source && target && outputs(source).some((port) => port.id === wire.sourceParameter && port.kind === 'audio') &&
      inputs(target).some((port) => port.id === wire.targetParameter && port.kind === 'audio')
  })
  const edges: AudioEdge[] = [
    { from: 'bank-post', to: 'main-pre' },
    { from: 'main-pre', to: 'main-post' },
  ]
  const hasInput = (id: string) => wires.some((wire) => wire.targetId === id && wire.targetParameter === 'audio') ||
    boundary.some((port) => port.direction === 'input' && port.itemId === id && port.parameterId === 'audio')
  const hasOutput = (id: string) => wires.some((wire) => wire.sourceId === id && wire.sourceParameter === 'audio') ||
    boundary.some((port) => port.direction === 'output' && port.itemId === id && port.parameterId === 'audio')
  const inserts = items.filter((item) => !isAudioSource(item) && !hasInput(item.id) && !hasOutput(item.id) &&
    (item.type === 'sub-grid' || (item.type === 'tone-element' && (item.settings.audioFrom === 'auto' || item.settings.audioFrom === 'bank-pre-fx') &&
      (item.settings.audioTo === 'auto' || item.settings.audioTo === 'bank-out') && item.settings.routeMode === 'insert')))
  let previous = 'bank-pre'
  for (const item of inserts) {
    edges.push({ from: previous, to: audioInput(item.id) })
    previous = audioOutput(item.id)
  }
  edges.push({ from: previous, to: 'bank-post' })

  for (const item of items) {
    const input = audioInput(item.id)
    const output = audioOutput(item.id)
    if (!isAudioSource(item)) edges.push({ from: input, to: output })
    if (inserts.includes(item)) continue
    const from = item.type === 'tone-element' ? item.settings.audioFrom : 'auto'
    const to = item.type === 'tone-element' ? item.settings.audioTo : 'auto'
    if (!isAudioSource(item)) {
      if (from === 'auto' && !hasInput(item.id)) edges.push({ from: 'bank-pre', to: input })
      else if (from !== 'auto' && from !== 'wires') {
        edges.push({ from: ({ 'bank-pre-fx': 'bank-pre', 'bank-post-fx': 'bank-post',
          'main-pre-fx': 'main-pre', 'main-post-fx': 'main-post' })[from], to: input })
      }
    }
    if (to === 'auto' && !hasOutput(item.id)) {
      edges.push({ from: output, to: isAudioSource(item) ? 'bank-pre' : 'bank-post' })
    } else if (to === 'bank-out') edges.push({ from: output, to: isAudioSource(item) ? 'bank-pre' : 'bank-post' })
    else if (to === 'main-out') edges.push({ from: output, to: 'main-post' })
  }
  for (const wire of wires) edges.push({ from: audioOutput(wire.sourceId, wire.sourceParameter), to: audioInput(wire.targetId, wire.targetParameter) })

  const unique = [...new Map(edges.map((edge) => [JSON.stringify([edge.from, edge.to]), edge])).values()]
  const visiting = new Set<string>()
  const visited = new Set<string>()
  function visit(node: string): void {
    if (visiting.has(node)) throw new AudioRouteError('Audio route would create feedback.')
    if (visited.has(node)) return
    visiting.add(node)
    for (const edge of unique) if (edge.from === node) visit(edge.to)
    visiting.delete(node)
    visited.add(node)
  }
  for (const edge of unique) visit(edge.from)
  return unique
}

export function validateAudioRoutes(
  root: GridLayout,
  replacement?: { layout: GridLayout; connections?: GridLayout['connections']; items?: GridItem[] },
): void {
  const edges: AudioEdge[] = []
  const current = (layout: GridLayout) => replacement?.layout === layout
    ? { ...layout, items: replacement.items ?? layout.items, connections: replacement.connections ?? layout.connections }
    : layout
  const key = (scope: string[], node: string) => JSON.stringify([...scope, node])
  function visit(layout: GridLayout, scope: string[], boundary: ExposedPort[]) {
    const grid = current(layout)
    const local = planAudioRoutes(grid, boundary)
    const subgrids = grid.items.filter((item): item is Extract<GridItem, { type: 'sub-grid' }> => item.type === 'sub-grid')
    for (const edge of local) {
      if (scope.length && (edge.from === 'main-pre' || edge.from === 'main-post' || edge.to === 'main-pre' || edge.to === 'main-post')) continue
      if (subgrids.some((item) => edge.from === audioInput(item.id) && edge.to === audioOutput(item.id))) continue
      edges.push({ from: key(scope, edge.from), to: key(scope, edge.to) })
    }
    for (const item of subgrids) {
      const childScope = [...scope, item.id]
      const connected = item.settings.exposedPorts.filter((port) => port.kind === 'audio' &&
        (grid.connections.some((wire) => port.direction === 'input'
          ? wire.targetId === item.id && wire.targetParameter === port.id
          : wire.sourceId === item.id && wire.sourceParameter === port.id) ||
        boundary.some((parent) => parent.itemId === item.id && parent.parameterId === port.id && parent.direction === port.direction)))
      edges.push({ from: key(scope, audioInput(item.id)), to: key(childScope, 'bank-pre') })
      edges.push({ from: key(childScope, 'bank-post'), to: key(scope, audioOutput(item.id)) })
      for (const port of connected) {
        if (!port.itemId || !port.parameterId) continue
        if (port.direction === 'input') {
          edges.push({ from: key(scope, audioInput(item.id, port.id)), to: key(childScope, audioInput(port.itemId, port.parameterId)) })
        } else {
          edges.push({ from: key(childScope, audioOutput(port.itemId, port.parameterId)), to: key(scope, audioOutput(item.id, port.id)) })
        }
      }
      visit(item.settings.layout, childScope, connected)
    }
  }
  visit(root, [], [])
  const visiting = new Set<string>()
  const visited = new Set<string>()
  function visitNode(node: string): void {
    if (visiting.has(node)) throw new AudioRouteError('Audio route would create feedback.')
    if (visited.has(node)) return
    visiting.add(node)
    for (const edge of edges) if (edge.from === node) visitNode(edge.to)
    visiting.delete(node)
    visited.add(node)
  }
  for (const edge of edges) visitNode(edge.from)
}
