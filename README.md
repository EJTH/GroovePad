# GroovePad.js

A mobile-first groovebox built with Vue 3, TypeScript, and Vite.

## Development

Run `npm run dev` to start the development server. Run `npm run build` to type-check and create a production build.

## Current functionality

The interface includes a transport display, beat indicator, bank selector, and editable grid. Each bank has its own layout, initially 4 by 4, with up to 8 columns and 10 rows. Enable edit mode with the header button, then tap a **+** cell to choose a control and save. Tap an existing control to edit or remove it. Drag a control to an empty cell to move or copy it, or onto another control to swap them when both fit. Copies do not include wires. Drag a corner to resize. Turn off edit mode to play. **Grid settings** changes the number of columns and rows; controls cannot overlap or extend outside the grid.

Numeric settings offer both a knob and an input for precise entry. Knobs for unbounded values adjust over an adaptive range; enter a larger or smaller value to change that range.

Use the edit button in the header to add controls, then the wire button to its left to drag from a source to a destination and select their compatible parameters. Knobs can be wired to LFO rate, waveform, depth or offset. Selectable settings divide the 0–127 input range evenly among their options, in menu order. LFO offset shifts the waveform, with output limited to -1 through 1. Banks, controls, and wires are saved in browser storage.

Wired knobs add their current value to the destination's configured value; their minimum can be negative. An auto-centering mod wheel adds or subtracts up to its depth as a fraction of the destination range, returning to zero adjustment at the center. Adjustments are clamped to the destination range and do not overwrite its saved base value.

Piano rolls have a configurable color and show note names. The arpeggiator runs while it receives held notes, for example from a wired piano roll, and displays the current note name. Tap it to toggle between arpeggiation and passing notes through unchanged. Its rate uses note divisions at the displayed tempo, and distance transposes successive passes through the held notes in semitones. Non-chromatic scales quantize transposed notes upward relative to each held note.

Use the menu to add a bank, edit its title, icon, color and grid dimensions, or remove it after confirmation. A long press on a bank also opens its settings. **Add bank from file** accepts a project ZIP and lets you choose a bank, or accepts an individual bank JSON file. Project settings changes the tempo. The browser automatically saves the current project locally.

Sample Hit and Sample Loop pads accept local audio files up to 2 MB, or record from a microphone with **Record** and **Stop**. Recording requires microphone permission and a secure browser context (HTTPS or localhost). Recordings are mono 16-bit WAV files and have no fixed time limit, but large recordings may exceed browser storage or the project export limit. **Reset** removes the sample and its markers.

The waveform editor lets you drag to pan, scroll or pinch to zoom, and drag the start, end and cut markers. Choose **Add cut** and tap the waveform to split the selected region; remove cuts with the corresponding buttons. With cuts present, choose random, sequential or a specific cut for each trigger. For Sample Hit, choose **Loop mode** under Playback to select Loop or Back and forth; reverse playback is also available. When looping, it plays the lead-in and repeats between the first and last cuts; one cut loops from start to that cut, and no cuts loop the whole region. Sample Loop repeats the selected cut. On release, looping continues as the envelope fades, then exits at a loop boundary to play the tail toward the region's end (or start when moving backward). If the tail cannot fit, it begins immediately and fades out at the end of release. Raise envelope sustain above zero to hear held loops; release can be set up to 10 seconds. Samples are embedded in the project; browser storage is limited and reports an error if its quota is exceeded.

Hold **Play** in an instrument's settings header to preview the current settings, and release it as you would a pad.

Use **Save project** to download a ZIP and **Load project** to choose one. Loading validates the complete project before replacing the current one. The version 1 archive contains `manifest.json`, one JSON configuration per bank under `banks/` (including embedded samples), and empty `samples/` and `loop_midi/` directories. The project limit is 20 MB uncompressed. Archives containing separate sample or MIDI files are not supported. Legacy sample URLs are cleared when loading; choose a local file instead.

Pressure is used when available, otherwise pad velocity is based on vertical touch position. Transport recording is not implemented yet.
