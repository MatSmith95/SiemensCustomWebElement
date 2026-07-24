# Animated Track Top View

Responsive single-track animation viewed from above for Siemens WinCC Unified.

## Siemens import package

Import
[`{897B2819-0786-452E-B639-DB45EFFB90F8}.zip`](./%7B897B2819-0786-452E-B639-DB45EFFB90F8%7D.zip)
as the Custom Web Control artifact. Its filename matches the GUID in
`manifest.json`.

After changing the source, rebuild and verify both animated-track packages from
the repository root:

```bash
./scripts/package-track-controls.sh
```

## Main properties

- `TrackSpeed`: signed track input; positive moves towards the top.
- `MaxSpeed`: input magnitude represented by full visual speed.
- `AnimationScale`: visual speed multiplier.
- `Enabled`: enables or pauses the animation.
- `ReverseDirection`: flips the displayed direction.
- `TreadCount`: visible pads, clamped from 8 to 36.
- `ShowValues`: optionally shows the speed value; hidden by default.
- `Alarm`: enables alarm highlighting.

## Methods

- `SetSpeed(speed)` sets the signed track speed.
- `StopAnimation()` sets the speed to zero.
- `SetEnabled(enabled)` enables or pauses the animation.

## Event

`TrackStateChanged(payload)` sends a JSON string with the track speed,
direction, motion state, enabled state, reversal setting, alarm state and change
reason.

## Colour mapping

| Property | Visual part | Current ARGB / RGB |
| --- | --- | --- |
| `BackgroundColor` | Control background | `0x00000000` / transparent |
| `TrackColor` | Continuous belt | `0xFF202938` / `#202938` |
| `TreadColor` | Moving pads/studs | `0xFF3B4657` / `#3B4657` |
| `AccentColor` | Moving indicator when values are shown | `0xFF38BDF8` / `#38BDF8` |
| `AlarmColor` | Alarm badge and highlight | `0xFFEF4444` / `#EF4444` |

## Local preview

From the repository root:

```bash
open "$PWD/Animated_Track_Top_View/control/index.html"
```

Example developer-console commands:

```javascript
WebCC._mock.setProperty('TrackSpeed', 70)
WebCC._mock.setProperty('TrackSpeed', -45)
WebCC._mock.setProperty('Alarm', true)
WebCC._mock.callMethod('StopAnimation')
WebCC._mock.events
```
