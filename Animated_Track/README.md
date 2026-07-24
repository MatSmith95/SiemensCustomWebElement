# MS Animated Track

Responsive side-view tracked-vehicle animation for Siemens WinCC Unified.

## Main properties

- `TrackSpeed`: signed motion input; positive is forward and negative is reverse.
- `MaxSpeed`: input magnitude represented by full visual speed.
- `AnimationScale`: visual speed multiplier.
- `Enabled`: enables or pauses animation.
- `ReverseDirection`: flips the displayed direction for a left-facing vehicle.
- `TreadCount`: number of tread plates, clamped from 12 to 72.
- `ShowValues` and `ShowDirection`: status display options.
- `Alarm`: enables alarm highlighting.
- Siemens color properties for the background, track, treads, wheels, hubs,
  direction accent and alarm.

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
open "$PWD/Animated_Track/control/index.html"
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
