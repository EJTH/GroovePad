# Grid and audio overhaul

## Goal

Let users build reusable controls from grids, add useful Tone.js elements, and
route audio without needing to understand an audio graph first. This is a draft:
the choices marked as recommendations should be confirmed before implementation.
The sections below retain the original goals; the status and remaining plan
describe what has actually been delivered.

## Current progress

- Nested SubGrids can be created, opened and edited. CFG exposes named note,
  numeric and audio ports and selects interactive surface controls. Audio can
  also pass through the enclosing SubGrid control.
- Bank settings can copy a bank as a SubGrid, and Add control can paste an
  independent snapshot. This clipboard is temporary and is cleared on reload
  or project replacement.
- Oscillator, noise, filter, gain, delay, reverb, envelope and mixer elements
  are available. Oscillators accept notes, have configurable polyphony, and
  expose a numeric frequency output. Always-on mode bypasses the oscillator
  envelope and retains released pitches, reusing released voices for new notes.
- Envelopes expose all ADSR settings and a numeric value output; the widget and
  settings both use the ADSR editor. CFG indicates whether it is active.
- Typed audio, note and numeric connections, selector routing, nested ports,
  automatic inserts and feedback validation are implemented. Instruments
  route through the bank audio graph.
- The envelope processor now uses a shared envelope signal to drive its audio
  gain. This is preparation for audio-rate modulation, **not** the completed
  modulation refactor: envelope values and LFO output still reach control
  routing through animation-frame updates.

The latest full test run passed 166 tests and the build passed. An isolated
offline browser check also verified the refactored envelope's audible gate.
These checks do not replace the end-to-end testing listed below.

## Adding elements

In edit mode, selecting an empty cell opens the existing **Add control** dialog.
Add two choices:

- **Sub Grid:** choose a preset from Built-in, My Collection or This Project,
  import from a saved project, or create an empty SubGrid. Selecting a preset
  places an instance in the chosen cell.
- **Tone.js:** choose an element from a categorized list, such as Sources,
  Effects and Utilities. Each has a short description and sensible defaults.

Users can also save any grid as a named SubGrid in project assets or their
local collection.

## SubGrids

A SubGrid contains a normal grid and can itself contain SubGrids. Selecting its
open action enters the editor:

`Bank > Parent grid > SubGrid [CFG] [X]`

The breadcrumb identifies the current location; **X** returns to the parent.
**CFG** toggles configuration mode. Selecting an internal element in that mode
offers:

- **Show on surface:** render the element on the enclosing SubGrid control.
- **Expose I/O:** select and name its inputs, outputs and wireable settings.

Exposed ports behave like normal ports in the parent grid. Their stable IDs and
types are separate from their displayed names. Surface elements are cropped to
their combined bounding box and scaled proportionally to fit; an empty surface
shows the SubGrid name. Surface controls must remain playable, so opening the
editor needs a distinct, accessible action.

**Recommendation:** placing a preset creates an independent instance; editing it
does not change other instances or the saved preset. Saving changes back to a
preset should be an explicit action. Prevent recursive preset references and
warn when a grid depends on external bank targets that cannot be preserved.

## Preset library

The same picker presents three clearly labelled collections:

- **Built-in:** presets authored by us and bundled with the app. They are
  read-only; users can copy one into their collection to customize it.
- **My Collection:** user-managed presets available across projects in the
  same browser and app installation. Users can rename, duplicate and delete
  them, and export or import a collection for backup and sharing.
- **This Project:** presets saved inside the current project. They travel with
  the project and can be copied to My Collection.

**Import from project** opens a saved project file without replacing the current
project. Show its saved SubGrid presets and offer to convert a bank grid into a
preset; let users choose which to copy into This Project or My Collection.
Likewise, a grid's **Save as preset** action chooses the destination.

Each copy includes its nested SubGrids and required samples, so placing it does
not depend on the original project, collection or built-in version. Updating or
deleting a preset never changes existing instances. Give presets stable IDs,
schema versions and optional descriptions; name collisions alone are not
identity conflicts. For an existing ID with different content, offer **Keep
both**, **Replace** or **Cancel**; never overwrite silently. Report unsupported
versions, missing dependencies and external bank references before import.

**Recommendation:** persist My Collection separately from the current project
in IndexedDB, which the app already uses for project storage. It is local to
that browser's storage, not a synced account, and may be cleared or limited by
the browser. Surface storage errors and offer explicit export/import for
backup; do not imply that changing devices or clearing browser data preserves it.

## Tone.js elements and notes

Start with oscillator, noise, filter, gain, delay, reverb, envelope and mixer
elements. Give each a focused settings UI and expose relevant parameters, such
as oscillator frequency and filter cutoff. Expand the catalogue over time.

Oscillators should accept **note input** as well as a numeric frequency control:
a piano roll or sequencer can then play them directly. Note input carries note
on/off, velocity and pitch bend; the element converts pitch to frequency. A raw
oscillator is not automatically a complete instrument, so note-off needs a
defined gate or envelope to avoid a continuous tone and clicks.

**Recommendation:** offer a beginner-friendly gated oscillator with a simple
envelope, and make it monophonic initially with a documented last-note priority.
When a note is active, it sets the base pitch; frequency modulation is applied on
top. Without an active note, the frequency setting is the base pitch. Explicit
continuous-oscillator behavior can be offered as a separate mode.

## Audio routing

Treat audio, notes/events and numeric control signals as distinct, typed wire
connections. Each bank and SubGrid has audio buses with pre-FX and post-FX
points. The default **Bank** route refers to the current enclosing grid,
including inside a SubGrid.

- Adding an effect defaults to an ordered insert chain: enclosing grid audio ->
  effects -> grid output -> parent/main output. Persist the effect order.
- Advanced settings choose **Audio from:** wires only, bank pre-FX, bank
  post-FX, main pre-FX or main post-FX; and **Audio to:** wires only, bank out
  or main out.
- Display the effective route. Specify whether a route is an insert or a
  parallel send; avoid accidental dry-signal doubling when wires are added.
- Reject routes that create feedback, including unsafe pre/post combinations.

## Remaining plan

### Decouple modulation from rendering

1. Move continuous LFO and envelope modulation for suitable audio parameters
   into the audio graph. The shared envelope signal is already available; LFO
   generation and audio-rate routing are still to be implemented. Widgets
   should observe modulation for display, not drive audio from animation frames.
2. Keep selectors and settings that are not audio parameters on a separate
   control-rate path. Explicitly handle the boundary between audio and control
   signals; do not imply that browser timers are reliable in background tabs.
3. Preserve existing mappings and behavior: source ranges, absolute and
   additive modulation, clamping, multiple inputs, selectors, nested SubGrid
   ports, LFO hold, waveforms, depth, offset and smoothing. A signal reaching
   an audio parameter must not also be applied through the old sampled path.
4. Test rendered audio as well as control values, including simultaneous
   sources, selectors, nested ports, hold/release, changes while playing and
   save/reload. Check background-tab behavior when the audio context remains
   running, and surface audio initialization or processing failures.

### Musical timing

Separately from modulation, review loop playback, note repeat, arpeggiator and
metronome scheduling. They currently use browser timers and can fire late
under load. A shared look-ahead scheduler should schedule musical events on
the audio clock, while live input remains responsive. Carry scheduled times
through routing and instrument interfaces, and test tempo changes, stop,
voice releases and delayed or background-tab callbacks.

### Other remaining overhaul work

- Build the preset library and its management/import/export UI described
  above. Preset data and storage helpers exist, but the library is not exposed
  in the UI and bank copy/paste is not persistent.
- Add the proposed categorized Tone.js picker. Automatic effect order follows
  layout-item order; there is no independent effect-order control.
- Extend Tone settings automation beyond the envelope ADSR settings where
  appropriate. The oscillator's numeric frequency output represents one
  priority-selected pitch, not a separate output per voice.
- Consider fuller SubGrid breadcrumbs and navigation polish; the current
  editor has a Back action.
- Perform hands-on end-to-end checks for nested routing, audio and selector
  ports, save/reload, existing projects, session recording, audio permission,
  oscillator voice reuse and stealing, and mobile/touch interaction. Preset
  collection persistence, backup, conflicts and sample dependencies also need
  validation when the library UI is implemented.