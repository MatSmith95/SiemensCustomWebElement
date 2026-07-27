# Datapath Video Wall Editor

Datapath is a touch-friendly Siemens WinCC Unified Custom Web Control for
defining a rectangular video wall and assigning named video feeds to its
display areas. Version 1.1 can merge rectangular groups of physical cells into
larger logical screens. It renders feed names and identifiers as preview tiles;
it does not play live video.

The control is self-contained and follows the same package layout and WebCC
lifecycle as the other controls in this repository:

```text
Datapath/
├── manifest.json
├── CWC_manifest_Schema.json
├── package.sh
├── assets/
│   ├── logo.png
│   └── logo.svg
└── control/
    ├── index.html
    ├── styles.css
    ├── code.js
    ├── webcc.d.ts
    └── js/
        ├── webcc.min.js
        └── webcc.mock.js
```

The generated Siemens import artifact is:

```text
{54F807D6-B8B8-4932-979D-598BE46E6A03}.zip
```

## Operator workflow

1. Enter a wall name, row count, column count and display gap. Row and column
   changes rebuild when the field is committed; **Update wall** commits all
   displayed settings together.
2. To create a larger screen, select its intended top-left cell, enter
   **Rows high** and **Columns wide**, then select **Merge area**. Merged areas
   must be rectangular and cannot overlap.
3. Select a display tile or merged area.
4. Select a feed in **Available feeds** to assign or replace its feed.
5. Use **Split area** to restore a merged area to individual cells, or
   **Clear selected** to remove its assignment.
6. Review the wall and select **Apply layout** to accept it as the reset
   baseline.

**Clear wall** and **Reset changes** require confirmation. Reducing the wall
also requires confirmation when it would remove assignments or clip merged
areas. Merging requires confirmation when assignments on cells that will be
covered must be removed. Assignments still inside the new dimensions are
preserved.

`LayoutJson` is updated immediately after every operator configuration change;
**Apply layout** is an acknowledgement/baseline action, not the only time data
is sent to Unified.

## Interface properties

The supplied Siemens manifest schema does not define separate input-only and
output-only property metadata. All properties therefore use the repository's
normal bidirectional `WebCC.Properties` convention. The intended directions
below are usage guidance.

| Property | Type | Intended use | Description |
| --- | --- | --- | --- |
| `WallName` | string | Input/output | Optional name or identifier. |
| `Rows` | number | Input/output | Wall rows, 1–8. |
| `Columns` | number | Input/output | Wall columns, 1–12. Rows × columns cannot exceed 64. |
| `DisplayGap` | number | Input/output | Gap between cells in pixels, 0–40. |
| `AvailableFeedsJson` | string | Input | Available feed definitions as JSON. |
| `LayoutJson` | string | Input/output | Complete version 1 layout JSON. Incoming valid data restores a saved layout; operator changes write the complete value. |
| `AllowDuplicateFeeds` | boolean | Input | When `false` (default), a feed can be used by only one cell. |
| `EditEnabled` | boolean | Input | Enables configuration. When `false`, the preview remains visible but editing is blocked. |
| `SelectedCell` | string | Input/output | Selected screen ID such as `R1C1`, or an empty string. |
| `StatusText` | string | Output | Latest operational status or validation error. |
| `HasUnsavedChanges` | boolean | Output | `true` when the current model differs from the applied or externally loaded baseline. |
| `BackgroundColor` | Unified Color | Input | Overall ARGB background colour. |
| `CellColor` | Unified Color | Input | Unassigned cell ARGB colour. |
| `SelectedCellColor` | Unified Color | Input | Selection ARGB colour. |
| `AssignedCellColor` | Unified Color | Input | Assigned cell ARGB colour. |
| `TextColor` | Unified Color | Input | Primary text ARGB colour. |

The configurable limits are grouped in the `LIMITS` constant near the top of
`control/code.js`.

### Property update behaviour

- Incoming feed JSON is validated before replacing the current feed list.
- Incoming layout JSON is validated before replacing the current wall.
- A valid incoming `LayoutJson` is authoritative: it establishes a new reset
  baseline and synchronises `WallName`, `Rows`, `Columns`, and `DisplayGap`.
- Incoming scalar row/column updates preserve in-bounds assignments and are
  treated as authoritative automation updates. The confirmation dialog applies
  to operator changes made through the editor; an HMI script should perform
  its own confirmation before writing smaller dimensions.
- Writes made by the control are signature-tracked so a reflected tag update
  is not processed as a new operator change.
- If the available feed list changes after a layout is loaded, assignments
  whose feeds disappeared remain visibly faulted so an operator does not lose
  configuration silently. Such a layout cannot be applied until corrected.

## Feed JSON

`AvailableFeedsJson` accepts either a JSON array or an object with a `feeds`
array. Each item requires `id` (or the alias `feedId`). `displayName`,
`description`, and `thumbnailUrl` are optional.

Example:

```json
[
  {
    "id": "CAMERA_01",
    "displayName": "North Gate",
    "description": "Fixed overview camera"
  },
  {
    "id": "CAMERA_02",
    "displayName": "Loading Bay",
    "description": "Dock camera"
  },
  {
    "id": "SCADA_OVERVIEW",
    "displayName": "Plant Overview",
    "description": "Overview workstation output"
  },
  {
    "id": "CONTROL_ROOM",
    "displayName": "Control Room",
    "thumbnailUrl": "../assets/control-room.png"
  }
]
```

To remain offline and avoid external requests, thumbnails accept only:

- a relative path to an image packaged with the control, such as
  `../assets/control-room.png`; or
- a `data:image/png`, `data:image/jpeg`, `data:image/gif`, or
  `data:image/webp` URL.

An unsupported or failed thumbnail is replaced with the normal feed
placeholder; feed assignment still works. If extra packaged thumbnail files
are added, also add their paths to `PACKAGE_FILES` in `package.sh`.

Invalid items and duplicate IDs are skipped and reported through `StatusText`
and `ConfigurationError`. At most 256 feeds are accepted.

## Layout JSON

The output always includes one cell record for every physical wall position.
Rows and columns are zero-based inside the JSON and one-based in `screenId`.
`displayGap` is an optional extension to the base format; an incoming layout
without it uses the current scalar property.

An independent or merged-area anchor uses:

- `rowSpan`: number of physical rows occupied; defaults to `1`.
- `columnSpan`: number of physical columns occupied; defaults to `1`.
- `feedId`: feed assigned to the complete logical area.

A physical position covered by a merged anchor uses `mergedInto` with the
anchor's `screenId` and has no feed assignment. Incoming layouts may omit
covered position records, but output from the control always includes them.

Two-row by three-column example:

```json
{
  "version": 1,
  "wallName": "Main Video Wall",
  "rows": 2,
  "columns": 3,
  "displayGap": 8,
  "cells": [
    {
      "row": 0,
      "column": 0,
      "screenId": "R1C1",
      "feedId": "CAMERA_01",
      "rowSpan": 1,
      "columnSpan": 1
    },
    {
      "row": 0,
      "column": 1,
      "screenId": "R1C2",
      "feedId": "CAMERA_02",
      "rowSpan": 1,
      "columnSpan": 1
    },
    {
      "row": 0,
      "column": 2,
      "screenId": "R1C3",
      "feedId": null,
      "rowSpan": 1,
      "columnSpan": 1
    },
    {
      "row": 1,
      "column": 0,
      "screenId": "R2C1",
      "feedId": "SCADA_OVERVIEW",
      "rowSpan": 1,
      "columnSpan": 1
    },
    {
      "row": 1,
      "column": 1,
      "screenId": "R2C2",
      "feedId": null,
      "rowSpan": 1,
      "columnSpan": 1
    },
    {
      "row": 1,
      "column": 2,
      "screenId": "R2C3",
      "feedId": null,
      "rowSpan": 1,
      "columnSpan": 1
    }
  ]
}
```

For a 4 × 4 wall with a central 2 × 2 SCADA area, the relevant records are:

```json
{
  "version": 1,
  "wallName": "Control Room Wall",
  "rows": 4,
  "columns": 4,
  "displayGap": 8,
  "cells": [
    {
      "row": 1,
      "column": 1,
      "screenId": "R2C2",
      "feedId": "SCADA_OVERVIEW",
      "rowSpan": 2,
      "columnSpan": 2
    },
    {
      "row": 1,
      "column": 2,
      "screenId": "R2C3",
      "feedId": null,
      "mergedInto": "R2C2"
    },
    {
      "row": 2,
      "column": 1,
      "screenId": "R3C2",
      "feedId": null,
      "mergedInto": "R2C2"
    },
    {
      "row": 2,
      "column": 2,
      "screenId": "R3C3",
      "feedId": null,
      "mergedInto": "R2C2"
    }
  ]
}
```

The remaining twelve 4 × 4 positions are normal `1 × 1` cells. They may be
included in incoming JSON and are always included in control output.

Missing `version`, `wallName`, `displayGap`, or `cells` fields receive safe
defaults. Unsupported versions and invalid dimensions reject the incoming
layout without replacing the current one. Invalid cell positions, duplicate
positions, spans outside the wall, overlapping merged areas, assignments on
covered cells, unavailable feeds, and disallowed duplicate assignments are
skipped and reported without stopping the control. Supplied `screenId` values
are informational; canonical values are regenerated from `row` and `column`.

## Events

Every event has one string argument named `payload`. Parse it with
`JSON.parse()` in a Unified script.

| Event | Payload contents |
| --- | --- |
| `LayoutChanged` | Change action, complete layout object, dirty state, timestamp. |
| `CellSelected` | Change reason, selected cell or `null`, timestamp. |
| `FeedAssigned` | Cell, feed ID/name, replaced feed ID when applicable, timestamp. |
| `FeedRemoved` | Reason, cell, removed feed ID/name, timestamp. |
| `CellsMerged` | Merged anchor, new and previous spans, removed assignments, timestamp. |
| `CellsSplit` | Split anchor, previous span, timestamp. |
| `ConfigurationError` | Stable error code, message, issue list, context, timestamp. |

Example `FeedAssigned` payload:

```json
{
  "timestamp": 1785168000000,
  "reason": "assigned",
  "cell": {
    "row": 0,
    "column": 0,
    "screenId": "R1C1",
    "feedId": "CAMERA_01",
    "feedName": "North Gate"
  },
  "feedId": "CAMERA_01",
  "feedName": "North Gate",
  "replacedFeedId": null
}
```

## Methods

| Method | Description |
| --- | --- |
| `ApplyLayout()` | Validates the current assignments, sends `LayoutJson`, stores the current reset baseline, and clears `HasUnsavedChanges`. |
| `ResetChanges()` | Shows confirmation and restores the baseline. |
| `ClearWall()` | Shows confirmation and clears every assignment. |
| `SelectCell(screenId)` | Selects a cell such as `R1C1`; an empty string clears selection. |
| `MergeSelected(rowSpan, columnSpan)` | Merges a rectangle from the selected top-left cell. |
| `SplitSelected()` | Splits the selected merged area into independent cells. |

Methods that change configuration honour `EditEnabled`.

## Build and package

Requirements are the same small command-line tools used by the repository's
existing package script: Bash, Node.js, `zip`, `unzip`, and `cmp`.

From the repository root:

```bash
./Datapath/package.sh
```

The script:

1. syntax-checks `control/code.js`;
2. parses the manifest and verifies its GUID;
3. creates or updates the GUID-named ZIP from an explicit file list;
4. tests the ZIP; and
5. byte-compares every archived file with its source.

The ZIP contains `assets/`, `control/`, `manifest.json`, and
`CWC_manifest_Schema.json` at its root, matching the Siemens examples. The
source README, tests, and packaging script are intentionally not part of the
runtime artifact.

An optional end-to-end mock smoke test is also included. It requires Node.js
with the global WebSocket API and Chrome/Chromium. On systems where Chrome is
not in a standard location, set `CHROME_PATH`.

```bash
node Datapath/tests/headless-smoke.mjs
```

The test drives the control through Chrome's local debugging interface and
checks layout restoration, click assignment, merge/split round-trips, output
properties/events, invalid references, malformed JSON handling, read-only
mode, and action containment at the 360 × 280 px minimum size. It does not
contact the internet.

## Install in WinCC Unified

Copy the GUID-named ZIP to one of these locations on the TIA Portal engineering
computer:

- Project-only:
  `...\Project_1\UserFiles\CustomControls\{54F807D6-B8B8-4932-979D-598BE46E6A03}.zip`
- All projects:
  `C:\Program Files\Siemens\Automation\Portal Vxx\Data\Hmi\CustomControls\{54F807D6-B8B8-4932-979D-598BE46E6A03}.zip`

Replace `Vxx` with the installed TIA Portal version. A project copied to
another engineering PC also needs the Custom Web Control ZIP copied there.
TIA Portal transfers the control with the project to the Unified target; there
is no separate Runtime-server installation.

To add the control:

1. Open a screen for the Unified Comfort Panel or Unified PC station.
2. Under **Tools > My Controls**, find **Datapath Video Wall Editor**.
3. Drag it onto the screen and size it. The recommended initial size is
   1000 × 680 px; the manifest minimum is 360 × 280 px.
4. Open the object's **Properties > Interface** section to configure or
   dynamize its manifest properties.

If a newly copied control does not appear, close and reopen the project or
restart TIA Portal so the Custom Controls directory is scanned again.

## Connect Unified tags

The exact tag names are project-specific. A typical setup is:

1. Create HMI string tags for `AvailableFeedsJson`, `LayoutJson`,
   `SelectedCell`, and `StatusText`.
2. Create integer tags for `Rows`, `Columns`, and `DisplayGap`.
3. Create Boolean tags for `AllowDuplicateFeeds`, `EditEnabled`, and
   `HasUnsavedChanges`.
4. In the control's **Properties > Interface**, dynamize each property with the
   corresponding tag.
5. Initialise `AvailableFeedsJson` before `LayoutJson` so saved feed
   references can be validated during restoration.
6. Use event scripts when immediate action is required, or monitor
   `LayoutJson`/`HasUnsavedChanges` as normal tag values.

Example event-script pattern:

```javascript
let change = JSON.parse(payload);
HMIRuntime.Trace("Datapath action: " + change.action);
```

The event argument name exposed by the manifest is `payload`; use the event
script parameter provided by the TIA Portal editor for the exact local
variable name in the target release.

## Local preview and mock API

Open the HTML file directly:

```bash
open "$PWD/Datapath/control/index.html"
```

Or serve the repository and use explicit mock mode:

```bash
python3 -m http.server 8080
```

Open
`http://localhost:8080/Datapath/control/index.html?mock`, then run:

```javascript
WebCC._mock.setProperty('AvailableFeedsJson', JSON.stringify([
  { id: 'CAMERA_01', displayName: 'North Gate' },
  { id: 'CAMERA_02', displayName: 'Loading Bay' }
]))

WebCC._mock.setProperty('LayoutJson', JSON.stringify({
  version: 1,
  wallName: 'Main Video Wall',
  rows: 2,
  columns: 3,
  cells: [
    { row: 0, column: 0, feedId: 'CAMERA_01' },
    { row: 0, column: 1, feedId: null }
  ]
}))

WebCC._mock.callMethod('SelectCell', 'R1C2')
WebCC._mock.snapshot()
WebCC._mock.events
WebCC._mock.propertyWrites
```

Mock mode verifies browser behaviour and property/event traffic. Final
validation of import, tag dynamization, container focus/operability, and target
browser behaviour must be performed in the actual WinCC Unified Runtime.

## Lifecycle and compatibility notes

- The control calls `WebCC.start`, supplies the same manifest contract at
  startup, and subscribes to `WebCC.onPropertyChanged`.
- Rendering uses plain packaged HTML, CSS, and JavaScript without external
  libraries, fonts, frames, or parent-page access.
- Responsive behaviour uses CSS Grid plus the standard window resize event;
  no `ResizeObserver` dependency is required.
- UI listeners and pending animation frames are released on `pagehide` or
  `beforeunload`. The supplied WebCC API has no unsubscribe function, so the
  property callback becomes a no-op after destruction.
- Labels are currently English and embedded in the HTML/JavaScript, matching
  the existing controls in this repository; there are no separate localisation
  resources.

## Version 1.1 limitations

- No live video playback, decoder control, stream transport, or Datapath
  hardware API integration.
- Merged display areas must be rectangular and aligned to the physical grid;
  there is no bezel compensation, overlapping areas, rotation, or irregular
  L-shaped geometry.
- No drag-and-drop. The click/touch workflow is always available.
- No feed search, feed groups, import/export dialog, undo history, or
  role-specific authorization beyond `EditEnabled`.
- No built-in persistence beyond `LayoutJson`; the Unified project must bind
  or script that property to durable storage.
- English UI only.
