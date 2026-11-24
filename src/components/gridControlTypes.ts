// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GridItemType } from '../grid'

export const controlTypes: { type: GridItemType; label: string; description: string; icon: string }[] = [
  { type: 'instrument-pad', label: 'Instrument Pad', description: 'Play a sound', icon: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M9 13l2 2 4-6' },
  { type: 'pad', label: 'Pad', description: 'Trigger a control', icon: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M12 8v8 M8 12h8' },
  { type: 'knob', label: 'Knob', description: 'Adjust a value', icon: 'M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9z M12 12l4-4' },
  { type: 'lfo', label: 'LFO', description: 'Modulate with a wave', icon: 'M2 12c2.5 0 2.5-7 5-7s2.5 14 5 14 2.5-14 5-14 2.5 7 5 7' },
  { type: 'mod-wheel', label: 'Mod Wheel', description: 'Control modulation', icon: 'M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M7 11h10 M7 14h10' },
  { type: 'piano-roll', label: 'Piano Roll', description: 'Play notes', icon: 'M3 5h18v14H3z M9 5v14 M15 5v14 M6 5v7 M12 5v7 M18 5v7' },
  { type: 'arpeggiator', label: 'Arpeggiator', description: 'Sequence held notes', icon: 'M4 19h3v-4H4z M10 19h3V9h-3z M16 19h3V4h-3z' },
  { type: 'sequenced-loop', label: 'Loop sequencer', description: 'Record and loop notes', icon: 'M4 8a8 8 0 0 1 14-2l2 2 M20 4v4h-4 M20 16a8 8 0 0 1-14 2l-2-2 M4 20v-4h4' },
  { type: 'output-selector', label: 'Output Selector', description: 'Route a signal', icon: 'M3 12h7 M10 12l5-6h6 M10 12l5 6h6 M18 3l3 3-3 3 M18 15l3 3-3 3' },
]
