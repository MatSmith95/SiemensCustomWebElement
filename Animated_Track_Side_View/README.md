# Animated Track Side View

Responsive side-view tracked-vehicle animation for Siemens WinCC Unified.

## Main properties

- `TrackSpeed`: signed motion input; positive is forward and negative is reverse.
- `MaxSpeed`: input magnitude represented by full visual speed.
- `AnimationScale`: visual speed multiplier.
- `Enabled`: enables or pauses animation.
- `ReverseDirection`: flips the displayed direction for a left-facing vehicle.
- `TreadCount`: number of tread plates, clamped from 12 to 72.
- `ShowValues`: status display option.
- `Alarm`: enables alarm highlighting.
- Siemens color properties for the background, belt, treads, wheels, hubs,
  status accent and alarm.

## Colour mapping

All mechanical colours are exposed as Siemens `Color` properties, so they can
be changed in TIA Portal without editing `code.js`.

| Property | Visual part | Current ARGB / RGB |
| --- | --- | --- |
| `BackgroundColor` | Control background | `0x00000000` / transparent |
| `TrackColor` | Continuous inset belt | `0xFF202938` / `#202938` |
| `TreadColor` | Moving tread pads/studs | `0xFF3B4657` / `#3B4657` |
| `WheelColor` | Sprocket rim and outer edge | `0xFF4B5563` / `#4B5563` |
| `WheelInnerColor` | Dark inner sprocket body | `0xFF18202C` / `#18202C` |
| `HubColor` | Sprocket spokes and centre hub | `0xFF94A3B8` / `#94A3B8` |
| `AccentColor` | Moving indicator in the status panel | `0xFF38BDF8` / `#38BDF8` |
| `AlarmColor` | Alarm badge and highlight | `0xFFEF4444` / `#EF4444` |

The manifest stores Siemens colours as unsigned decimal ARGB values. If the
mechanical drawings provide RGB hex colours, prepend `FF` for full opacity and
convert the resulting ARGB number to decimal. For example, `#3B4657` becomes
`0xFF3B4657`, which is `4282074711`.

For local preview, RGB values can be tested directly from the browser console:

```javascript
WebCC._mock.setProperties({
  TrackColor: 0xFF202938,
  TreadColor: 0xFF3B4657,
  WheelColor: 0xFF4B5563,
  WheelInnerColor: 0xFF18202C,
  HubColor: 0xFF94A3B8
})
```

## Methods

- `SetSpeed(speed)`
- `StopAnimation()`
- `SetEnabled(enabled)`

## Event

`TrackStateChanged(payload)` sends a JSON string containing the current speed,
motion state, direction, enabled state, reversal setting, alarm state and reason.

## Local preview

From the repository root:

```bash
open "$PWD/Animated_Track_Side_View/control/index.html"
```

Example developer-console commands:

```javascript
WebCC._mock.setProperty('TrackSpeed', 75)
WebCC._mock.setProperty('TrackSpeed', -40)
WebCC._mock.setProperty('ReverseDirection', true)
WebCC._mock.setProperty('Alarm', true)
WebCC._mock.setProperty('TreadCount', 52)
WebCC._mock.callMethod('StopAnimation')
WebCC._mock.events
```
