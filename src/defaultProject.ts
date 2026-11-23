import { createControl, type GridLayout } from './grid'
import type { DrumKitType, DrumType } from './instruments/types'
import type { Bank } from './project'

export function createDefaultProject(): Bank[] {
  const beatLayout: GridLayout = { columns: 4, rows: 4, items: [], connections: [] }
  const drums: Array<{ label: string; drum: DrumType; kit: DrumKitType; x: number; y: number }> = [
    { label: 'Kick', drum: 'kick', kit: '808', x: 0, y: 0 },
    { label: 'Snare', drum: 'snare', kit: '808', x: 1, y: 0 },
    { label: 'Hi-Hat', drum: 'closed-hat', kit: '808', x: 2, y: 0 },
    { label: 'Open Hat', drum: 'open-hat', kit: '808', x: 2, y: 1 },
    { label: 'Tom', drum: 'tom', kit: '808', x: 0, y: 1 },
    { label: 'Rim', drum: 'rim', kit: '808', x: 1, y: 1 },
    { label: '909 Kick', drum: 'kick', kit: '909', x: 0, y: 2 },
    { label: '909 Snare', drum: 'snare', kit: '909', x: 1, y: 2 },
    { label: '909 Hi-Hat', drum: 'closed-hat', kit: '909', x: 2, y: 2 },
    { label: '909 Open Hat', drum: 'open-hat', kit: '909', x: 2, y: 3 },
    { label: '909 Tom', drum: 'tom', kit: '909', x: 0, y: 3 },
    { label: '909 Rim', drum: 'rim', kit: '909', x: 1, y: 3 },
  ]

  for (const drum of drums) {
    const pad = createControl(`drum-${drum.kit}-${drum.drum}`, drum.x, drum.y, 'instrument-pad', drum.kit)
    pad.label = drum.label
    if (pad.type === 'instrument-pad') {
      pad.settings.color = '#40a050'
      pad.settings.instrumentParams.drum = drum.drum
    }
    beatLayout.items.push(pad)
  }

  const beatLoop = createControl('control-1', 3, 0, 'sequenced-loop')
  beatLoop.label = 'Sequenced Loop'
  if (beatLoop.type === 'sequenced-loop') {
    beatLoop.settings.barLength = 4
    beatLoop.settings.clips = { 0: [], 1: [] }
    beatLoop.settings.automation = { 0: [], 1: [] }
  }
  beatLayout.items.push(beatLoop)

  const basslineLayout: GridLayout = { columns: 4, rows: 4, items: [], connections: [] }
  const bass303 = createControl('bass-303', 3, 0, 'instrument-pad', '303')
  bass303.label = '303 Synth'
  if (bass303.type === 'instrument-pad') {
    Object.assign(bass303.settings.instrumentParams, {
      transpose: -35,
      resonance: 6,
      envelope: { attack: 0.085, decay: 0.3, sustain: 1, release: 0.5 },
      filterFrequency: 200,
      filterEnvelope: { attack: 0.075, decay: 0.081, sustain: 0.65, release: 0.31 },
      filterAmount: 0.6,
      slideTime: 0.2,
    })
    bass303.settings.color = '#64dd6c'
  }
  basslineLayout.items.push(bass303)

  const resonanceKnob = createControl('resonance-knob', 0, 1, 'knob')
  resonanceKnob.label = 'Resonance'
  if (resonanceKnob.type === 'knob') {
    resonanceKnob.settings.min = 0.1
    resonanceKnob.settings.max = 30
    resonanceKnob.settings.defaultValue = 6
    resonanceKnob.settings.value = 11.8
    resonanceKnob.settings.step = 0.1
    resonanceKnob.settings.unit = 'Q'
  }
  basslineLayout.items.push(resonanceKnob)

  const basslineLoop = createControl('bassline-loop', 1, 1, 'sequenced-loop')
  basslineLoop.label = 'Loop Recorder (tap arms, swipe next)'
  basslineLoop.width = 3
  if (basslineLoop.type === 'sequenced-loop') basslineLoop.settings.barLength = 4
  basslineLayout.items.push(basslineLoop)

  const pianoRoll = createControl('bassline-piano-roll', 0, 2, 'piano-roll')
  pianoRoll.label = 'Bassline Keys'
  pianoRoll.width = 4
  pianoRoll.height = 2
  if (pianoRoll.type === 'piano-roll') {
    pianoRoll.settings.color = '#000000'
    pianoRoll.settings.numRows = 2
    pianoRoll.settings.style = 'pads'
    pianoRoll.settings.orientation = 'horizontal'
  }
  basslineLayout.items.push(pianoRoll)

  const filterKnob = createControl('control-1', 0, 0, 'knob')
  filterKnob.label = 'Filter Freq'
  if (filterKnob.type === 'knob') {
    filterKnob.settings.max = 5000
    filterKnob.settings.defaultValue = 64
    filterKnob.settings.value = 500
    filterKnob.settings.step = 1
  }
  basslineLayout.items.push(filterKnob)

  const filterLfo = createControl('control-2', 1, 0, 'lfo')
  filterLfo.label = 'LFO'
  if (filterLfo.type === 'lfo') {
    filterLfo.settings.rate = 0.21
    filterLfo.settings.depth = 0.19
  }
  basslineLayout.items.push(filterLfo)

  const arpeggiator = createControl('control-3', 2, 0, 'arpeggiator')
  if (arpeggiator.type === 'arpeggiator') {
    arpeggiator.settings.style = 'random'
    arpeggiator.settings.rate = '1/16'
    arpeggiator.settings.steps = 2
  }
  basslineLayout.items.push(arpeggiator)

  basslineLayout.connections.push(
    {
      id: 'connection-bassline-keys',
      sourceId: 'resonance-knob',
      sourceParameter: 'value',
      targetId: 'bass-303',
      targetParameter: 'resonance',
      mappingMode: 'abs',
      absoluteMin: 0.1,
      absoluteMax: 30,
    },
    {
      id: 'wire-1',
      sourceId: 'control-1',
      sourceParameter: 'value',
      targetId: 'bass-303',
      targetParameter: 'filterFrequency',
      mappingMode: 'abs',
      absoluteMin: 50,
      absoluteMax: 5000,
    },
    {
      id: 'wire-2',
      sourceId: 'control-2',
      sourceParameter: 'value',
      targetId: 'control-1',
      targetParameter: 'value',
      mappingMode: 'mod',
      modulationMin: -50,
      modulationMax: 50,
    },
    {
      id: 'wire-3',
      sourceId: 'bassline-piano-roll',
      sourceParameter: 'note',
      targetId: 'control-3',
      targetParameter: 'note',
    },
    {
      id: 'wire-4',
      sourceId: 'control-3',
      sourceParameter: 'note',
      targetId: 'bass-303',
      targetParameter: 'note',
    },
  )

  return [
    { id: 'A', title: 'Beat', icon: '♫', color: '#ff6b9d', layout: beatLayout },
    { id: 'B', title: 'Bassline', icon: '≋', color: '#83c9bb', layout: basslineLayout },
  ]
}
