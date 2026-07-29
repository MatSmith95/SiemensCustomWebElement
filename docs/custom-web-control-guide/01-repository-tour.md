# 1. Repository Tour

## Controls in this repository

Each top-level control folder is a self-contained browser application and
Siemens manifest.

| Folder | What it demonstrates | Good place to study |
| --- | --- | --- |
| `Gauge` | A compact, property-driven canvas control using a third-party library | Initial property application, structured manifest types, colors, methods, and events |
| `Analog_Joystick` | A touch/pointer input control that writes live output properties | Pointer capture, rate limiting, fail-safe release behavior, output properties |
| `Animated_Track_Side_View` | An SVG animation controlled from Unified | `requestAnimationFrame`, responsive SVG, property normalization, color properties |
| `Animated_Track_Top_View` | A second implementation of the same public pattern | Reusing an interface while changing the visual implementation |

There is also a Siemens Gauge reference package under
`109779176_Unified_Gauge_CWC_V1.4`. It is useful as an upstream example, while
the top-level `Gauge` folder is easier to run with this repository's local
mock.

## Standard control layout

The current controls use this layout:

```text
My_Control/
├── manifest.json
├── CWC_manifest_Schema.json
├── assets/
│   └── logo.png, logo.svg, or logo.ico
├── control/
│   ├── index.html
│   ├── styles.css
│   ├── code.js
│   ├── webcc.d.ts
│   └── js/
│       ├── webcc.min.js
│       ├── webcc.mock.js
│       └── optional-library.min.js
├── tests/                       # optional
│   └── headless-smoke.mjs
├── package.sh                   # optional but recommended
└── {CONTROL-GUID}.zip           # generated import artifact
```

The ZIP contains the package files at its root. It must not add an extra outer
folder such as `My_Control/`.

## What each file does

### `manifest.json`

This is the public definition of the control. TIA Portal uses it to discover:

- the control name, version, icon, GUID, and start page;
- preferred and minimum rendering sizes;
- callable methods;
- fireable events;
- bindable properties and their defaults; and
- reusable data types such as Unified colors, arrays, objects, and enums.

The manifest does not implement behavior. It describes what is available.
For rendering-space units, note the schema/repository spelling difference
explained in [Manifest and contract reference](03-manifest-and-contract.md).

### `CWC_manifest_Schema.json`

This is the JSON schema for the manifest format used by these examples
(`mver` 1.2.0). An editor can use it for validation and completion because
`manifest.json` begins with:

```json
{
  "$schema": "./CWC_manifest_Schema.json"
}
```

Keep the schema in the source folder and import package. Do not edit it merely
to make an invalid manifest pass validation.

### `assets/logo.*`

The manifest identity points to this icon. It represents the control in the
engineering environment. Any other images needed at runtime also belong under
`assets/` and must be included in the package file list.

### `control/index.html`

This is the page loaded into the Unified control container. It:

- declares the visible HTML, SVG, or canvas;
- loads `styles.css`;
- loads the local mock before the real WebCC bridge;
- loads any visual libraries; and
- loads `code.js` after the markup exists.

The normal order in this repository is:

```html
<link rel="stylesheet" href="./styles.css">
<script src="./js/webcc.mock.js"></script>
<script src="./js/webcc.min.js"></script>
<!-- optional third-party libraries here -->
...
<script src="./code.js"></script>
```

`webcc.mock.js` only creates a mock connection for an explicitly requested
local preview. In the Unified container it stays inactive, allowing
`webcc.min.js` to connect to the real Runtime.

### `control/styles.css`

This owns appearance and responsive layout. A control does not know the final
size at authoring time, so styles should work across the manifest's supported
rendering space. The track controls use responsive SVG `viewBox` scaling,
while the joystick calculates a size from its actual container.

### `control/code.js`

This is the application logic. Typical responsibilities are:

- hold internal UI state;
- validate and normalize values arriving from Unified;
- render the DOM, SVG, or canvas;
- handle operator input;
- write output values to `WebCC.Properties`;
- fire declared events with `WebCC.Events.fire(...)`;
- expose declared methods through `WebCC.start(...)`;
- subscribe to incoming property changes; and
- stop timers or animation work when it is no longer needed.

### `control/js/webcc.min.js`

This is the Siemens bridge. Treat it as a supplied runtime dependency rather
than application code. `WebCC.start(...)` uses it to establish the connection
between the embedded page and WinCC Unified.

### `control/js/webcc.mock.js`

This is a repository development aid. It implements the subset of `WebCC`
needed by these controls and records property writes and events. It is covered
in [Local development and testing](05-local-development-and-testing.md).

### `control/webcc.d.ts`

This TypeScript declaration file documents the Siemens WebCC JavaScript API.
The controls themselves are ordinary JavaScript, so the file is not executed.
It is useful for editor help and as a readable API reference.

### Optional libraries

The Gauge loads `control/js/gauge.min.js` before `code.js`. Libraries used by a
control must be stored locally and packaged. A panel or Runtime workstation
should not have to reach a public CDN to display an HMI control.

### Packaging scripts and ZIPs

The repository-level `scripts/package-track-controls.sh` builds both track
controls. This script:

1. check JavaScript syntax;
2. parse the manifest;
3. check that the requested GUID matches the manifest;
4. rebuild the ZIP from an explicit allow-list;
5. test ZIP integrity; and
6. compare every packaged entry byte-for-byte with its source.

That explicit file list prevents forgotten files and accidental packaging of
editor settings, test data, old ZIPs, or unrelated source.

## Which example should a new programmer copy?

Start from `Animated_Track_Top_View` or `Analog_Joystick` for a new plain
HTML/SVG control. Their code is wrapped in an immediately invoked function,
keeps defaults in one object, and has small helpers around WebCC.

Use the Gauge when learning structured manifest types or integrating a
packaged browser library.

For a larger application-style control, retain the same WebCC boundary but
introduce model, validation, and rendering modules only as the complexity
requires. Copying state-management machinery into a simple indicator makes the
new control harder to maintain.
