import type { Scale } from './grid'

export const scales: Record<Scale, number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
}

export function scaleNote(scale: Scale, degree: number): number {
  const notes = scales[scale]
  const octave = Math.floor(degree / notes.length)
  return octave * 12 + notes[((degree % notes.length) + notes.length) % notes.length]!
}
