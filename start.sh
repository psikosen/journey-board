#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_BASENAME="$(basename "${BASH_SOURCE[0]}")"
RUN_BUILD=1
LAUNCH_CHROME=0
PROFILE_NAME="extension-dev"
CHROME_BINARY=""
EXTENSION_DIR="$ROOT_DIR/extension"

log_event() {
  local function_name="$1"
  local system_section="$2"
  local message="$3"
  local line_num="${4:-${BASH_LINENO[0]}}"
  local timestamp
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  printf '{"filename":"%s","timestamp":"%s","classname":"start","function":"%s","system_section":"%s","line_num":%d,"error":"","db_phase":"none","method":"NONE","message":"%s"}\n' \
    "$SCRIPT_BASENAME" "$timestamp" "$function_name" "$system_section" "$line_num" "$message"
  printf '[start] %s\n' "$message"
}

usage() {
  cat <<USAGE
Usage: ./start.sh [options]
  --skip-build           Skip running the build pipeline
  --launch-chrome        Launch Chrome with the unpacked extension after build
  --profile <name>       Override the isolated Chrome profile name (default: $PROFILE_NAME)
  --chrome-binary <bin>  Explicit path to the Chrome/Chromium binary
  --extension-dir <dir>  Override the extension directory (default: $EXTENSION_DIR)
  --help                 Show this help message
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      RUN_BUILD=0
      shift
      ;;
    --launch-chrome)
      LAUNCH_CHROME=1
      shift
      ;;
    --profile)
      PROFILE_NAME="$2"
      shift 2
      ;;
    --chrome-binary)
      CHROME_BINARY="$2"
      shift 2
      ;;
    --extension-dir)
      EXTENSION_DIR="$2"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 1
      ;;
  esac
done

if [[ $RUN_BUILD -eq 1 ]]; then
  log_event "main" "build" "Running ./build.sh"
  "$ROOT_DIR/build.sh"
else
  log_event "main" "build" "Skipping build per flag"
fi

if [[ $LAUNCH_CHROME -eq 1 ]]; then
  log_event "main" "launch" "Invoking setup-chrome.sh"
  cmd=("$ROOT_DIR/setup-chrome.sh" --profile "$PROFILE_NAME" --extension-dir "$EXTENSION_DIR" --auto-launch)
  if [[ -n "$CHROME_BINARY" ]]; then
    cmd+=(--chrome-binary "$CHROME_BINARY")
  fi
  "${cmd[@]}"
else
  log_event "main" "launch" "Launch flag not provided; skipping Chrome setup"
fi
