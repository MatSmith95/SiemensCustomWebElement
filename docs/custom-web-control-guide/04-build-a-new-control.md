# 4. Build a New Control

This tutorial builds a small `Tank_Level` control. It displays a vertical fill,
accepts a level and alarm threshold from Unified, exposes a method to set the
level, and fires an event when the alarm state changes.

The example is intentionally plain HTML/CSS/JavaScript so the WebCC connection
is easy to see.

## Step 1: define the public interface first

Write down what the HMI needs before drawing the UI:

| Member | Kind | Direction | Purpose |
| --- | --- | --- | --- |
| `Level` | number property | Input/bidirectional | Current level from 0 to 100 |
| `AlarmLimit` | number property | Input | Level at which alarm becomes active |
| `Enabled` | boolean property | Input | Enables visual updates |
| `FillColor` | Unified Color property | Input | Normal fill color |
| `AlarmColor` | Unified Color property | Input | Alarm fill color |
| `AlarmActive` | boolean property | Output | Current calculated alarm state |
| `SetLevel(value)` | method | Unified to control | Set `Level` from a screen script |
| `AlarmChanged(payload)` | event | Control to Unified | Notify when alarm changes |

Deciding ownership now prevents an ambiguous implementation later.

## Step 2: create the folder

Copy only the reusable scaffolding, not another control's application code:

```text
Tank_Level/
├── manifest.json
├── CWC_manifest_Schema.json
├── assets/
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

The schema, WebCC bridge, type declaration, and mock can be copied from one of
the current controls. Generate a new GUID with `uuidgen`; never reuse the GUID
of the copied control.

## Step 3: create the manifest

Replace `YOUR-NEW-GUID` below with the generated UUID:

```json
{
  "$schema": "./CWC_manifest_Schema.json",
  "mver": "1.2.0",
  "control": {
    "identity": {
      "name": "TankLevel",
      "version": "1.0",
      "displayname": "Tank Level",
      "icon": "./assets/logo.svg",
      "type": "guid://YOUR-NEW-GUID",
      "start": "./control/index.html"
    },
    "environment": {
      "prerequisites": {
        "renderingspace": {
          "minwidth": 120,
          "minheight": 180,
          "defaultwidth": 240,
          "defaultheight": 360,
          "units": "px"
        }
      }
    },
    "metadata": {
      "author": "Your name",
      "description": "Responsive tank level indicator.",
      "keywords": [
        "Tank",
        "Level",
        "WinCCUnified",
        "CustomWebControl"
      ]
    },
    "contracts": {
      "api": {
        "methods": {
          "SetLevel": {
            "parameters": {
              "value": {
                "type": "number"
              }
            },
            "description": "Set the displayed tank level."
          }
        },
        "events": {
          "AlarmChanged": {
            "arguments": {
              "payload": {
                "type": "string"
              }
            },
            "description": "Fired when the calculated alarm state changes."
          }
        },
        "properties": {
          "Level": {
            "type": "number",
            "default": 0,
            "description": "Tank level from 0 to 100."
          },
          "AlarmLimit": {
            "type": "number",
            "default": 80,
            "description": "Level at which the alarm becomes active."
          },
          "Enabled": {
            "type": "boolean",
            "default": true,
            "description": "Enable visual updates."
          },
          "FillColor": {
            "$ref": "#/control/types/Color",
            "default": 4281908728,
            "description": "Normal fill color."
          },
          "AlarmColor": {
            "$ref": "#/control/types/Color",
            "default": 4293870660,
            "description": "Alarm fill color."
          },
          "AlarmActive": {
            "type": "boolean",
            "default": false,
            "description": "True when Level is at or above AlarmLimit."
          }
        }
      }
    },
    "types": {
      "Color": {
        "$id": "http://tia.siemens.com/wincc-unified/types/s/color",
        "type": "number"
      }
    }
  }
}
```

After saving it, check that it is valid JSON:

```bash
node -e "JSON.parse(require('fs').readFileSync('Tank_Level/manifest.json'))"
```

## Step 4: create the HTML

`control/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tank Level</title>

    <link rel="stylesheet" href="./styles.css">
    <script src="./js/webcc.mock.js"></script>
    <script src="./js/webcc.min.js"></script>
</head>
<body>
    <main id="tankApp" class="tank-app">
        <div class="tank" role="meter" aria-label="Tank level"
             aria-valuemin="0" aria-valuemax="100">
            <div id="tankFill" class="tank-fill"></div>
            <span id="levelText" class="level-text">0%</span>
        </div>
    </main>

    <script src="./code.js"></script>
</body>
</html>
```

The application script is last so the elements it queries already exist.

## Step 5: make the visual responsive

`control/styles.css`:

```css
:root {
    --fill-color: #38bdf8;
    --alarm-color: #ef4444;
}

* {
    box-sizing: border-box;
}

html,
body {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
}

body {
    font-family: "Siemens Sans", Arial, sans-serif;
}

.tank-app {
    display: grid;
    width: 100%;
    height: 100%;
    padding: 8%;
    place-items: center;
}

.tank {
    position: relative;
    width: min(70%, 220px);
    height: 100%;
    min-height: 120px;
    overflow: hidden;
    border: max(2px, 0.02em) solid #64748b;
    border-radius: 12px 12px 24px 24px;
    background: #111827;
}

.tank-fill {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 0%;
    background: var(--fill-color);
    transition: height 180ms linear, background-color 180ms linear;
}

.tank.alarm .tank-fill {
    background: var(--alarm-color);
}

.level-text {
    position: absolute;
    inset: 0;
    display: grid;
    color: white;
    font-size: clamp(18px, 10vmin, 48px);
    font-weight: 700;
    place-items: center;
    text-shadow: 0 1px 3px #000;
}

.tank-app.disabled {
    opacity: 0.45;
}
```

The root fills its container, the control does not scroll, and text/geometry
scale without assuming the engineering default size.

## Step 6: implement one state and render path

`control/code.js`:

```javascript
(function () {
    'use strict';

    const DEFAULTS = {
        Level: 0,
        AlarmLimit: 80,
        Enabled: true,
        FillColor: 4281908728,
        AlarmColor: 4293870660,
        AlarmActive: false
    };

    const state = {
        previousAlarm: null
    };

    const elements = {};

    function clamp(value, minimum, maximum) {
        return Math.min(Math.max(value, minimum), maximum);
    }

    function toNumber(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function toBoolean(value, fallback) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true' || normalized === '1') return true;
            if (normalized === 'false' || normalized === '0') return false;
        }
        return fallback;
    }

    function toColor(value, fallback) {
        let number = toNumber(value, fallback);
        number >>>= 0;

        const blue = number & 0xFF;
        const green = (number & 0xFF00) >>> 8;
        const red = (number & 0xFF0000) >>> 16;
        const alpha = ((number & 0xFF000000) >>> 24) / 255;
        return 'rgba(' + [red, green, blue, alpha].join(',') + ')';
    }

    function readProperty(name) {
        if (window.WebCC && WebCC.Properties && name in WebCC.Properties) {
            return WebCC.Properties[name];
        }
        return DEFAULTS[name];
    }

    function readConfig() {
        return {
            level: clamp(toNumber(readProperty('Level'), DEFAULTS.Level), 0, 100),
            alarmLimit: clamp(
                toNumber(readProperty('AlarmLimit'), DEFAULTS.AlarmLimit),
                0,
                100
            ),
            enabled: toBoolean(readProperty('Enabled'), DEFAULTS.Enabled)
        };
    }

    function publishAlarm(active, reason) {
        WebCC.Properties.AlarmActive = active;

        if (active === state.previousAlarm) return;
        state.previousAlarm = active;
        WebCC.Events.fire('AlarmChanged', JSON.stringify({
            active: active,
            reason: reason,
            timestamp: Date.now()
        }));
    }

    function refresh(reason) {
        const config = readConfig();
        const alarm = config.level >= config.alarmLimit;

        elements.fill.style.height = config.level + '%';
        elements.text.textContent = Math.round(config.level) + '%';
        elements.tank.classList.toggle('alarm', alarm);
        elements.app.classList.toggle('disabled', !config.enabled);
        elements.tank.setAttribute('aria-valuenow', String(config.level));

        document.documentElement.style.setProperty(
            '--fill-color',
            toColor(readProperty('FillColor'), DEFAULTS.FillColor)
        );
        document.documentElement.style.setProperty(
            '--alarm-color',
            toColor(readProperty('AlarmColor'), DEFAULTS.AlarmColor)
        );

        publishAlarm(alarm, reason);
    }

    function propertyChanged(change) {
        if (!change || !change.key) return;
        refresh('property:' + change.key);
    }

    function setLevel(value) {
        WebCC.Properties.Level = clamp(toNumber(value, 0), 0, 100);
        refresh('method:SetLevel');
    }

    function initialize() {
        elements.app = document.getElementById('tankApp');
        elements.tank = document.querySelector('.tank');
        elements.fill = document.getElementById('tankFill');
        elements.text = document.getElementById('levelText');

        refresh('init');
        WebCC.onPropertyChanged.subscribe(propertyChanged);
    }

    WebCC.start(
        function (result) {
            if (result) {
                initialize();
            } else {
                console.error('Tank Level failed to connect to WebCC.');
            }
        },
        {
            methods: {
                SetLevel: setLevel
            },
            events: ['AlarmChanged'],
            properties: Object.assign({}, DEFAULTS)
        },
        [],
        10000
    );
})();
```

Notice the important structure:

- defaults and the runtime contract have one JavaScript source;
- all incoming values are normalized;
- initial state and later changes use the same `refresh()` function;
- the method updates the public property, then uses the same render path;
- `AlarmActive` stores current state;
- `AlarmChanged` fires only on an actual transition; and
- the manifest names match the JavaScript names exactly.

For production process alarms, decide alarm truth and acknowledgement in the
PLC/SCADA alarm system. This browser example calculates a visual/status value;
it should not replace safety or alarm logic in the controller.

## Step 7: preview with the mock

Serve the repository root:

```bash
python3 -m http.server 8080
```

Open:

```text
http://localhost:8080/Tank_Level/control/index.html?mock
```

In the browser console:

```javascript
WebCC._mock.setProperty('Level', 50)
WebCC._mock.setProperty('AlarmLimit', 70)
WebCC._mock.setProperty('Level', 85)
WebCC._mock.callMethod('SetLevel', 25)
WebCC._mock.snapshot()
```

Check that:

- the fill follows the level;
- invalid and out-of-range numbers are clamped;
- the alarm changes at the threshold;
- `AlarmActive` appears in property writes;
- `AlarmChanged` fires only when alarm state changes;
- resizing the browser does not create scrollbars or clipped content; and
- no errors appear in the console.

## Step 8: add a package script

Use the script template in
[Packaging and importing](06-packaging-and-importing.md). Include every file
referenced by the manifest or HTML. Run the script, inspect the ZIP, and then
test the imported control in Unified Runtime.
