# Siemens Unified custom web controls

This repository contains browser-based controls for Siemens WinCC Unified:

- `Analog_Joystick`
- `Animated_Track_Side_View`
- `Animated_Track_Top_View`
- `Gauge`

## Local mock mode

The controls normally wait for the Siemens Unified container to initialize
`WebCC`. Mock mode starts automatically when a control is opened as a top-level
local `file://` page. For pages served over HTTP, add `?mock` to the URL.
Inside a Unified iframe/container the mock does nothing and Siemens'
`webcc.min.js` remains responsible for the real Runtime connection.

For a quick panel-compatible smoke test, open the control directly:

```bash
cd /path/to/SiemensCustomWebElement
open "$PWD/Analog_Joystick/control/index.html"
open "$PWD/Animated_Track_Side_View/control/index.html"
open "$PWD/Animated_Track_Top_View/control/index.html"
open "$PWD/Gauge/control/index.html"
```

For normal browser development, start a local server from the repository root:

```bash
python3 -m http.server 8080
```

Then open:

- <http://localhost:8080/Analog_Joystick/control/index.html?mock>
- <http://localhost:8080/Animated_Track_Side_View/control/index.html?mock>
- <http://localhost:8080/Animated_Track_Top_View/control/index.html?mock>
- <http://localhost:8080/Gauge/control/index.html?mock>

### Mock commands

Open the browser developer console and run:

```javascript
WebCC._mock.help()
WebCC._mock.snapshot()
```

Simulate property updates arriving from Unified:

```javascript
WebCC._mock.setProperty('Enabled', false)
WebCC._mock.setProperty('AxisMode', 'X_ONLY')
WebCC._mock.setProperties({ Deadband: 10, MaxOutput: 80 })

WebCC._mock.setProperty('GaugeValue', 45)
```

Call methods that would normally be invoked by a Unified screen script:

```javascript
WebCC._mock.callMethod('ResetJoystick')
WebCC._mock.callMethod('SetEnabled', true)

WebCC._mock.callMethod('BlinkZone', 2)
```

Inspect output from the control:

```javascript
WebCC.Properties
WebCC._mock.propertyWrites
WebCC._mock.events
```

Clear the captured history between test cases:

```javascript
WebCC._mock.clearLogs()
```

Mock mode tests the control's HTML, CSS, JavaScript, properties, methods and
events. A final test in WinCC Unified Runtime is still required to validate the
real container handshake, tag bindings, TIA Portal import and panel behaviour.
