# Datapath Wall Control

Datapath Wall Control is a Siemens WinCC Unified Custom Web Control for the
standard Datapath video wall operator workflow.

The control does not communicate with Datapath directly. It can read and write
JSON files from the configured `JsonFolderPath` when WinCC exposes file access
inside the Custom Web Control. If that API is not available, use the JSON string
properties as a Siemens HMI script bridge.

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
| `WallConfigJson` | string | Optional `wall-config.json` content from an HMI script bridge. |
| `DatapathInputsJson` | string | Optional `datapath-inputs.json` content from an HMI script bridge. |
| `DatapathStateJson` | string | Optional `datapath-state.json` content from an HMI script bridge. |
| `CommandResultJson` | string | Optional `command-result.json` content from an HMI script bridge. |
| `EditPermit` | boolean | Shows the Configuration Studio pencil button. |
| `Enabled` | boolean | Enables source switching. |
| `RefreshIntervalMs` | number | Poll interval for JSON state files. |
| `SelectedSourceId` | string | Currently selected source. |
| `SelectedTargetId` | string | Last selected wall target. |
| `SelectedLayoutId` | string | Last selected layout. |
| `PendingCommandJson` | string | Last command payload. |
| `CommandSequence` | number | Increments after every command. |
| `PendingWallConfigJson` | string | Latest `wall-config.json` save request from Configuration Studio. |
| `WallConfigSequence` | number | Increments after every wall config save request. |
| `PendingInputsJson` | string | Latest `datapath-inputs.json` save request from Configuration Studio. |
| `InputsSequence` | number | Increments after every inputs save request. |
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

## HMI Script Bridge Mode

If the on-screen diagnostic says `HMIRuntime.FileSystem is not available`, the
custom web control cannot access Windows files directly. In that case:

- Siemens HMI script reads `wall-config.json` and writes the text into
  `WallConfigJson`.
- Siemens HMI script reads `datapath-inputs.json` and writes the text into
  `DatapathInputsJson`.
- Siemens HMI script reads `datapath-state.json` and writes the text into
  `DatapathStateJson`.
- Siemens HMI script reads `command-result.json` and writes the text into
  `CommandResultJson`.
- Siemens HMI script watches `CommandSequence`; when it increments, write
  `PendingCommandJson` to `pending-command.json`.
- For Configuration Studio saves, watch `WallConfigSequence` and
  `InputsSequence`, then write `PendingWallConfigJson` or `PendingInputsJson`
  back to the matching JSON file.

## Package

Run:

```bash
./package.sh
```

The Siemens import package is:

```text
{54F807D6-B8B8-4932-979D-598BE46E6A03}.zip
```
