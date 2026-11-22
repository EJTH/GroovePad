# GroovePad.js
## Product Design & Technical Specification

**Project:** GroovePad.js  
**Product type:** Mobile-first Groovebox / Music Production PWA  
**Framework:** Vue.js  
**Primary target:** Smartphones (portrait orientation)  
**Design inspiration:** Ableton Live — minimal, functional, performance-oriented.
**Sound Engine Library:** Tone.js
---

# 1. Project Overview

Build **GroovePad.js**, a lightweight, modular, highly customizable browser-based Groovebox designed primarily for smartphones.

The application should provide a tactile, performance-oriented interface for controlling virtual instruments, samples, effects, and modulation sources through a customizable grid.

The core concept is a configurable grid of interactive musical controls. Users should be able to create multiple banks, customize their layouts, save projects, and build their own instrument and controller configurations.

The application must be a fully functional **Progressive Web App (PWA)**, installable on mobile devices and designed to work reliably without requiring a permanent internet connection.

The initial development phase should focus on:

1. Establishing the application architecture.
2. Creating the core application layout.
3. Building a reusable component library.
4. Implementing the customizable grid system.
5. Implementing the first set of interactive UI components.
6. Establishing project and bank persistence.

Prioritize a functional, extensible UI foundation over implementing a complete audio engine immediately.

# 2. Technology & Architecture

## Required technology

- Vue.js 3.
- Composition API.
- TypeScript.
- Vite.
- CSS with a reusable design-token system.
- PWA support using a suitable Vite PWA integration.
- Web Audio API for future audio functionality. (Tone.js)

Use a modular, component-based architecture.

## Engineering principles

- Keep the code DRY.
- Build reusable components instead of duplicating UI logic.
- Separate UI components, application state, audio functionality, and persistence.
- Use centralized state management where appropriate (Pinia is recommended).
- Define clear TypeScript interfaces for all major application entities.
- Avoid tightly coupling individual controls to specific instruments.
- Make components independently testable.
- Design the architecture to accommodate future instruments, effects, and controller types.

The component system should make it straightforward to add new grid elements without having to modify the underlying grid architecture.

# 3. Application Layout

## General layout

The application should be designed primarily for portrait orientation.

The interface consists of three main areas:

1. Global transport and status header.
2. Bank selector.
3. Customizable control grid.

## 3.1 Transport and status header

Create a compact header containing:

- Record button.
- Play/Pause button.
- Rhythm indicator.
- LCD-style information display.
- Hamburger menu.

The LCD display should show:

- Current BPM (default: 120 BPM).
- Current bank title.

The rhythm indicator should provide a visual indication of the current musical beat or transport position.

The header should remain consistent when switching between banks.

## 3.2 Bank selector

Display a series of buttons representing the available banks.

Each bank should have:

- Customizable icon.
- Customizable color.
- Customizable title.
- Its own independent grid configuration.

Users should be able to customize a bank by long-pressing its selector button.

Bank customization should also be accessible when creating a new bank.

Switching banks should immediately display that bank's saved grid configuration.

## 3.3 Hamburger menu

The hamburger menu should provide the following functionality:

### Project management

- Load project.
- Save project.

Loading and saving should use the device's native file picker where supported.

Projects should be stored in a portable, documented file format, preferably a ZIP file with JSON data and samples and MIDI files for track sequences..


### Bank management

- Add empty bank.
- Add bank from file.
- Remove current bank.
- Bank settings.

Removing a bank must require confirmation through a dialog.

### Bank settings

Allow users to configure:

- Bank title.
- Bank icon.
- Bank color.
- Grid width.
- Grid height.

Grid dimensions should be configurable independently.

### Edit mode

Include an Edit Mode toggle.

When Edit Mode is enabled:

- Grid elements can be moved.
- Grid elements can be resized.
- Grid elements can be configured.
- Empty grid positions can receive new elements.
- Elements can be added, removed, or rearranged.

When Edit Mode is disabled:

- The grid behaves as a musical performance interface.
- Controls respond to user interaction.
- Editing gestures should not accidentally modify the layout.

# 4. Customizable Grid System

The grid is the central feature of GroovePad.js.

## 4.1 Grid configuration

The default grid size should be 4 columns × 4 rows.

When creating a new bank, users must be able to select their desired grid dimensions.

The grid system must support arbitrary dimensions rather than being restricted to 4×4.

Grid layouts should be saved independently for each bank.

## 4.2 Element sizing

Grid elements must support arbitrary rectangular dimensions.

Examples:

- 1×1
- 1×2
- 2×1
- 2×2
- 2×3
- 3×2

Elements should snap to the grid.

The layout engine must prevent unintended overlapping elements and elements extending outside the grid boundaries.

When an element is moved or resized, validate its new position before committing the change.

## 4.3 Grid editing interactions

In Edit Mode:

- Dragging an element moves it.
- Resizing handles allow changing its dimensions.
- Tapping an element opens its settings.
- Long-pressing an element may expose additional editing options.

Use touch-friendly drag-and-drop interactions.

Avoid relying exclusively on HTML5 drag-and-drop, as it is not suitable for many mobile touch interactions.

Use Pointer Events with appropriate multitouch handling.

# 5. Grid Component Library

Build each control as a reusable Vue component with a standardized configuration interface.

All components should support:

- Custom dimensions.
- Consistent visual styling.
- Touch interaction.
- Multitouch where applicable.
- Parameter binding.
- Component-specific settings.
- Independent state.
- Future MIDI and audio integration.

The initial component library should contain the following elements.

## 5.1 MPC Pad

The MPC Pad is a primary performance component.

### Visual behavior

- Large, touch-friendly pad surface.
- Configurable label.
- Visual feedback when pressed.
- Adjustable visual appearance.
- Clear active/inactive states.

### Velocity sensitivity

The pad should support velocity-sensitive interaction.

Use the following priority:

1. Use actual touch pressure when the device and browser expose reliable pressure data.
2. Otherwise, calculate velocity from the vertical position of the pointer within the pad.

Velocity mapping:

- Top of pad = minimum velocity.
- Bottom of pad = maximum velocity.

Normalize the velocity to a standard range of 0–127.

### Pad types

Provide the following instrument/action types:

- Sample Hit.
- Sample Loop.
- 303.
- 909.
- Punch In FX.

### Settings

Each pad should expose settings appropriate to its selected type.

Common parameters:

- Label.
- Type.
- Volume.
- Filter frequency.
- Filter resonance (Q).
- Pitch (semitones).
- Fine pitch (cents).
- Attack.
- Decay.
- Release.
- Choke group.
- Send channels.

Type-specific parameters:

**Sample Hit**
- Sample selection.
- Playback settings.

**Sample Loop**
- Sample selection.
- Loop playback settings.
- Toggle playback behavior.

**303**
- Instrument-specific settings.
- Filter and envelope controls.

**909**
- Instrument-specific settings.

**Punch In FX**
- Effect selection.
- Effect-specific parameters.

### Sample Loop behavior

Sample Loop pads must behave as toggle controls:

- First press starts playback.
- Second press stops playback.

Sample Hit pads should trigger playback on press and release according to the instrument's playback configuration.

Choke groups should allow mutually exclusive sounds to stop one another when triggered.

### Send channels

Provide assignable send-channel parameters, designed to support future effects routing.

---

## 5.2 Knob Control

A reusable rotary control.

### Visual behavior

- Circular knob.
- Clear value indication.
- Configurable color.
- Configurable label.
- Touch-based rotary interaction.

### Settings

- Label.
- Color.
- Minimum value.
- Maximum value.
- Default value.

The component should expose its current value through a standardized parameter interface.

---

## 5.3 LFO

A low-frequency oscillator component.

### Visual behavior

Display the current waveform and provide a clear indication of modulation activity.

### Settings

**Waveform**
- Sine.
- Saw.
- Square.
- Random.

**Rate mode**
- Free-running frequency in Hz.
- Tempo-synchronized timing.

**Additional parameters**
- Rate.
- Depth.
- Smoothness.

The LFO should be designed as a modulation source that can be connected to compatible parameters.

---

## 5.4 Mod Wheel

A vertical modulation control.

### Settings

- Depth.
- Auto-center.

### Behavior

- Touch-drag interaction.
- Visual indication of current position.
- Optional automatic return to center when released.

The control should expose a normalized output value.

---

## 5.5 Piano Roll

A compact, touch-oriented piano keyboard component.

### Settings

- Width.
- Number of octaves.
- Transpose.
- Scale.
- Horizontal or vertical orientation.

### Behavior

- Support multiple simultaneously pressed notes.
- Highlight active keys.
- Respect selected scale and transpose settings.

### Wire Output

The piano roll must support a connection to an MPC Pad.

When connected, pressing a piano key should trigger the assigned pad with a modified pitch value.

The connection should be configurable and saved as part of the project.

---

## 5.6 Arpeggiator

A configurable arpeggiator component.

### Settings

- Style.
- Rate.
- Distance.
- Steps.
- Gate.
- Scale.

The arpeggiator should be designed as a note-generation and modulation component.

Its output should eventually be connectable to compatible instrument components.

---

# 6. Parameter Assignment & Modulation System

An important feature of GroovePad.js is the ability to assign parameters to other controls.

For example:

- A knob controls the filter frequency of an MPC Pad.
- An LFO modulates a knob's assigned parameter.
- A Mod Wheel controls an instrument parameter.
- An Arpeggiator drives a compatible instrument.
- A fader or button can control an assignable parameter.

## 6.1 Assignment interaction

Implement an intuitive drag-to-assign interaction.

The intended workflow:

1. Long-press a parameter label in a component's settings panel.
2. Begin dragging the parameter.
3. The settings panel fades out while dragging.
4. Drag the parameter onto a compatible grid component.
5. The target component visually indicates that it can receive the parameter.
6. Release to establish the connection.
7. The settings panel fades back in.

## 6.2 Compatibility

Not every parameter should connect to every component.

Implement a parameter compatibility system.

For example:

- Filter frequency can connect to knobs and LFOs.
- Volume can connect to knobs and modulation sources.
- Pitch can connect to piano roll output.
- Boolean parameters can connect to buttons.

Compatibility should be defined through parameter metadata rather than hardcoded UI logic.

## 6.3 Connection architecture

Represent connections explicitly in the project data.

A connection should contain:

- Source component ID.
- Source parameter ID.
- Target component ID.
- Target parameter ID.
- Modulation depth or scaling where applicable.
- Optional mapping configuration.

The architecture should support multiple modulation sources targeting a parameter in the future.

---

# 7. Multitouch & Performance Interaction

Multitouch support is a core requirement.

The application must support simultaneous interaction with multiple grid components.

Examples:

- Pressing multiple MPC pads simultaneously.
- Playing multiple piano keys.
- Adjusting one control while triggering another pad.
- Interacting with multiple independent controls simultaneously.

Use Pointer Events and pointer identifiers to track individual interactions.

Do not implement touch handling in a way that allows one component to cancel another component's active interaction.

Prevent unwanted browser gestures such as scrolling, text selection, and pinch zoom while interacting with performance controls, without compromising normal application navigation.

Prioritize low interaction latency and responsive visual feedback.

---

# 8. Visual Design System

## Design direction

The UI should be inspired by Ableton Live's design philosophy:

- Minimal.
- Functional.
- Clear.
- Performance-oriented.
- High information density without visual clutter.

Do not directly copy Ableton's branding or proprietary visual assets.

## Visual principles

- Dark interface by default.
- Neutral backgrounds.
- Clear contrast between controls.
- Restrained use of accent colors.
- Strong visual feedback for active controls.
- Consistent spacing and alignment.
- Large touch targets.
- Simple typography.
- Minimal decorative elements.

The UI should feel like a compact hardware groovebox rather than a traditional desktop application squeezed onto a phone.

## Component consistency

Create shared design tokens for:

- Colors.
- Spacing.
- Border radii.
- Typography.
- Control sizes.
- Active states.
- Disabled states.
- Interaction feedback.

All components should use these shared tokens.

---

# 9. Project & Data Persistence

Users must be able to save and restore their complete GroovePad configurations.

## Project structure

A project should contain:

- Project metadata.
- BPM.
- Banks.
- Bank settings.
- Grid dimensions.
- Grid element positions and dimensions.
- Component configurations.
- Parameter values.
- Parameter assignments.
- Modulation connections.
- Sample references.

Use a versioned JSON project format.

## Persistence requirements

- Save projects to user-selected files.
- Load projects from user-selected files.
- Support browser-based local persistence for convenience.
- Preserve bank layouts independently.
- Validate imported project data.
- Handle unsupported project versions gracefully.

Do not rely exclusively on browser storage for project persistence.

Sample assets should be referenced or packaged using a documented strategy so projects can be transferred between devices.

---

# 10. Progressive Web App Requirements

PWA functionality is mandatory, not optional.

Implement:

- Web app manifest.
- Application icons.
- Installability.
- Service worker.
- Application shell caching.
- Offline application startup.
- Responsive mobile layout.
- Appropriate viewport configuration.
- Standalone display mode.
- Theme colors.

The application should remain usable offline after the initial installation and asset download.

Design around mobile browser limitations, particularly iOS Safari.

Avoid assuming that all browsers expose identical audio, pressure, file-picker, or pointer capabilities.

Provide graceful fallbacks when APIs are unavailable.

---

# 11. Suggested Project Structure

Organize the application into logical modules.

Suggested structure:

```text
src/
├── app/
│   ├── App.vue
│   └── router/
│
├── components/
│   ├── layout/
│   │   ├── AppHeader.vue
│   │   ├── TransportControls.vue
│   │   ├── LCDDisplay.vue
│   │   ├── BankSelector.vue
│   │   └── MainMenu.vue
│   │
│   ├── grid/
│   │   ├── GrooveGrid.vue
│   │   ├── GridItem.vue
│   │   ├── GridEditor.vue
│   │   └── GridResizeHandles.vue
│   │
│   └── controls/
│       ├── MPCPad.vue
│       ├── Knob.vue
│       ├── LFO.vue
│       ├── ModWheel.vue
│       ├── PianoRoll.vue
│       └── Arpeggiator.vue
│
├── composables/
│   ├── usePointerInteraction.ts
│   ├── useMultitouch.ts
│   ├── useGridLayout.ts
│   ├── useParameterBinding.ts
│   └── useProjectPersistence.ts
│
├── stores/
│   ├── projectStore.ts
│   ├── bankStore.ts
│   └── transportStore.ts
│
├── services/
│   ├── audio/
│   ├── project/
│   └── modulation/
│
├── types/
│   ├── project.ts
│   ├── bank.ts
│   ├── grid.ts
│   ├── components.ts
│   └── modulation.ts
│
├── styles/
│   ├── tokens.css
│   ├── global.css
│   └── components.css
│
└── main.ts
```

This is a suggested structure. Adjust it where necessary to maintain a clean architecture.

---

# 12. Development Phases

Implement the application incrementally.

## Phase 1 — UI Foundation

Build:

- Application shell.
- Transport header.
- LCD display.
- Bank selector.
- Hamburger menu.
- Dark visual design system.
- Responsive portrait layout.

Use mock data initially where functionality is not yet implemented.

## Phase 2 — Grid Engine

Implement:

- Configurable grid dimensions.
- Default 4×4 grid.
- Arbitrary grid sizes.
- Grid element positioning.
- Variable element dimensions.
- Drag-and-drop editing.
- Element resizing.
- Edit Mode.

This phase should establish the foundation for every future grid component.

## Phase 3 — Component Library

Implement the initial controls:

- MPC Pad.
- Knob.
- LFO.
- Mod Wheel.
- Piano Roll.
- Arpeggiator.

Each component must have its own settings interface and standardized parameter output.

## Phase 4 — Parameter Assignment

Implement:

- Parameter metadata.
- Drag-to-assign interactions.
- Compatibility validation.
- Connection visualization.
- Persistent parameter connections.

## Phase 5 — Project Management

Implement:

- Add/remove banks.
- Bank customization.
- Project loading.
- Project saving.
- Local persistence.
- Project validation.

## Phase 6 — PWA & Optimization

Implement:

- PWA manifest.
- Service worker.
- Offline support.
- Installability.
- Mobile interaction optimization.
- Performance testing.

---

# 13. Initial Acceptance Criteria

The initial implementation should be considered successful when:

1. The application runs as a Vue.js 3 application.
2. The interface is optimized for portrait smartphone screens.
3. The application can be installed as a PWA.
4. A default 4×4 grid is displayed.
5. Users can create banks with custom grid dimensions.
6. Users can switch between banks.
7. Each bank retains its own grid configuration.
8. Grid elements can occupy multiple cells.
9. Elements can be moved and resized in Edit Mode.
10. The initial component library is implemented.
11. Components expose configurable settings.
12. Multiple pads and piano keys can be triggered simultaneously.
13. Parameter assignment is supported through the defined connection architecture.
14. Projects can be saved and loaded.
15. The application remains usable offline after installation.

---

# 14. Instructions to the AI Coding Agent

Work as a senior frontend engineer and application architect.

Do not attempt to implement everything in one monolithic component.

Start by establishing the application foundation and a consistent design system.

Then implement the application shell and grid engine before building the individual controls.

Important implementation guidelines:

- Prioritize working functionality over decorative mockups.
- Use reusable, strongly typed components.
- Keep business logic separate from presentation.
- Make the grid engine independent of individual control types.
- Treat multitouch as a fundamental architectural requirement.
- Design parameter assignment as a generic system.
- Keep the project format extensible and versioned.
- Test interactions on actual mobile-sized viewports.
- Ensure PWA functionality is implemented and tested.

**At the end of each development phase:**
- Verify that the application builds.
- Test the implemented functionality.
- Fix regressions before proceeding.
- Document important architectural decisions.
- Keep the project in a runnable state.

## Immediate first task

Start with Phase 1 and the foundations of Phase 2.

Create a polished, functional UI prototype featuring:

- The transport header.
- LCD display.
- Bank selector with customizable bank colors and icons.
- Hamburger menu.
- Edit Mode toggle.
- A working, configurable 4×4 grid.
- At least one functional MPC Pad.
- At least one functional Knob.
- Grid element movement and resizing.

Use sensible placeholder data for audio functionality at this stage.

The result should be a working application, not a static design mockup.

Keep the architecture ready for all the additional components and functionality described above.

Additional engineering recommendations
There are a few architectural decisions I'd strongly recommend making early, because they will affect almost every feature later.
Area	Recommendation	Reason
Grid engine	CSS Grid + logical cell coordinates	Makes arbitrary layouts and resizing manageable
Touch input	Pointer Events	Unified mouse, touch and pen handling
State	Pinia + TypeScript	Centralized project and bank state
Parameter system	Typed parameter registry	Makes control assignment extensible
Audio engine	Web Audio API, eventually AudioWorklet	Enables low-latency audio processing
Persistence	IndexedDB + JSON project files	Supports local data and portable projects
PWA	Vite PWA	Simplifies service worker and manifest setup

Three things I'd pay particular attention to
1. Separate the grid from the components.

The grid should not know what an MPC pad or LFO is. It should only know that it has an element with an ID, position, dimensions and component type. This makes adding new components significantly easier.

2. Build the parameter system before building all the controls.

Your drag-to-assign idea is one of the most interesting aspects of GroovePad.js. If every control uses a common parameter interface from the beginning, you can build a very flexible modulation system without rewriting the components later.

3. Treat multitouch as an architectural requirement, not a feature to add later.

A groovebox needs simultaneous interaction. The architecture should allow several controls to receive independent pointer events without interfering with one another.

My recommendation is to have the coding agent deliver Phase 1 and Phase 2 as a polished, usable prototype before attempting the audio engine. That gives you a solid foundation on which to build the actual instrument.