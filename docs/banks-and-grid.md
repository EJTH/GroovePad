# Banks and grid editing

## Banks

A bank is a named, coloured workspace containing its own grid layout and controls. Select a bank by clicking its tab. Bank settings can change its title, icon, colour, row count, and column count.

Long-press or right-click a bank tab to open its settings. The menu also provides explicit actions to add an empty bank, import a bank, and remove the current bank. At least one bank is always retained.

![Bank tabs and grid workspace](./images/bank-workspace.png)

## Grid editing

Choose **Edit** in the toolbar. In edit mode:

1. Click an empty cell to add a control.
2. Click a control to open its settings.
3. Drag or use the control's edit affordances to move or resize it.
4. Duplicate or remove a control from its settings.

The grid supports up to eight columns and ten rows. Resizing is constrained so existing controls remain inside the grid and do not overlap.

## SubGrids

In edit mode, add **Sub Grid** to an empty cell and choose **Open SubGrid** in its settings. In play mode, use its separate **Open** button. Use the normal Edit and Wire toolbar buttons inside it, **Grid settings** to resize it, and **Back** to return to its parent. SubGrids can contain other SubGrids.

To put a control on the SubGrid's surface, open the SubGrid, select **CFG**, select the control, and enable **Show on surface**. Return to the parent and leave Edit or Wire mode to play it. The separate Open button enters the grid without triggering its surfaced controls.

In the same CFG dialog, expose and name note, numeric or audio inputs and outputs to wire them from the parent grid. Ports can target controls in another nested SubGrid. Exposed selector outputs participate in its normal destination selection. Remove parent wires and parent exposures before removing a port, and remove a control's exposed ports before deleting it.

To copy a bank, open its bank settings and choose **Copy as SubGrid**. In edit mode, select an empty cell and choose **Paste SubGrid** from Add control. Each paste is an independent snapshot, including nested grids, controls, wires and samples. Copied loops are disarmed. The clipboard lasts until the project is replaced or the page is reloaded.

Loop references to other banks remain connected to those banks and are reported when copying. Main-bus audio routes are converted to the enclosing SubGrid's bank routes; if that would create feedback, copying is rejected. Audio can cross a SubGrid through its component input and output or through its exposed audio ports.

## Control settings

Every control has common identity and layout settings:

- Label
- Colour where supported
- Horizontal or vertical orientation
- Grid position and size

The rest of the settings depend on the control type. Changes are applied through the control settings dialog and then persisted with the project.

For an envelope Tone.js element, the visualizer and knobs can be shown or hidden independently in control settings. If both are hidden, select the envelope widget in play mode to reopen its settings.

## Importing banks

Banks can be imported from JSON, ZIP, or GPZ files. A project archive may contain multiple banks, in which case GroovePad asks which bank to import. A bank with loop or automation references to other banks must be imported as part of the complete project so those references are preserved.

[← Previous: Transport and project management](./transport-and-projects.md) · [Next: Controls and modulation →](./controls-and-modulation.md)

