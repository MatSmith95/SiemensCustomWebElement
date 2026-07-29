# 3. Manifest and Contract Reference

## Manifest shape

All current controls use manifest version 1.2.0 and this top-level structure:

```json
{
  "$schema": "./CWC_manifest_Schema.json",
  "mver": "1.2.0",
  "control": {
    "identity": {},
    "environment": {},
    "metadata": {},
    "contracts": {
      "api": {
        "methods": {},
        "events": {},
        "properties": {}
      }
    },
    "types": {}
  }
}
```

JSON does not allow comments. Put explanations in each member's `description`
or in the control README.

## Identity

Example:

```json
"identity": {
  "name": "AnimatedTrackSideView",
  "version": "1.1",
  "displayname": "Animated Track Side View",
  "icon": "./assets/logo.png",
  "type": "guid://EA1E9FA4-1404-4ADA-A8F1-7C2D6DACBFA8",
  "start": "./control/index.html"
}
```

| Field | Purpose |
| --- | --- |
| `name` | Stable machine-readable control name |
| `version` | Control version shown to engineering tools/users |
| `displayname` | Friendly name shown in the engineering UI |
| `icon` | Package-relative icon path |
| `type` | Globally unique control identity in `guid://...` form |
| `start` | Package-relative HTML entry point |

For every genuinely new control, generate a new GUID. Do not copy an existing
GUID, because Unified uses it to identify the control type. The generated ZIP
must later be named `{GUID}.zip`, with braces but without the `guid://` prefix.

On macOS or Linux, `uuidgen` can generate the value:

```bash
uuidgen
```

Use that same value in:

- `control.identity.type`;
- the packaging script's `GUID` variable; and
- the import ZIP filename.

## Environment and rendering space

The environment section describes the expected control space:

```json
"environment": {
  "prerequisites": {
    "renderingspace": {
      "minwidth": 260,
      "minheight": 130,
      "defaultwidth": 640,
      "defaultheight": 260,
      "units": "px"
    }
  }
}
```

Choose defaults that show the intended aspect and minimums below which the UI
would no longer be operable. These are an engineering contract, not a reason
to hard-code the same width and height in CSS.

The included 1.2.0 schema names the field `units` (plural). Several existing
custom manifests in this repository currently use `unit` (singular), which a
strict check against the included schema will flag as an additional property.
Use `units` for new controls. Treat a change to an already deployed manifest
as a versioned change and confirm it with the TIA Portal version used by the
project.

The joystick also declares an HMI extension prerequisite:

```json
"extensions": {
  "HMI": {
    "mandatory": true,
    "version": "~1.0.0"
  }
}
```

Only declare extension requirements that the code actually needs, and list
additional extensions in the third argument to `WebCC.start(...)` when using
their APIs. See `control/webcc.d.ts` for the supplied API declarations.

## Metadata

Metadata helps humans find and understand the control:

```json
"metadata": {
  "author": "Example Author",
  "description": "Short description of the control.",
  "keywords": [
    "SCADA",
    "WinCCUnified",
    "CustomWebControl"
  ]
}
```

Use specific keywords for the device or operation, not only generic web terms.

## Properties

A simple property has a primitive type:

```json
"TrackSpeed": {
  "type": "number",
  "default": 0,
  "description": "Signed track speed."
}
```

Primitive property types used here are `number`, `boolean`, and `string`.
Defaults should have the declared type. Names are case-sensitive from the
manifest through JavaScript and into TIA Portal.

A property can reference a reusable type:

```json
"TrackColor": {
  "$ref": "#/control/types/Color",
  "default": 4280297784,
  "description": "Track color in Unified ARGB format."
}
```

Properties are technically available through the shared
`WebCC.Properties` object. The manifest schema used here does not separately
mark a property as input-only or output-only. Document intended ownership:

- configuration/input, such as `MaxSpeed`;
- status/output, such as `JoyFault`; or
- bidirectional, such as `TrackSpeed`, which can arrive from Unified and can
  also be changed by the track control's `SetSpeed` method.

Output ownership is a code convention. If control logic owns an output
property, its incoming handler should either ignore reflected changes or handle
them idempotently.

## Methods

Declare a parameterless method like this:

```json
"StopAnimation": {
  "description": "Set the track speed to zero."
}
```

Declare parameters by name and type:

```json
"SetEnabled": {
  "parameters": {
    "enabled": {
      "type": "boolean"
    }
  },
  "description": "Enable or pause animation."
}
```

The JavaScript function registered for the method receives the parameters in
manifest order. Normalize and validate them even though a type is declared.

## Events

A parameterless event:

```json
"JoystickReleased": {
  "description": "Fired when the joystick is released."
}
```

An event with one argument:

```json
"TrackStateChanged": {
  "arguments": {
    "payload": {
      "type": "string"
    }
  },
  "description": "Fired when the visual motion state changes."
}
```

Fire exactly the declared shape:

```javascript
WebCC.Events.fire('JoystickReleased');
WebCC.Events.fire('TrackStateChanged', JSON.stringify(payload));
```

Changing an event's argument order or type is a public API change. Treat
existing HMI event handlers as consumers of that API.

## Reusable and structured types

### Unified Color

```json
"types": {
  "Color": {
    "$id": "http://tia.siemens.com/wincc-unified/types/s/color",
    "type": "number"
  }
}
```

Reference it from a property with `"$ref": "#/control/types/Color"`.

### Enum

The Gauge defines vertical alignment as an enum:

```json
"VerticalAlignment": {
  "type": "string",
  "enum": ["Top", "Center", "Bottom"],
  "default": "Center"
}
```

The UI code still needs a fallback for an unknown string so an older/newer
project cannot leave the visual in an invalid state.

### Object

```json
"AlignmentPart": {
  "type": "object",
  "properties": {
    "Vertical": {
      "$ref": "#/control/types/VerticalAlignment"
    }
  }
}
```

### Array

```json
"Zones": {
  "type": "array",
  "items": {
    "$ref": "#/control/types/Zone"
  }
}
```

Structured manifest types give TIA Portal more knowledge of the data. A future
control with large versioned application data can instead use a string
property containing JSON. That reduces manifest complexity and makes
versioning explicit, but moves parsing and validation responsibility into
`code.js`.

## The duplication rule

Every manifest API member must be represented in `WebCC.start(...)`:

```javascript
const DEFAULTS = {
    TrackSpeed: 0,
    Enabled: true
};

WebCC.start(
    onConnected,
    {
        methods: {
            SetEnabled: setEnabled
        },
        events: ['TrackStateChanged'],
        properties: Object.assign({}, DEFAULTS)
    },
    [],
    10000
);
```

Use a single `DEFAULTS` object inside JavaScript so registration and fallback
reads cannot drift apart. When changing the contract, review all of these:

- the manifest declaration;
- the JavaScript default;
- the method registration or event list;
- the incoming property switch/refresh logic;
- any output writes or event fires;
- mock tests;
- the control README; and
- existing HMI bindings before making breaking changes.

## Contract naming guidance

Use names that describe HMI meaning rather than implementation:

- good property: `Alarm`, `CurrentValue`, `EditEnabled`;
- weak property: `redClass`, `internalValue2`, `buttonClicked`;
- good method: `ResetJoystick`, `ApplyLayout`;
- good event: `ZoneChanged`, `ConfigurationError`.

Properties describe state, methods describe commands, and events describe
occurrences. Keeping that distinction makes the control intuitive in TIA
Portal.
