#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
OUTPUT="${ROOT}/dist/alfred-ttt.alfredworkflow"
STAGING="$(mktemp -d)"
trap 'rm -rf "${STAGING}"' EXIT

/usr/bin/plutil -lint "${ROOT}/workflow/info.plist" >/dev/null
mkdir -p "${STAGING}/bin" "${STAGING}/src" "${ROOT}/dist"
xcrun swiftc -O "${ROOT}/native/rephrase.swift" -o "${STAGING}/bin/rephrase"
cp "${ROOT}/workflow/info.plist" "${STAGING}/info.plist"
cp "${ROOT}/bin/filter" "${ROOT}/bin/apply" "${ROOT}/bin/summary" "${STAGING}/bin/"
cp "${ROOT}"/src/*.mjs "${STAGING}/src/"
chmod 755 "${STAGING}/bin/filter" "${STAGING}/bin/apply" "${STAGING}/bin/summary"
rm -f "${OUTPUT}"
(
  cd "${STAGING}"
  /usr/bin/zip -qr "${OUTPUT}" info.plist bin src
)

printf 'Built %s\n' "${OUTPUT}"
