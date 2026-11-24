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

## Control settings

Every control has common identity and layout settings:

- Label
- Colour where supported
- Horizontal or vertical orientation
- Grid position and size

The rest of the settings depend on the control type. Changes are applied through the control settings dialog and then persisted with the project.

## Importing banks

Banks can be imported from JSON, ZIP, or GPZ files. A project archive may contain multiple banks, in which case GroovePad asks which bank to import. A bank with loop or automation references to other banks must be imported as part of the complete project so those references are preserved.

[← Previous: Transport and project management](./transport-and-projects.md) · [Next: Controls and modulation →](./controls-and-modulation.md)

