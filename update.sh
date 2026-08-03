#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="kcit-site"
UPDATE_CONFIG="/etc/${APP_NAME}-update.conf"
SOURCE="${1:-}"
TEMP_DIR=""

cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
}
trap cleanup EXIT

usage() {
  cat <<'EOF'
Usage:
  sudo ./update.sh /path/to/kcit-site.zip
  sudo ./update.sh https://example.com/kcit-site.zip
  sudo ./update.sh

With no argument, the updater downloads kcit-site.zip from the latest GitHub
release configured by install.sh --repo OWNER/REPOSITORY.
EOF
}

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this updater as root (for example: sudo ./update.sh)." >&2
  exit 1
fi

if [[ "$SOURCE" == "-h" || "$SOURCE" == "--help" ]]; then
  usage
  exit 0
fi

TEMP_DIR="$(mktemp -d -t kcit-update.XXXXXXXX)"
ARCHIVE="${TEMP_DIR}/kcit-site.zip"
EXTRACTED="${TEMP_DIR}/extracted"
mkdir -p "$EXTRACTED"

if [[ -z "$SOURCE" ]]; then
  if [[ ! -r "$UPDATE_CONFIG" ]]; then
    echo "No GitHub repository is configured. Pass a ZIP path/URL or reinstall with --repo OWNER/REPOSITORY." >&2
    exit 1
  fi
  # This file is root-owned and written by install.sh.
  source "$UPDATE_CONFIG"
  SOURCE="https://github.com/${GITHUB_REPO}/releases/latest/download/kcit-site.zip"
fi

if [[ "$SOURCE" =~ ^https?:// ]]; then
  command -v curl >/dev/null 2>&1 || { echo "curl is required to download updates." >&2; exit 1; }
  curl --fail --location --proto '=https' --tlsv1.2 --output "$ARCHIVE" "$SOURCE"
else
  [[ -f "$SOURCE" ]] || { echo "Release ZIP not found: $SOURCE" >&2; exit 1; }
  cp -- "$SOURCE" "$ARCHIVE"
fi

command -v unzip >/dev/null 2>&1 || { echo "unzip is required to install updates." >&2; exit 1; }
unzip -q "$ARCHIVE" -d "$EXTRACTED"

INSTALLER="$(find "$EXTRACTED" -mindepth 1 -maxdepth 2 -type f -name install.sh -print -quit)"
if [[ -z "$INSTALLER" ]]; then
  echo "The release ZIP does not contain install.sh at an expected location." >&2
  exit 1
fi

RELEASE_ROOT="$(dirname "$INSTALLER")"
chmod 0755 "$INSTALLER"
ARGS=(--source "$RELEASE_ROOT")
if [[ -n "${GITHUB_REPO:-}" ]]; then
  ARGS+=(--repo "$GITHUB_REPO")
fi
"$INSTALLER" "${ARGS[@]}"
