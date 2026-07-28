#!/usr/bin/env bash

set -euo pipefail

CONTROL_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GUID="54F807D6-B8B8-4932-979D-598BE46E6A03"
ARCHIVE_NAME="{${GUID}}.zip"

PACKAGE_FILES=(
    manifest.json
    CWC_manifest_Schema.json
    assets/logo.png
    assets/logo.svg
    control/index.html
    control/styles.css
    control/code.js
    control/webcc.d.ts
    control/js/webcc.mock.js
    control/js/webcc.min.js
    json/wall-config.json
    json/datapath-inputs.json
    json/datapath-state.json
    json/pending-command.json
    json/command-result.json
)

cd -- "${CONTROL_DIRECTORY}"

node --check control/code.js
node - "${GUID}" <<'NODE'
const fs = require('fs');
const expectedGuid = `guid://${process.argv[2]}`;
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const actualGuid = manifest.control.identity.type;

if (actualGuid !== expectedGuid) {
    throw new Error(`Manifest GUID ${actualGuid} does not match ${expectedGuid}.`);
}
NODE

python3 - "${ARCHIVE_NAME}" "${PACKAGE_FILES[@]}" <<'PY'
import sys
import zipfile

archive_name = sys.argv[1]
package_files = sys.argv[2:]

with zipfile.ZipFile(archive_name, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for package_file in package_files:
        archive.write(package_file, package_file)

with zipfile.ZipFile(archive_name, "r") as archive:
    bad_file = archive.testzip()
    if bad_file:
        raise SystemExit(f"Corrupt file in archive: {bad_file}")

    for package_file in package_files:
        with archive.open(package_file) as archived_file:
            archived_bytes = archived_file.read()
        with open(package_file, "rb") as source_file:
            source_bytes = source_file.read()
        if archived_bytes != source_bytes:
            raise SystemExit(f"Archive content mismatch: {package_file}")
PY

echo "Datapath package rebuilt and verified: ${ARCHIVE_NAME}"
