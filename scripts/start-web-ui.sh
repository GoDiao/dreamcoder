#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="${ROOT_DIR}/desktop"
HOST="${HOST:-127.0.0.1}"
SERVER_PORT_START="${SERVER_PORT:-3456}"
WEB_PORT_START="${WEB_PORT:-2024}"
MAX_PORT_SCAN="${MAX_PORT_SCAN:-100}"
RUN_ID="$(date +%s)-$RANDOM"
LOG_DIR="${LOG_DIR:-/tmp/dreamcoder-web-ui-${RUN_ID}}"
SERVER_LOG="${LOG_DIR}/server.log"
WEB_LOG="${LOG_DIR}/web.log"

SERVER_PID=""
WEB_PID=""

usage() {
  cat <<'EOF'
Usage: scripts/start-web-ui.sh

Environment overrides:
  SERVER_PORT=3456   preferred backend port
  WEB_PORT=2024      preferred Web UI port
  HOST=127.0.0.1     bind host for both processes
  LOG_DIR=/tmp/...   directory for server.log and web.log

The script checks the preferred ports first and scans upward when a port is busy.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

is_port_in_use() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi

  if command -v nc >/dev/null 2>&1; then
    nc -z "${HOST}" "${port}" >/dev/null 2>&1
    return $?
  fi

  echo "Missing lsof or nc; cannot check whether port ${port} is available." >&2
  exit 1
}

find_available_port() {
  local start_port="$1"
  local port="${start_port}"
  local end_port=$((start_port + MAX_PORT_SCAN))

  while (( port <= end_port )); do
    if ! is_port_in_use "${port}"; then
      printf '%s\n' "${port}"
      return 0
    fi
    port=$((port + 1))
  done

  echo "No available port found in range ${start_port}-${end_port}" >&2
  exit 1
}

urlencode() {
  bun -e 'console.log(encodeURIComponent(process.argv[1]))' "$1"
}

wait_for_http() {
  local url="$1"
  local log_file="$2"

  for _ in $(seq 1 120); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi

    if [[ -n "${SERVER_PID}" ]] && ! kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
      echo "Server process exited before ${url} became ready. Recent log:" >&2
      tail -n 40 "${SERVER_LOG}" >&2 || true
      exit 1
    fi

    if [[ -n "${WEB_PID}" ]] && ! kill -0 "${WEB_PID}" >/dev/null 2>&1; then
      echo "Web UI process exited before ${url} became ready. Recent log:" >&2
      tail -n 40 "${WEB_LOG}" >&2 || true
      exit 1
    fi

    sleep 1
  done

  echo "Timed out waiting for ${url}. Recent log:" >&2
  tail -n 40 "${log_file}" >&2 || true
  exit 1
}

cleanup() {
  local exit_code=$?

  if [[ -n "${WEB_PID}" ]]; then
    kill "${WEB_PID}" >/dev/null 2>&1 || true
    wait "${WEB_PID}" >/dev/null 2>&1 || true
  fi

  if [[ -n "${SERVER_PID}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi

  if [[ "${exit_code}" -ne 0 && "${exit_code}" -ne 130 && "${exit_code}" -ne 143 ]]; then
    echo "Logs kept at ${LOG_DIR}" >&2
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

require_command bun
require_command curl

if [[ ! -d "${DESKTOP_DIR}" ]]; then
  echo "Desktop directory not found: ${DESKTOP_DIR}" >&2
  exit 1
fi

mkdir -p "${LOG_DIR}"

SERVER_PORT_RESOLVED="$(find_available_port "${SERVER_PORT_START}")"
WEB_PORT_RESOLVED="$(find_available_port "${WEB_PORT_START}")"
if [[ "${WEB_PORT_RESOLVED}" == "${SERVER_PORT_RESOLVED}" ]]; then
  WEB_PORT_RESOLVED="$(find_available_port "$((WEB_PORT_RESOLVED + 1))")"
fi

SERVER_URL="http://${HOST}:${SERVER_PORT_RESOLVED}"
WEB_URL="http://${HOST}:${WEB_PORT_RESOLVED}/?serverUrl=$(urlencode "${SERVER_URL}")"

if [[ "${SERVER_PORT_RESOLVED}" != "${SERVER_PORT_START}" ]]; then
  echo "Server port ${SERVER_PORT_START} is busy; using ${SERVER_PORT_RESOLVED}."
fi

if [[ "${WEB_PORT_RESOLVED}" != "${WEB_PORT_START}" ]]; then
  echo "Web UI port ${WEB_PORT_START} is busy; using ${WEB_PORT_RESOLVED}."
fi

echo "Starting server: ${SERVER_URL}"
(
  cd "${ROOT_DIR}"
  SERVER_PORT="${SERVER_PORT_RESOLVED}" bun run src/server/index.ts --host "${HOST}" --port "${SERVER_PORT_RESOLVED}"
) >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

wait_for_http "${SERVER_URL}/health" "${SERVER_LOG}"

echo "Starting Web UI: http://${HOST}:${WEB_PORT_RESOLVED}"
(
  cd "${DESKTOP_DIR}"
  VITE_DESKTOP_SERVER_URL="${SERVER_URL}" bun run dev -- --host "${HOST}" --port "${WEB_PORT_RESOLVED}" --strictPort
) >"${WEB_LOG}" 2>&1 &
WEB_PID=$!

wait_for_http "http://${HOST}:${WEB_PORT_RESOLVED}" "${WEB_LOG}"

cat <<EOF

Web UI is ready:
  ${WEB_URL}

Backend:
  ${SERVER_URL}

Logs:
  ${SERVER_LOG}
  ${WEB_LOG}

Press Ctrl-C to stop both processes.
EOF

while true; do
  if ! kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    wait "${SERVER_PID}"
    exit $?
  fi

  if ! kill -0 "${WEB_PID}" >/dev/null 2>&1; then
    wait "${WEB_PID}"
    exit $?
  fi

  sleep 1
done
