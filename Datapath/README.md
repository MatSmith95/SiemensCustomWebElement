# Datapath Wall Control

Datapath Wall Control is a Siemens WinCC Unified Custom Web Control for the
standard Datapath video wall operator workflow.

The control does not communicate with Datapath directly. It reads and writes
JSON files from the configured `JsonFolderPath`; the separate C# bridge owns
Datapath commands and responses.

## First Build Scope

- Display a configurable Datapath wall using `wall-config.json`.
- Load available inputs from `datapath-inputs.json`.
- Show live source assignments from `datapath-state.json`.
- Select a source, then select a blue wall zone to write `pending-command.json`.
- Show Configuration Studio when `EditPermit` is true.
- Edit `wall-config.json` and `datapath-inputs.json` in Configuration Studio.

## Runtime Properties

| Property | Type | Purpose |
| --- | --- | --- |
| `JsonFolderPath` | string | Folder containing the JSON files. |
| `EditPermit` | boolean | Shows the Configuration Studio pencil button. |
| `Enabled` | boolean | Enables source switching. |
| `RefreshIntervalMs` | number | Poll interval for JSON state files. |
| `SelectedSourceId` | string | Currently selected source. |
| `SelectedTargetId` | string | Last selected wall target. |
| `SelectedLayoutId` | string | Last selected layout. |
| `PendingCommandJson` | string | Last command payload. |
| `CommandSequence` | number | Increments after every command. |
| `StatusText` | string | Current control/file status. |

## JSON Files

Starter files are included in `json/`:

- `wall-config.json`
- `datapath-inputs.json`
- `datapath-state.json`
- `pending-command.json`
- `command-result.json`

Copy those files into the folder configured by `JsonFolderPath`.

## Operator Flow

1. Select a video source.
2. Select a blue wall zone.
3. The control writes `pending-command.json` immediately.
4. The C# bridge sends the command to Datapath.
5. The C# bridge updates `datapath-state.json` and `command-result.json`.

## Package

Run:

```bash
./package.sh
```

The Siemens import package is:

```text
{54F807D6-B8B8-4932-979D-598BE46E6A03}.zip
```
