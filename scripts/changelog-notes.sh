#!/usr/bin/env bash
set -euo pipefail

# Print the CHANGELOG.md section for one version, without its heading.
#
# Usage:
#   scripts/changelog-notes.sh <version>
#
# The section starts at `## [<version>]` and ends at the next `## ` heading or
# at the link references at the bottom of the file. The script exits 1 when the
# section is missing or empty, so a release without a changelog entry stops.

if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/changelog-notes.sh <version>" >&2
  exit 1
fi

VERSION="$1"
CHANGELOG="$(git rev-parse --show-toplevel)/CHANGELOG.md"

NOTES="$(awk -v heading="## [${VERSION}]" '
  index($0, heading) == 1 { found = 1; next }
  found && (/^## / || /^\[[^]]+\]: /) { exit }
  found { print }
' "$CHANGELOG" | sed '/./,$!d')"

if [ -z "${NOTES//[[:space:]]/}" ]; then
  echo "CHANGELOG.md has no entry for ${VERSION}. Add a \"## [${VERSION}] - <date>\" section first." >&2
  exit 1
fi

printf '%s\n' "$NOTES"
