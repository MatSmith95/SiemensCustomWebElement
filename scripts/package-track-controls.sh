#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd)"

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

package_control() {
    local control_directory="$1"
    local guid="$2"
    local archive_name="{${guid}}.zip"

    (
        cd -- "${REPOSITORY_ROOT}/${control_directory}"

        node --check control/code.js
        node - "${guid}" <<'NODE'
const fs = require('fs');
const expectedGuid = `guid://${process.argv[2]}`;
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const actualGuid = manifest.control.identity.type;

if (actualGuid !== expectedGuid) {
    throw new Error(`Manifest GUID ${actualGuid} does not match ${expectedGuid}.`);
}
NODE

        zip -FS "${archive_name}" "${PACKAGE_FILES[@]}" >/dev/null
        unzip -t "${archive_name}"

        for package_file in "${PACKAGE_FILES[@]}"; do
            unzip -p "${archive_name}" "${package_file}" | cmp - "${package_file}"
        done
    )
}

package_control \
    "Animated_Track_Side_View" \
    "EA1E9FA4-1404-4ADA-A8F1-7C2D6DACBFA8"

package_control \
    "Animated_Track_Top_View" \
    "897B2819-0786-452E-B639-DB45EFFB90F8"

echo "Animated track packages rebuilt and verified."
