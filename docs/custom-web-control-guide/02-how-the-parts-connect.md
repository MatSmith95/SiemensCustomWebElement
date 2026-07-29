# 2. How the Parts Connect

## The three layers

A control has three distinct layers:

1. **Engineering contract** — `manifest.json` tells TIA Portal what the
   control exposes.
2. **Browser application** — HTML, CSS, SVG/canvas, and `code.js` create the
   visible behavior.
3. **Runtime bridge** — `webcc.min.js` and the global `WebCC` object carry data
   between the browser application and WinCC Unified.

Keeping these layers separate makes faults easier to diagnose. For example, a
broken CSS selector is a browser problem; a property shown in TIA but ignored
by the page is usually a contract or property-handler problem.

## Startup sequence

When Unified loads a control, the sequence is:

```text
1. The container opens the start page from manifest.control.identity.start.
2. index.html creates the DOM/SVG/canvas and loads scripts.
3. webcc.min.js makes the WebCC API available.
4. code.js calls WebCC.start(callback, contract, extensions, timeout).
5. WebCC establishes the container connection.
6. The callback receives result === true.
7. The control reads initial WebCC.Properties and renders itself.
8. The control subscribes to WebCC.onPropertyChanged.
9. Runtime and operator interaction continue in both directions.
```

The controls use a 10,000 ms connection timeout:

```javascript
WebCC.start(onConnected, contract, [], 10000);
```

Do not manipulate `WebCC.Properties` before a successful connection callback.
DOM elements can be cached earlier, but initial values supplied by TIA Portal
are reliable after the connection succeeds.

## The runtime contract

This repository passes an object with three sections to `WebCC.start(...)`:

```javascript
{
    methods: {
        SetEnabled: setEnabled
    },
    events: ['StateChanged'],
    properties: {
        Enabled: true,
        Value: 0
    }
}
```

That object must mirror the corresponding `methods`, `events`, and
`properties` under `control.contracts.api` in `manifest.json`.

The manifest's defaults describe engineering defaults. The JavaScript defaults
are required to register the runtime property contract. Values configured in
TIA Portal can overwrite the JavaScript defaults when the control starts.

## Properties: shared values

Properties are the main ongoing data channel. Typical uses are:

- **Runtime to control:** a PLC tag drives `TrackSpeed`, `GaugeValue`, or
  `Alarm`; the control receives a property-change notification and redraws.
- **Control to Runtime:** the joystick writes `JoyX`, `JoyY`, and `JoyActive`;
  Unified can bind those properties to tags or scripts.
- **Both directions:** a configuration control can accept an incoming JSON
  property and write a new value after an operator edit.

Read and write properties with:

```javascript
const value = WebCC.Properties.Value;
WebCC.Properties.Value = nextValue;
```

Subscribe once to changes coming from the container:

```javascript
function setProperty(change) {
    switch (change.key) {
        case 'Value':
            renderValue(Number(change.value));
            break;
        case 'Enabled':
            renderEnabled(Boolean(change.value));
            break;
    }
}

WebCC.onPropertyChanged.subscribe(setProperty);
```

The callback object has a `key` and `value`. Validate `value`; do not assume a
tag, script, restored project, or older package supplied the expected range.

### Initial values are a separate step

A property-change subscription handles later changes, not necessarily the
initial render. The Gauge explicitly applies every initial property after
connection. The newer controls call a `refresh()` function that reads all
properties. Both patterns are valid:

```javascript
function initialize() {
    refresh('init'); // reads current WebCC.Properties
    WebCC.onPropertyChanged.subscribe(setProperty);
}
```

## Methods: Unified calls the control

Methods are commands initiated by a Unified screen script or the engineering
event system. The manifest declares the method name and parameter types.
`WebCC.start(...)` maps that public name to a JavaScript function:

```javascript
methods: {
    SetSpeed: setSpeed,
    StopAnimation: stopAnimation
}
```

Method code should use the same validation and state-change path as operator
input. For example, `SetSpeed` writes the `TrackSpeed` property and then calls
the normal refresh logic. Avoid maintaining a hidden “method value” that can
disagree with the public property.

Methods do not need a separate event listener in `index.html`; WebCC invokes
the registered function.

## Events: the control notifies Unified

Events travel in the other direction. First declare an event in the manifest,
then list it in the runtime contract, and finally fire it:

```javascript
WebCC.Events.fire('StateChanged', JSON.stringify({
    value: currentValue,
    reason: 'operator',
    timestamp: Date.now()
}));
```

The number, order, and primitive types of arguments must match the manifest.
This repository often declares a single string argument named `payload` and
uses JSON inside it. That pattern is useful when one event needs structured
context without a large manifest type:

```json
{
  "events": {
    "StateChanged": {
      "arguments": {
        "payload": { "type": "string" }
      }
    }
  }
}
```

The Gauge demonstrates a direct numeric argument instead:

```javascript
WebCC.Events.fire('ZoneChanged', newZoneIndex);
```

Use property writes for durable current state and events for occurrences. For
example, `JoyActive` records whether the joystick is currently active, while
`JoystickReleased` records that a release occurred.

## From a property to a visual change

The side-view track has a clear end-to-end path:

```text
PLC tag / screen script
    -> Unified changes TrackSpeed
    -> WebCC.onPropertyChanged receives { key: "TrackSpeed", value: ... }
    -> setProperty(...) calls refresh(...)
    -> readConfig() clamps and normalizes the value
    -> syncAnimationLoop() starts or stops requestAnimationFrame
    -> renderMotion() moves SVG treads and wheels
    -> publishState() fires TrackStateChanged when state changes
```

This is a good structure to reproduce:

- one boundary function reads and normalizes public properties;
- rendering functions accept trusted, normalized values;
- a single refresh path is used for initial state, property changes, methods,
  and resize handling; and
- events are published only when their meaningful state changes.

## Internal state versus public properties

Not every value belongs in the manifest. Animation frame IDs, cached DOM
elements, pointer IDs, geometry, and temporary form state are internal.
Values that an HMI engineer needs to bind, configure, observe, or command are
public contract members.

Examples:

- `TrackSpeed` is public; the current SVG path offset is internal.
- `JoyX` is public; the captured browser `pointerId` is internal.
- A serialized configuration property can be public; lookup maps and render
  fragments remain internal.

Use a public property as the source of truth when the value must remain visible
to Unified. Keep high-frequency visual details internal to avoid unnecessary
traffic through the Runtime bridge.

## Unified colors

The examples expose color properties as a custom manifest type:

```json
"Color": {
  "$id": "http://tia.siemens.com/wincc-unified/types/s/color",
  "type": "number"
}
```

The value is an unsigned 32-bit ARGB number (`0xAARRGGBB`), while CSS expects
an `rgba(...)` string. The controls convert it at the boundary:

```javascript
function toColor(value, fallback) {
    let number = Number.isFinite(Number(value)) ? Number(value) : fallback;
    number >>>= 0;

    const blue = number & 0xFF;
    const green = (number & 0xFF00) >>> 8;
    const red = (number & 0xFF0000) >>> 16;
    const alpha = ((number & 0xFF000000) >>> 24) / 255;

    return 'rgba(' + [red, green, blue, alpha].join(',') + ')';
}
```

For an opaque CSS color such as `#3B4657`, prefix `FF` to get ARGB
`0xFF3B4657`. The manifest stores the equivalent unsigned decimal value.

## Resizing and lifecycle

The Unified container decides the actual control dimensions. Avoid fixed page
sizes and global assumptions about the viewport. Use:

- flexbox or grid;
- SVG `viewBox` and `preserveAspectRatio`;
- `getBoundingClientRect()` for interaction geometry; and
- a `resize` handler when JavaScript-calculated dimensions are required.

Animation should stop when the document is hidden. Safety-related input should
also return to a safe state on pointer cancellation, lost pointer capture,
window blur, or document hiding. The joystick demonstrates all of these.

For a complex control, retain handler references and remove them during
`pagehide`/`beforeunload`. Cancel animation frames and timers when they are no
longer required.
