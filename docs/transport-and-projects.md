# Transport and project management

## Transport

The transport header provides:

- **Record**: starts a session recording. Press it again to stop and download the selected format.
- **Play/Pause**: starts or pauses the shared transport clock.
- **BPM**: opens project settings for tempo changes.
- **Metronome**: enables the four-beat indicator and metronome output.

Playback and recording are independent: recording captures the audio output, while playback controls the musical clock used by loops and synced controls.

## Project settings

Project settings contain:

- BPM
- Scrolling information text
- Information scroll speed
- Session recording format

Changes are saved automatically to local project storage.

## New, load, and save

Use the menu to:

- **New project**: replace the current project with the default template after confirmation.
- **Load project**: import a `.zip` or `.gpz` project and replace the current workspace after confirmation.
- **Save project**: download the current project as `groovepad-project.zip`.

Loading and saving errors are shown in the workspace so a failed operation does not silently replace data.

## Persistence

GroovePad debounces local saves and also saves when the page is hidden or unloaded. Invalid or unavailable storage is reported with a recovery action rather than overwriting the saved project.

[← Previous: Getting started](./getting-started.md) · [Next: Banks and grid editing →](./banks-and-grid.md)

