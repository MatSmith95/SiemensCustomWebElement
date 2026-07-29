# 6. Packaging and Importing

## Package rules

A Siemens import artifact in this repository follows these rules:

1. It is a ZIP archive.
2. Its filename is the manifest GUID in braces, for example
   `{EA1E9FA4-1404-4ADA-A8F1-7C2D6DACBFA8}.zip`.
3. `manifest.json`, `CWC_manifest_Schema.json`, `assets/`, and `control/` are
   at the ZIP root.
4. The GUID in the filename exactly matches
   `control.identity.type` after removing the `guid://` prefix.
5. Every file referenced by the manifest, HTML, CSS, or JavaScript is present.
6. Development debris and old archives are not present.

Correct:

```text
{GUID}.zip
├── manifest.json
├── CWC_manifest_Schema.json
├── assets/
└── control/
```

Incorrect:

```text
{GUID}.zip
└── My_Control/
    ├── manifest.json
    └── ...
```

## Recommended packaging script

Create `package.sh` inside the new control folder:

```bash
#!/usr/bin/env bash

set -euo pipefail

CONTROL_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GUID="REPLACE-WITH-YOUR-GUID"
ARCHIVE_NAME="{${GUID}}.zip"

PACKAGE_FILES=(
    manifest.json
    CWC_manifest_Schema.json
    assets/logo.svg
    control/index.html
    control/styles.css
    control/code.js
    control/webcc.d.ts
    control/js/webcc.mock.js
    control/js/webcc.min.js
)

cd -- "${CONTROL_DIRECTORY}"

node --check control/code.js
node --check control/js/webcc.mock.js

node - "${GUID}" <<'NODE'
const fs = require('fs');
const expectedGuid = `guid://${process.argv[2]}`;
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const actualGuid = manifest.control.identity.type;

if (actualGuid !== expectedGuid) {
    throw new Error(
        `Manifest GUID ${actualGuid} does not match ${expectedGuid}.`
    );
}
NODE

for package_file in "${PACKAGE_FILES[@]}"; do
    if [[ ! -f "${package_file}" ]]; then
        echo "Missing package file: ${package_file}" >&2
        exit 1
    fi
done

zip -FS "${ARCHIVE_NAME}" "${PACKAGE_FILES[@]}" >/dev/null
unzip -t "${ARCHIVE_NAME}"

for package_file in "${PACKAGE_FILES[@]}"; do
    unzip -p "${ARCHIVE_NAME}" "${package_file}" | cmp - "${package_file}"
done

echo "Package rebuilt and verified: ${CONTROL_DIRECTORY}/${ARCHIVE_NAME}"
```

Make it executable and run it:

```bash
chmod +x My_Control/package.sh
./My_Control/package.sh
```

Add every new runtime asset or library to `PACKAGE_FILES`. If HTML loads
`./js/chart.min.js` but the allow-list omits it, local preview can work while
the imported control fails.

The mock is safe to package in the current repository design because it only
activates for explicit mock URLs or a top-level local file. Keeping it in the
artifact also ensures the HTML has no missing script. If a project chooses to
exclude development helpers, remove the mock `<script>` from the packaged HTML
as well.

## Inspect the archive

List it:

```bash
unzip -l "My_Control/{YOUR-GUID}.zip"
```

Test its structure and CRCs:

```bash
unzip -t "My_Control/{YOUR-GUID}.zip"
```

Inspect the packaged manifest without extracting:

```bash
unzip -p "My_Control/{YOUR-GUID}.zip" manifest.json
```

The repository scripts go one step further and compare each entry with its
source using `cmp`. This proves the ZIP was rebuilt after the latest edit.

## Existing packaging commands

From the repository root:

```bash
./scripts/package-track-controls.sh
```

This command rebuilds and verifies both animated track archives.

The Gauge archive under `109779176_Unified_Gauge_CWC_V1.4` is the supplied
reference package. The Joystick archives are existing snapshots. When adding
active development to either control, give it the same explicit, repeatable
packaging script pattern rather than editing a ZIP by hand.

## Import and engineering workflow

Exact menu names can vary between TIA Portal/WinCC Unified versions, but the
workflow is:

1. Run the packaging script.
2. In the project's Custom Web Control management/import area, select the
   GUID-named ZIP.
3. Resolve any manifest validation or version warning before continuing.
4. Place an instance of the imported control on a screen.
5. Check its default and minimum dimensions.
6. Configure static property values.
7. Bind dynamic properties to appropriate HMI/PLC tags.
8. Connect control events to screen/project logic where required.
9. Call exposed methods from screen logic and confirm parameters.
10. Compile the project and run it in Unified Runtime.
11. Repeat the test on the actual target panel or workstation.

Document the intended direction and units of every public property for the HMI
engineer. A technically valid property called `Speed` is still dangerous if
one programmer assumes rpm and another assumes percent.

## Updating versus creating a control

For a compatible update to an existing control:

- retain its GUID;
- increment `control.identity.version`;
- keep existing property/method/event names and types where practical;
- give new properties safe defaults; and
- test a project configured with the previous version.

For a new and incompatible control type, use a new GUID. Removing or renaming
an API member can break existing screen bindings and scripts even if the
visual control still loads.

Keep the source and generated ZIP in a reviewable relationship. A version bump
without rebuilding the ZIP, or a rebuilt ZIP from uncommitted/outdated source,
is a common source of confusing import results.

## Release checklist

- [ ] New controls use a unique GUID.
- [ ] Manifest and `WebCC.start(...)` contracts match.
- [ ] The version is correct.
- [ ] JavaScript syntax checks pass.
- [ ] Manifest JSON parses and conforms to the included schema.
- [ ] All relative paths work from `control/index.html`.
- [ ] Every referenced runtime file is in `PACKAGE_FILES`.
- [ ] The archive filename matches the manifest GUID.
- [ ] Package entries are at the ZIP root.
- [ ] `unzip -t` passes.
- [ ] Packaged entries match current source.
- [ ] Mock tests pass.
- [ ] TIA import and project compilation pass.
- [ ] Bindings, methods, and events work in Unified Runtime.
- [ ] The actual target device and supported sizes have been tested.
