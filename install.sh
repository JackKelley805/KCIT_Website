#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="kcit-site"
APP_ROOT="/opt/${APP_NAME}"
DATA_DIR="/var/lib/${APP_NAME}"
ENV_FILE="/etc/${APP_NAME}.env"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
UPDATE_CONFIG="/etc/${APP_NAME}-update.conf"
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GITHUB_REPO=""

usage() {
  cat <<'EOF'
Usage: sudo ./install.sh [--source DIRECTORY] [--repo OWNER/REPOSITORY]

Installs or upgrades the site, enables its systemd service, and starts it.
The optional GitHub repository is saved for update.sh to use later.
EOF
}

while (($#)); do
  case "$1" in
    --source)
      SOURCE_DIR="$(cd -- "${2:?Missing directory after --source}" && pwd)"
      shift 2
      ;;
    --repo)
      GITHUB_REPO="${2:?Missing OWNER/REPOSITORY after --repo}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root (for example: sudo ./install.sh)." >&2
  exit 1
fi

for command in node systemctl install cp ln mktemp; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 1
  fi
done

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if ((NODE_MAJOR < 18)); then
  echo "Node.js 18 or newer is required; found $(node --version)." >&2
  exit 1
fi

if [[ ! -f "${SOURCE_DIR}/server.js" || ! -f "${SOURCE_DIR}/package.json" ]]; then
  echo "${SOURCE_DIR} is not a valid KC-IT release directory." >&2
  exit 1
fi

node --check "${SOURCE_DIR}/server.js"

if [[ -n "${GITHUB_REPO}" && ! "${GITHUB_REPO}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "--repo must use the OWNER/REPOSITORY format." >&2
  exit 1
fi

if ! getent group "$APP_NAME" >/dev/null; then
  groupadd --system "$APP_NAME"
fi
if ! id --user "$APP_NAME" >/dev/null 2>&1; then
  useradd --system --gid "$APP_NAME" --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_NAME"
fi

install -d -o root -g root -m 0755 "$APP_ROOT" "${APP_ROOT}/releases"
install -d -o "$APP_NAME" -g "$APP_NAME" -m 0750 "$DATA_DIR"

RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"
install -d -o root -g root -m 0755 "$RELEASE_DIR"

RELEASE_ITEMS=(
  assets styles scripts deploy
  index.html business-it.html managed-networks.html contact.html
  contact-development.html under-development.html server.js package.json
  robots.txt sitemap.xml
  install.sh update.sh README.md
)

for item in "${RELEASE_ITEMS[@]}"; do
  if [[ -e "${SOURCE_DIR}/${item}" ]]; then
    cp -a "${SOURCE_DIR}/${item}" "$RELEASE_DIR/"
  fi
done

if [[ -f "${SOURCE_DIR}/VERSION" ]]; then
  cp -a "${SOURCE_DIR}/VERSION" "$RELEASE_DIR/"
else
  printf '%s\n' "$RELEASE_ID" >"${RELEASE_DIR}/VERSION"
fi

find "$RELEASE_DIR" -type d -exec chmod 0755 {} +
find "$RELEASE_DIR" -type f -exec chmod 0644 {} +
chmod 0755 "${RELEASE_DIR}/install.sh" "${RELEASE_DIR}/update.sh"

if [[ ! -f "$ENV_FILE" ]]; then
  install -o root -g "$APP_NAME" -m 0640 "${SOURCE_DIR}/deploy/kcit-site.env.example" "$ENV_FILE"
fi

NODE_PATH="$(command -v node)"
sed \
  -e "s|^ExecStart=.*|ExecStart=${NODE_PATH} ${APP_ROOT}/current/server.js|" \
  -e "s|^WorkingDirectory=.*|WorkingDirectory=${APP_ROOT}/current|" \
  -e "s|^EnvironmentFile=.*|EnvironmentFile=${ENV_FILE}|" \
  -e "s|^ReadWritePaths=.*|ReadWritePaths=${DATA_DIR}|" \
  "${SOURCE_DIR}/deploy/kcit-site.service" >"${SERVICE_FILE}.tmp"
install -o root -g root -m 0644 "${SERVICE_FILE}.tmp" "$SERVICE_FILE"
rm -f "${SERVICE_FILE}.tmp"

if [[ -n "$GITHUB_REPO" ]]; then
  printf 'GITHUB_REPO=%q\n' "$GITHUB_REPO" >"$UPDATE_CONFIG"
  chmod 0600 "$UPDATE_CONFIG"
fi

PREVIOUS_TARGET=""
if [[ -L "${APP_ROOT}/current" ]]; then
  PREVIOUS_TARGET="$(readlink -f "${APP_ROOT}/current")"
fi
ln -sfn "$RELEASE_DIR" "${APP_ROOT}/current.new"
mv -Tf "${APP_ROOT}/current.new" "${APP_ROOT}/current"

systemctl daemon-reload
systemctl enable "$APP_NAME.service" >/dev/null
if ! systemctl restart "$APP_NAME.service" || ! systemctl is-active --quiet "$APP_NAME.service"; then
  echo "The new release failed to start." >&2
  if [[ -n "$PREVIOUS_TARGET" && -d "$PREVIOUS_TARGET" ]]; then
    ln -sfn "$PREVIOUS_TARGET" "${APP_ROOT}/current.new"
    mv -Tf "${APP_ROOT}/current.new" "${APP_ROOT}/current"
    systemctl restart "$APP_NAME.service" || true
    echo "Rolled back to the previous release." >&2
  fi
  systemctl status "$APP_NAME.service" --no-pager >&2 || true
  exit 1
fi

echo "Installed release $(cat "${RELEASE_DIR}/VERSION")"
echo "Service status: active (enabled at boot and configured to restart automatically)"
echo "Manage it with: sudo systemctl status ${APP_NAME}"
