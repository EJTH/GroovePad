// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Scale } from './grid'

export const PIANO_ROOT_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
export type PianoRootNote = typeof PIANO_ROOT_NOTES[number]

export const scales: Record<Scale, number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  'major-pentatonic': [0, 2, 4, 7, 9],
  'minor-pentatonic': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
}

const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function noteName(note: number): string {
  return `${noteNames[note % 12]}${Math.floor(note / 12) - 1}`
}

export function scaleNote(scale: Scale, degree: number, root: PianoRootNote = 'C'): number {
  const notes = scales[scale]
  const octave = Math.floor(degree / notes.length)
  return PIANO_ROOT_NOTES.indexOf(root) + octave * 12 + notes[((degree % notes.length) + notes.length) % notes.length]!
}
