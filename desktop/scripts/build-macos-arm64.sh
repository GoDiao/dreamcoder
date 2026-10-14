#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${DESKTOP_DIR}/.." && pwd)"

TARGET_TRIPLE="aarch64-apple-darwin"
TAURI_TARGET_DIR="${DESKTOP_DIR}/src-tauri/target"
CANONICAL_OUTPUT_DIR="${DESKTOP_DIR}/build-artifacts/macos-arm64"
APP_BUNDLE_NAME="DreamCoder.app"
APP_BUNDLE_ID="com.dreamcoder.desktop"

usage() {
  cat <<'EOF'
Build DreamCoder desktop for macOS Apple Silicon and output a DMG.

Usage:
  ./desktop/scripts/build-macos-arm64.sh [extra tauri build args...]

Environment:
  SKIP_INSTALL=1   Skip `bun install` in the repo root and desktop app.
  SIGN_BUILD=1     Remove the default `--no-sign` flag and allow signed builds.
  OPEN_OUTPUT=1    Open the canonical artifact output directory in Finder after a successful build.
  PRESERVE_TAURI_TARGET=1
                  Keep Tauri/Rust target cache for a faster incremental build.
                  By default this script removes the macOS target cache so
                  packaged WebView assets cannot be silently reused.

Examples:
  ./desktop/scripts/build-macos-arm64.sh
  SKIP_INSTALL=1 ./desktop/scripts/build-macos-arm64.sh
  SIGN_BUILD=1 ./desktop/scripts/build-macos-arm64.sh --skip-stapling
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[build-macos-arm64] This script must run on macOS." >&2
  exit 1
fi

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "[build-macos-arm64] This script is intended for Apple Silicon hosts (arm64)." >&2
  exit 1
fi

for command in bun cargo rustc codesign hdiutil; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "[build-macos-arm64] Missing required command: ${command}" >&2
    exit 1
  fi
done

if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
  echo "[build-macos-arm64] Installing root dependencies..."
  (cd "${REPO_ROOT}" && bun install)

  echo "[build-macos-arm64] Installing desktop dependencies..."
  (cd "${DESKTOP_DIR}" && bun install)
fi

echo "[build-macos-arm64] Cleaning stale sidecar binaries, frontend output, and Tauri bundle cache..."
rm -rf "${DESKTOP_DIR}/src-tauri/binaries/claude-sidecar-"*
rm -rf "${DESKTOP_DIR}/dist"
rm -f "${DESKTOP_DIR}/tsconfig.tsbuildinfo"

if [[ "${PRESERVE_TAURI_TARGET:-0}" == "1" ]]; then
  echo "[build-macos-arm64] PRESERVE_TAURI_TARGET=1: keeping Rust dependency cache, clearing app-specific artifacts only..."
  rm -rf "${DESKTOP_DIR}/src-tauri/target/${TARGET_TRIPLE}/release/bundle"
  rm -rf "${DESKTOP_DIR}/src-tauri/target/release/bundle"
  rm -f "${DESKTOP_DIR}/src-tauri/target/${TARGET_TRIPLE}/release/claude-code-desktop"
  rm -f "${DESKTOP_DIR}/src-tauri/target/release/claude-code-desktop"
  find "${DESKTOP_DIR}/src-tauri/target/${TARGET_TRIPLE}/release/build" \
    -maxdepth 1 -name 'claude-code-desktop-*' -exec rm -rf {} + 2>/dev/null || true
  find "${DESKTOP_DIR}/src-tauri/target/${TARGET_TRIPLE}/release/.fingerprint" \
    -maxdepth 1 -name 'claude-code-desktop-*' -exec rm -rf {} + 2>/dev/null || true
  find "${DESKTOP_DIR}/src-tauri/target/${TARGET_TRIPLE}/release/deps" \
    -maxdepth 1 \( -name 'claude_code_desktop-*' -o -name 'libclaude_code_desktop-*' \) -exec rm -f {} + 2>/dev/null || true
else
  echo "[build-macos-arm64] Removing Tauri target cache for ${TARGET_TRIPLE} to force fresh embedded frontend assets..."
  rm -rf "${DESKTOP_DIR}/src-tauri/target/${TARGET_TRIPLE}"
  rm -rf "${DESKTOP_DIR}/src-tauri/target/release/bundle"
  rm -f "${DESKTOP_DIR}/src-tauri/target/release/claude-code-desktop"
  find "${DESKTOP_DIR}/src-tauri/target/release/build" \
    -maxdepth 1 -name 'claude-code-desktop-*' -exec rm -rf {} + 2>/dev/null || true
  find "${DESKTOP_DIR}/src-tauri/target/release/.fingerprint" \
    -maxdepth 1 -name 'claude-code-desktop-*' -exec rm -rf {} + 2>/dev/null || true
  find "${DESKTOP_DIR}/src-tauri/target/release/deps" \
    -maxdepth 1 \( -name 'claude_code_desktop-*' -o -name 'libclaude_code_desktop-*' \) -exec rm -f {} + 2>/dev/null || true
fi

echo "[build-macos-arm64] Rebuilding frontend (tsc + vite)..."
(cd "${DESKTOP_DIR}" && bun run build)

echo "[build-macos-arm64] Rebuilding sidecar for ${TARGET_TRIPLE}..."
(cd "${DESKTOP_DIR}" && TAURI_ENV_TARGET_TRIPLE="${TARGET_TRIPLE}" bun run build:sidecars)

TAURI_ARGS=(
  bunx
  tauri
  build
  --target
  "${TARGET_TRIPLE}"
  --bundles
  app,dmg
  --ci
  --config
  '{"build":{"beforeBuildCommand":"true"}}'
)

if [[ "${SIGN_BUILD:-0}" != "1" ]]; then
  TAURI_ARGS+=(--no-sign)
fi

if [[ "$#" -gt 0 ]]; then
  TAURI_ARGS+=("$@")
fi

echo "[build-macos-arm64] Building DMG for ${TARGET_TRIPLE}..."
(
  cd "${DESKTOP_DIR}"
  export TAURI_ENV_TARGET_TRIPLE="${TARGET_TRIPLE}"
  "${TAURI_ARGS[@]}"
)

TARGETED_DMG_DIR="${TAURI_TARGET_DIR}/${TARGET_TRIPLE}/release/bundle/dmg"
FALLBACK_DMG_DIR="${TAURI_TARGET_DIR}/release/bundle/dmg"
TARGETED_APP_DIR="${TAURI_TARGET_DIR}/${TARGET_TRIPLE}/release/bundle/macos"
FALLBACK_APP_DIR="${TAURI_TARGET_DIR}/release/bundle/macos"
LEGACY_BUNDLE_ROOT="${TAURI_TARGET_DIR}/release/bundle"

mkdir -p "${CANONICAL_OUTPUT_DIR}"
find "${CANONICAL_OUTPUT_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

find_latest_file() {
  local search_dir="$1"
  local pattern="$2"
  if [[ -d "${search_dir}" ]]; then
    find "${search_dir}" -maxdepth 1 -type f -name "${pattern}" | sort | tail -n 1
  fi
}

find_latest_dir() {
  local search_dir="$1"
  local pattern="$2"
  if [[ -d "${search_dir}" ]]; then
    find "${search_dir}" -maxdepth 1 -type d -name "${pattern}" | sort | tail -n 1
  fi
}

LATEST_DMG="$(find_latest_file "${TARGETED_DMG_DIR}" '*.dmg')"
if [[ -z "${LATEST_DMG}" ]]; then
  LATEST_DMG="$(find_latest_file "${FALLBACK_DMG_DIR}" '*.dmg')"
fi

LATEST_APP="$(find_latest_dir "${TARGETED_APP_DIR}" '*.app')"
if [[ -z "${LATEST_APP}" ]]; then
  LATEST_APP="$(find_latest_dir "${FALLBACK_APP_DIR}" '*.app')"
fi

build_canonical_dmg() {
  local app_bundle="$1"
  local dmg_output="$2"
  local staging_dir
  local rw_dmg

  staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/dreamcoder-dmg.XXXXXX")"
  rw_dmg="$(mktemp "${TMPDIR:-/tmp}/dreamcoder-rw.XXXXXX").dmg"

  cp -R "${app_bundle}" "${staging_dir}/"
  ln -s /Applications "${staging_dir}/Applications"

  hdiutil create \
    -volname "DreamCoder" \
    -srcfolder "${staging_dir}" \
    -ov \
    -format UDRW \
    "${rw_dmg}" >/dev/null

  rm -rf "${staging_dir}"

  local dev_name mount_dir
  dev_name=$(hdiutil attach -readwrite -noverify -noautoopen -nobrowse "${rw_dmg}" \
    | grep -E '^/dev/' | head -1 | awk '{print $1}')
  mount_dir=$(hdiutil info | grep -E "${dev_name}" | tail -1 | awk '{$1=$2=""; print}' | xargs)

  if ! osascript <<APPLESCRIPT
tell application "Finder"
  tell disk "DreamCoder"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {100, 100, 760, 500}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 128
    set position of item "${APP_BUNDLE_NAME}" of container window to {180, 170}
    set position of item "Applications" of container window to {480, 170}
    close
    open
    update without registering applications
    delay 2
    close
  end tell
end tell
APPLESCRIPT
  then
    echo "[build-macos-arm64] WARN: Finder layout AppleScript failed (likely macOS version incompatible); DMG will use default Finder layout" >&2
  fi

  sync
  hdiutil detach "${dev_name}" -quiet 2>/dev/null \
    || hdiutil detach "${dev_name}" -force -quiet

  hdiutil convert "${rw_dmg}" -format UDZO -o "${dmg_output}" -ov >/dev/null
  rm -f "${rw_dmg}"
}

codesign_cdhash() {
  local executable="$1"
  codesign -d --verbose=4 "${executable}" 2>&1 \
    | awk -F= '/^CDHash=/{print $2; exit}'
}

sign_canonical_app_bundle() {
  local app_bundle="$1"
  local sidecar="${app_bundle}/Contents/MacOS/claude-sidecar"
  local sidecar_cdhash_before=""
  local sidecar_cdhash_after=""

  if [[ -x "${sidecar}" ]]; then
    sidecar_cdhash_before="$(codesign_cdhash "${sidecar}")"
  fi

  codesign --force --sign - --timestamp=none "${app_bundle}"

  if [[ -x "${sidecar}" ]]; then
    sidecar_cdhash_after="$(codesign_cdhash "${sidecar}")"
    if [[ "${sidecar_cdhash_before}" != "${sidecar_cdhash_after}" ]]; then
      echo "[build-macos-arm64] ERROR: sidecar signature hash changed while signing app bundle" >&2
      echo "[build-macos-arm64] before=${sidecar_cdhash_before}" >&2
      echo "[build-macos-arm64] after=${sidecar_cdhash_after}" >&2
      exit 1
    fi
  fi

  codesign --verify --deep --strict --verbose=2 "${app_bundle}"
}

if [[ -n "${LATEST_APP}" ]]; then
  sign_canonical_app_bundle "${LATEST_APP}"

  cp -R "${LATEST_APP}" "${CANONICAL_OUTPUT_DIR}/"
  sign_canonical_app_bundle "${CANONICAL_OUTPUT_DIR}/${APP_BUNDLE_NAME}"
  rm -f "${CANONICAL_OUTPUT_DIR}/"*.dmg
  CANONICAL_DMG="${CANONICAL_OUTPUT_DIR}/$(basename "${LATEST_DMG:-DreamCoder_0.1.0_aarch64.dmg}")"
  build_canonical_dmg \
    "${CANONICAL_OUTPUT_DIR}/${APP_BUNDLE_NAME}" \
    "${CANONICAL_DMG}"

  if [[ -n "${LATEST_DMG}" ]]; then
    cp -f "${CANONICAL_DMG}" "${LATEST_DMG}"
  fi
elif [[ -n "${LATEST_DMG}" ]]; then
  cp -f "${LATEST_DMG}" "${CANONICAL_OUTPUT_DIR}/"
fi

cat > "${CANONICAL_OUTPUT_DIR}/BUILD_INFO.txt" <<EOF
Target triple: ${TARGET_TRIPLE}
Canonical output: ${CANONICAL_OUTPUT_DIR}
Canonical app: ${CANONICAL_OUTPUT_DIR}/${APP_BUNDLE_NAME}
Canonical DMG: ${CANONICAL_DMG:-not found}
Tauri app output: ${LATEST_APP:-not found}
Tauri DMG output: ${LATEST_DMG:-not found}
Built at: $(date '+%Y-%m-%d %H:%M:%S %z')
EOF

if [[ -d "${LEGACY_BUNDLE_ROOT}" ]]; then
  rm -rf "${LEGACY_BUNDLE_ROOT}"
fi

echo
echo "[build-macos-arm64] Build finished."
if [[ -n "${LATEST_APP}" ]]; then
  echo "[build-macos-arm64] Tauri app output (identity normalized): ${LATEST_APP}"
else
  echo "[build-macos-arm64] No .app found in ${TARGETED_APP_DIR} or ${FALLBACK_APP_DIR}" >&2
fi

if [[ -n "${LATEST_DMG}" ]]; then
  echo "[build-macos-arm64] Tauri DMG output (replaced with canonical DMG): ${LATEST_DMG}"
else
  echo "[build-macos-arm64] No DMG found in ${TARGETED_DMG_DIR} or ${FALLBACK_DMG_DIR}" >&2
fi

echo "[build-macos-arm64] Canonical output: ${CANONICAL_OUTPUT_DIR}"
echo "[build-macos-arm64] Removed legacy bundle dir: ${LEGACY_BUNDLE_ROOT}"

if [[ "${OPEN_OUTPUT:-0}" == "1" ]]; then
  open "${CANONICAL_OUTPUT_DIR}"
fi
