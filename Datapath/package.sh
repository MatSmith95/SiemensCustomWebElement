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
)

cd -- "${CONTROL_DIRECTORY}"

node --check control/code.js
node --check tests/headless-smoke.mjs
node - "${GUID}" <<'NODE'
const fs = require('fs');
const expectedGuid = `guid://${process.argv[2]}`;
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

if (manifest.control.identity.type !== expectedGuid) {
    throw new Error(`Manifest GUID ${manifest.control.identity.type} does not match ${expectedGuid}.`);
}
NODE

zip -FS "${ARCHIVE_NAME}" "${PACKAGE_FILES[@]}" >/dev/null
unzip -t "${ARCHIVE_NAME}"

for package_file in "${PACKAGE_FILES[@]}"; do
    unzip -p "${ARCHIVE_NAME}" "${package_file}" | cmp - "${package_file}"
done

echo "Datapath package rebuilt and verified: ${CONTROL_DIRECTORY}/${ARCHIVE_NAME}"
