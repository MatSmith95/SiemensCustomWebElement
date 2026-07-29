# 7. Engineering Patterns and Troubleshooting

## Keep boundary code defensive

Values can come from tags, screen scripts, restored projects, older versions,
or method calls. Normalize them before rendering:

```javascript
function toNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}
```

Do not use `value || fallback` for public values because valid values such as
`0`, `false`, and `""` are falsy. Check the type or test for
`undefined`/`null` explicitly.

For strings used as enum-like values, normalize casing and fall back safely,
as the joystick does for `AxisMode`.

## Separate model, rendering, and transport

A maintainable control generally has:

```text
WebCC boundary
    read/write properties, methods, events
        |
normalization and application state
        |
rendering
    DOM/SVG/canvas/CSS updates
```

A larger control can make this separation explicit:

- parsers turn incoming data into a validated internal model;
- state-changing functions enforce rules;
- `renderAll()` and smaller render functions update the page;
- a serializer creates public JSON when required; and
- a publisher writes the property and fires the event.

Avoid reading values back from rendered text or CSS to reconstruct business
state. The page should be a view of state, not the state database.

## Prevent feedback loops and duplicate events

If the control writes property `X`, the container may report `X` back through
the property-change subscription. Problems occur when the incoming handler:

- writes `X` again;
- treats it as a new operator action;
- fires a second event; or
- rebuilds a baseline that should not change.

For simple rendering, make the handler idempotent. For stateful behavior, track
short-lived signatures of writes and ignore only the matching reflection.

Similarly, do not fire status events every animation frame. The track controls
build a signature of meaningful public state and publish only when it changes.

## Rate-limit high-frequency operator output

Pointer move events can arrive much faster than tags should be written. The
joystick uses `UpdateMs`, remembers the last emission time, and schedules one
trailing update. Its final release or fault update is forced immediately so
the public outputs return to zero without waiting.

For operator controls:

- render locally at pointer speed for a smooth feel;
- rate-limit property/event traffic;
- always publish the final safe/rest state immediately; and
- test cancellation paths, not only normal pointer-up.

## Design fail-safe interaction

The joystick demonstrates browser cases that matter for machine interaction:

- pointer capture keeps movement associated with the active pointer;
- `pointercancel` forces a safe stop;
- `lostpointercapture` forces a safe stop;
- window blur forces a safe stop;
- hiding the document forces a safe stop;
- disabling the control returns outputs to zero; and
- a fault flag/event distinguishes abnormal cancellation.

A web control must not be the only safety layer. Put safety-related
interlocking and final output authority in the PLC/safety system appropriate
to the application.

## Use one animation loop

Use `requestAnimationFrame` for visual animation:

- keep at most one outstanding frame request;
- calculate movement from elapsed time, not assumed frame count;
- clamp a very large elapsed time after pauses;
- stop when disabled, stationary, or `document.hidden`; and
- restart cleanly without using an old timestamp.

Both track controls implement this through `syncAnimationLoop()`,
`animationTick()`, and `stopAnimationLoop()`.

Avoid writing WebCC properties on every animation frame. Animation offsets are
visual implementation details and should remain local.

## Treat JSON properties as versioned protocols

When a string property contains JSON:

1. parse inside `try/catch`;
2. require the expected root shape;
3. check a version field;
4. validate limits and required identifiers;
5. decide whether invalid items reject the whole document or are skipped;
6. report every correction/error in an output property or event;
7. produce deterministic serialized output; and
8. document whether incoming data establishes a new baseline.

For example, a list parser might skip invalid individual items while reporting
them, whereas a layout parser might reject invalid dimensions and positions.
Either approach is safer than assigning parsed data directly to the DOM.

Do not insert untrusted JSON strings with `innerHTML`. Create elements and set
`textContent`, as the controls do.

## Keep runtime assets offline and explicit

Package libraries, fonts where licensing allows, icons, and images needed by
the control. Do not depend on a CDN or internet access from an HMI panel.

Treat URLs supplied through properties as untrusted. Use an allow-list of
approved relative images or selected `data:image/...` formats if a future
control accepts media paths.

## Accessibility and touch

Even an industrial control benefits from semantic HTML:

- label form fields;
- use real `button` elements;
- include `role`, `aria-label`, meter values, and live status where useful;
- show disabled/read-only state visually and functionally;
- make touch targets large enough for panel operation; and
- do not communicate alarm state using color alone.

Use pointer events rather than separate mouse and touch implementations when a
single interaction model is sufficient. Set CSS `touch-action` appropriately
for custom gestures.

## Troubleshooting table

| Symptom | Likely cause | Checks |
| --- | --- | --- |
| Blank control in Runtime | Connection did not start, script failed, or a packaged file is missing | Runtime console/logs; `node --check`; `unzip -l`; relative paths; successful `WebCC.start` callback |
| Works locally but not after import | Mock hid a package/contract error | Check real bridge file; ZIP root; all referenced assets; GUID; manifest/runtime contract; TIA compile |
| Control never starts in local HTTP preview | Mock was not requested | Add `?mock` or `#mock`; confirm `webcc.mock.js` loads before `webcc.min.js` |
| A property appears in TIA but does nothing | Missing runtime default or property handler | Compare manifest properties with `WebCC.start` and `onPropertyChanged` logic; verify exact casing |
| JavaScript uses a property that is absent in TIA | It exists only in `DEFAULTS`/runtime contract | Add it to the manifest and rebuild/reimport |
| Method is unknown in the mock/Runtime | Missing registration or name mismatch | Compare manifest method name with `WebCC.start(...).methods`; check parameter order |
| Event handler never runs | Event missing from runtime event list or wrong argument shape | Compare manifest event, runtime `events` array, and `Events.fire` call |
| Initial view is wrong but later changes work | Initial properties were never applied | Call `refresh('init')` or explicitly pass initial `WebCC.Properties` through the handler after connection |
| Value `0` or `false` becomes a default | Falsy-value fallback was used | Replace `value || fallback` with type-aware conversion |
| Colors are transparent or incorrect | ARGB/RGBA conversion or signed integer issue | Convert with `number >>>= 0`; verify `0xAARRGGBB`; include `FF` alpha for opaque colors |
| Endless property/event activity | Reflected write or handler loop | Make updates idempotent; compare before writing; add short-lived own-write signatures |
| Animation speeds up after changes | More than one animation loop was started | Store one frame ID; only request when it is `null`; cancel before restart |
| Touch remains active after leaving the control | Missing cancellation handling | Use pointer capture; handle `pointercancel`, lost capture, blur, and visibility changes |
| Layout is clipped at some sizes | Fixed dimensions or unhandled aspect ratio | Fill `html/body`; use grid/flex/SVG viewBox; test manifest minimum and extreme ratios |
| An image/library works in source but not ZIP | File omitted from package allow-list | Add the exact path to `PACKAGE_FILES`, rebuild, and compare archive content |
| New ZIP seems unchanged in TIA | ZIP was stale or version/identity is confusing | Inspect packaged manifest; compare ZIP to source; increment compatible version; confirm correct GUID file was imported |

## Review checklist for a new control

### Public API

- Are names, units, ranges, intended directions, and defaults documented?
- Does every manifest member have matching runtime registration?
- Are property, method, and event roles used consistently?
- Are breaking changes avoided for an existing GUID?

### Behavior

- Are all external values normalized?
- Is there one clear state-change and render path?
- Are output properties durable state and events meaningful occurrences?
- Are high-frequency outputs limited?
- Are safe/rest states forced on abnormal interaction endings?

### Browser implementation

- Does it use packaged, relative assets?
- Is the layout responsive from minimum to large sizes?
- Are timers, frames, and listeners controlled?
- Are text and URLs handled safely?
- Are touch, disabled/read-only, and accessibility states covered?

### Delivery

- Does the mock test every public member?
- Do syntax and manifest checks pass?
- Does the explicit package list include every dependency?
- Does the GUID match in manifest, script, and filename?
- Is the final behavior proven in Unified Runtime and on the target?
