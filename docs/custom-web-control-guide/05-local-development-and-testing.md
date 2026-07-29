# 5. Local Development and Testing

## Why a mock is needed

An ordinary browser does not have the WinCC Unified container around it, so
the real WebCC bridge cannot complete its normal handshake. Each current
control loads `control/js/webcc.mock.js` before `webcc.min.js`.

The mock activates only when:

- the page is opened as a top-level local `file://` page; or
- the URL contains `?mock`; or
- the URL hash is `#mock`.

It does not activate in an embedded Unified page unless explicitly requested.
It also refuses to overwrite an existing `window.WebCC`.

## Start a local server

From the repository root:

```bash
python3 -m http.server 8080
```

Then open a control with `?mock`, for example:

```text
http://localhost:8080/Analog_Joystick/control/index.html?mock
http://localhost:8080/Animated_Track_Side_View/control/index.html?mock
http://localhost:8080/Animated_Track_Top_View/control/index.html?mock
http://localhost:8080/Gauge/control/index.html?mock
```

Serving over HTTP is preferable when testing relative asset paths and browser
behavior close to an embedded application. Opening `index.html` directly also
works for the current controls:

```bash
open "$PWD/Analog_Joystick/control/index.html"
```

## Mock console commands

Start by listing the available helpers:

```javascript
WebCC._mock.help()
```

### Simulate a property change from Unified

```javascript
WebCC._mock.setProperty('Enabled', false)
WebCC._mock.setProperty('TrackSpeed', 75)
WebCC._mock.setProperty('GaugeValue', 45)
```

Change several properties:

```javascript
WebCC._mock.setProperties({
    TrackSpeed: -40,
    ReverseDirection: true,
    Alarm: true
})
```

These calls notify subscribers with the same `{ key, value }` shape used by
the controls.

### Call a registered method

```javascript
WebCC._mock.callMethod('StopAnimation')
WebCC._mock.callMethod('SetEnabled', true)
WebCC._mock.callMethod('BlinkZone', 2)
```

An unknown method throws an error, which quickly reveals a manifest/runtime
name mismatch or a missing registration.

### Inspect control output

```javascript
WebCC.Properties
WebCC._mock.propertyWrites
WebCC._mock.events
WebCC._mock.snapshot()
```

The property-write log records whether the source was the mock container or the
control. The event log records the event name and argument array.

Clear logs between test scenarios:

```javascript
WebCC._mock.clearLogs()
```

## Minimum command-line checks

Run a JavaScript syntax check:

```bash
node --check My_Control/control/code.js
node --check My_Control/control/js/webcc.mock.js
```

Parse the manifest:

```bash
node -e "JSON.parse(require('fs').readFileSync('My_Control/manifest.json'))"
```

Find every local file referenced by HTML and confirm it is going to be
packaged. Browser developer tools should show no 404 responses.

For a current control, useful repository searches are:

```bash
rg -n "WebCC.start|onPropertyChanged|Events.fire|WebCC.Properties" My_Control
rg -n '"methods"|"events"|"properties"' My_Control/manifest.json
```

Compare the names found in the manifest with:

- keys in `DEFAULTS` or the runtime `properties` object;
- method keys passed to `WebCC.start(...)`;
- the runtime event array;
- property-change `switch` cases;
- `WebCC.Properties` reads/writes; and
- `WebCC.Events.fire(...)` calls.

## A practical test matrix

Every control should be exercised in these categories:

| Area | Tests |
| --- | --- |
| Startup | Default values render; no console error; connection failure logs a useful error |
| Properties | Each property changes independently; zero, false, and empty string are not mistaken for missing values |
| Validation | NaN, negative values, excessive values, unknown enums, malformed JSON, and missing fields fail safely |
| Methods | Each declared method works with normal and invalid arguments |
| Events | Correct name, argument count/type, transition timing, and payload data |
| Output properties | Operator action writes the expected values and safe/rest values |
| Input | Mouse, touch/pointer movement, cancellation, repeated input, disabled state |
| Layout | Minimum size, default size, larger size, unusual aspect ratios, high DPI |
| Lifecycle | Page hide, blur, resize, lost pointer capture, animation/timer stop |
| Performance | No event/property flood, runaway timer, repeated listener registration, or unnecessary DOM rebuild |
| Packaging | No missing assets; archive root is correct; ZIP filename and manifest GUID agree |
| Unified | TIA import, tag binding, screen scripts, events, Runtime behavior, target panel |

## Testing property feedback

A property written by the control may be reflected back through
`onPropertyChanged` by the real container. For a simple idempotent render this
is usually harmless. For a stateful editor it can create duplicate actions,
events, or loops.

A stateful control can record a short-lived signature before writing:

```javascript
state.pendingWrites[name] = {
    signature: valueSignature(value),
    expires: Date.now() + 1500
};
WebCC.Properties[name] = value;
```

Its incoming handler consumes a matching reflected value:

```javascript
if (isOwnPropertyEcho(data.key, data.value)) return;
```

Use this pattern when processing an incoming value has side effects beyond
simply redrawing it. Do not suppress every equal value forever: an external
source can legitimately write the same value later.

## Headless smoke testing

The repository does not currently include an automated browser suite, but a
complex new control is a good candidate for one. A headless smoke test can:

- start a temporary local HTTP server;
- launch Chrome/Chromium using the project's chosen browser test tool;
- use the WebCC mock to load properties and call methods;
- click real DOM elements;
- check output properties, events, validation, and reset behavior; and
- compare registered mock properties with the manifest declaration.

Keep mock-facing tests focused on public behavior: property input, operator
input, method calls, property output, and events. Document and pin any added
test dependency so another programmer can reproduce the run.

## What the mock cannot validate

Always finish with a real Unified test. The mock does not fully emulate:

- TIA Portal manifest import and engineering UI;
- tag binding and tag quality;
- the exact Runtime property-reflection timing;
- design mode;
- HMI, Formatting, or Dialog extension behavior;
- Runtime language/style changes;
- user permissions, monitor mode, or explicit unlock behavior;
- target panel browser/version/performance limits;
- certificate, deployment, or project compilation issues; or
- process safety.

Use the mock to shorten the browser development loop, not to certify the
control for operation.
