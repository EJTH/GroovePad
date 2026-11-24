import { MAX_LOOP_CLIP_INDEX, type LoopAutomation, type LoopNote, type LoopRow, type SequencedLoopSettings } from './grid'

export function rowKey(row: LoopRow, bankId = '') {
  return row.kind === 'note' ? JSON.stringify(['note', row.bankId ?? bankId, row.instrumentId, row.note])
    : JSON.stringify(['automation', row.bankId ?? bankId, row.sourceId, row.parameter])
}

export function noteRow(note: LoopNote): LoopRow {
  return { kind: 'note', bankId: note.bankId, instrumentId: note.instrumentId, note: note.note }
}

export function automationRow(event: LoopAutomation): LoopRow {
  return { kind: 'automation', bankId: event.bankId, sourceId: event.sourceId, parameter: event.parameter }
}

export type RowClipboard = { row: LoopRow; notes: LoopNote[]; automation: LoopAutomation[]; muted: boolean }

export function copyRow(settings: SequencedLoopSettings, index: number, row: LoopRow, bankId = ''): RowClipboard {
  const key = rowKey(row, bankId)
  return { row: { ...row },
    notes: (settings.clips[index] ?? []).filter((note) => rowKey(noteRow(note), bankId) === key).map((note) => ({ ...note })),
    automation: (settings.automation[index] ?? []).filter((event) => rowKey(automationRow(event), bankId) === key).map((event) => ({ ...event })),
    muted: (settings.mutedRows?.[index] ?? []).some((entry) => rowKey(entry, bankId) === key) }
}

export function removeRow(settings: SequencedLoopSettings, index: number, row: LoopRow, bankId = '') {
  const key = rowKey(row, bankId)
  if (settings.clips[index]) settings.clips[index] = settings.clips[index].filter((note) => rowKey(noteRow(note), bankId) !== key)
  if (settings.automation[index]) settings.automation[index] = settings.automation[index].filter((event) => rowKey(automationRow(event), bankId) !== key)
  if (settings.mutedRows?.[index]) settings.mutedRows[index] = settings.mutedRows[index].filter((entry) => rowKey(entry, bankId) !== key)
}

export function pasteRow(settings: SequencedLoopSettings, index: number, copied: RowClipboard, bankId = '') {
  removeRow(settings, index, copied.row, bankId)
  ;(settings.clips[index] ??= []).push(...copied.notes.map((note) => ({ ...note })))
  ;(settings.automation[index] ??= []).push(...copied.automation.map((event) => ({ ...event })))
  if (copied.muted) ((settings.mutedRows ??= {})[index] ??= []).push({ ...copied.row })
}

export function nextUnusedClipIndex(settings: SequencedLoopSettings) {
  return Array.from({ length: MAX_LOOP_CLIP_INDEX + 1 }, (_, i) => i)
    .find((i) => !(String(i) in settings.clips) && !(String(i) in settings.automation) && !(String(i) in (settings.mutedRows ?? {})))
}

export function cloneClip(settings: SequencedLoopSettings, index: number) {
  const target = nextUnusedClipIndex(settings)
  if (target === undefined) return undefined
  settings.clips[target] = (settings.clips[index] ?? []).map((note) => ({ ...note }))
  settings.automation[target] = (settings.automation[index] ?? []).map((event) => ({ ...event }))
  if (settings.mutedRows?.[index]?.length) (settings.mutedRows ??= {})[target] = settings.mutedRows[index]!.map((row) => ({ ...row }))
  return target
}
