#!/usr/bin/env bash
# Cut a release: bumps package.json, updates CHANGELOG.md heading, commits, tags,
# and pushes. The push of the v* tag triggers .github/workflows/release.yml,
# which builds multi-arch and publishes to Docker Hub.
#
# Usage:
#   scripts/release.sh <patch|minor|major|x.y.z>
#
# Examples:
#   scripts/release.sh patch     # 0.1.0 -> 0.1.1
#   scripts/release.sh minor     # 0.1.0 -> 0.2.0
#   scripts/release.sh 1.0.0     # explicit version

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <patch|minor|major|x.y.z>" >&2
  exit 2
fi

# Refuse to run on a dirty tree — releases must be reproducible from origin/main.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty. Commit or stash first." >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "main" ]]; then
  echo "error: releases must be cut from main (currently on $branch)." >&2
  exit 1
fi

git fetch origin main
if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "error: local main is behind origin/main. Pull first." >&2
  exit 1
fi

# Bump version (npm prints the new "vX.Y.Z" to stdout).
new_version="$(npm version "$1" --no-git-tag-version)"
new_version="${new_version#v}"
tag="v${new_version}"
echo "Releasing ${tag}"

# Move [Unreleased] -> [X.Y.Z] - YYYY-MM-DD in CHANGELOG.md, leaving a fresh
# [Unreleased] section behind.
today="$(date -u +%Y-%m-%d)"
tmp="$(mktemp)"
awk -v ver="${new_version}" -v date="${today}" '
  BEGIN { replaced = 0 }
  /^## \[Unreleased\]/ && replaced == 0 {
    print "## [Unreleased]"
    print ""
    print "## [" ver "] - " date
    replaced = 1
    next
  }
  { print }
' CHANGELOG.md > "$tmp"
mv "$tmp" CHANGELOG.md

git add package.json package-lock.json CHANGELOG.md
git commit -m "chore(release): ${tag}"
git tag -a "${tag}" -m "${tag}"

echo
echo "Created commit + tag locally. To publish:"
echo "  git push origin main ${tag}"
echo
echo "The tag push will trigger the Docker Hub release workflow."
