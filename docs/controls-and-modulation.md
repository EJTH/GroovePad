# Controls and modulation

## Control types

The grid control picker provides nine control families:

| Control | Purpose |
| --- | --- |
| Pad | Trigger a connected control |
| Instrument Pad | Play an instrument |
| Knob | Produce a numeric value |
| LFO | Produce a periodic modulation signal |
| Mod Wheel | Produce manual modulation |
| Piano Roll | Play pitched notes |
| Arpeggiator | Transform held notes into a sequence |
| Output Selector | Select among output destinations |
| Loop Sequencer | Record and play clips |

Each control exposes outputs and/or inputs appropriate to its role. The settings dialog previews the live control while parameters are edited.
The LFO waveform preview updates at most 12 times per second and pauses off-screen; modulation continues at its normal rate.
LFO waveforms are sine, saw and square. Older projects using random LFOs are converted to sine when loaded.
LFO hold is no longer available; previously recorded hold automation has no effect.

For a Pad, position-based velocity and pressure reach their maximum in the bottom 20% of the pad. When rotated, this region is on the left. Pressure-sensitive input uses the reported pressure instead.

Knob dragging uses at least 100 pixels for the full range, or one pixel per step when that requires more travel.

## Wiring controls

Choose **Wire**, then select a source and destination control. GroovePad filters the available parameters to compatible connections. A connection can use:

- **Absolute mapping**: map the source range into a target range.
- **Modulation**: apply a relative offset, with a configurable amount or range.

![Wiring controls](./images/wire-mode.png)

Connections are validated before they are saved. Existing wires can be edited or removed from control settings. Cycles and duplicate source/target mappings are rejected.

An unconfigured local knob-to-Tone-processor connection defaults to absolute mapping across the parameter's range. Choose **MOD** to apply an offset to its saved value instead. Supported processor parameters combine their numeric sources in a Tone signal graph, including LFOs routed through knobs and mod-wheel depth. When all LFO paths lead to supported processor parameters, with or without intermediate knobs, the knob displays are sampled directly from the audio graph rather than updating the grid each frame. Mixed routes still update the grid where needed.

Selectors, SubGrid boundaries, instruments, oscillator and noise settings, smoothed LFOs, and parameters without a Tone audio input continue to use control-rate updates. Reverb decay changes regenerate the impulse asynchronously and may take time to become audible.

## Automation

Knobs, mod wheels, LFOs, piano rolls, arpeggiators, instrument pads, and loop sequencers expose parameters that can be used by modulation and loop automation. When a loop records automation, the source and parameter are stored alongside note events and replayed with the selected clip.

## Note repeat

Activate **Note repeat** and choose 1/4, 1/8, 1/16, or 1/32. Pad and note controls then repeat input at the selected transport division while playback is running.

[← Previous: Banks and grid editing](./banks-and-grid.md) · [Next: Synth instruments →](./instruments-and-sound.md)

