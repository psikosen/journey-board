#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_BASENAME="$(basename "${BASH_SOURCE[0]}")"
PROFILE_NAME="extension-dev"
AUTO_LAUNCH=0
CHROME_BINARY=""
EXTENSION_DIR="$ROOT_DIR/extension"
PROFILE_ROOT="$ROOT_DIR/.chrome-profiles"

log_event() {
  local function_name="$1"
  local system_section="$2"
  local message="$3"
  local error="${4:-}"
  local line_num="${5:-${BASH_LINENO[0]}}"
  local timestamp
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  printf '{"filename":"%s","timestamp":"%s","classname":"setup-chrome","function":"%s","system_section":"%s","line_num":%d,"error":"%s","db_phase":"none","method":"NONE","message":"%s"}\n' \
    "$SCRIPT_BASENAME" "$timestamp" "$function_name" "$system_section" "$line_num" "$error" "$message"
  printf '[setup-chrome] %s\n' "$message"
}

usage() {
  cat <<USAGE
Usage: ./setup-chrome.sh [options]
  --profile <name>       Set the isolated Chrome profile name (default: $PROFILE_NAME)
  --chrome-binary <bin>  Explicit Chrome/Chromium binary to use
  --extension-dir <dir>  Directory containing the unpacked extension (default: $EXTENSION_DIR)
  --auto-launch          Launch Chrome immediately after setup
  --help                 Show this help message
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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
    --auto-launch)
      AUTO_LAUNCH=1
      shift
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

PROFILE_DIR="$PROFILE_ROOT/$PROFILE_NAME"

ensure_extension_dir() {
  if [[ ! -d "$EXTENSION_DIR" ]]; then
    log_event "ensure_extension_dir" "validation" "Extension directory $EXTENSION_DIR does not exist" "MISSING_EXTENSION_DIR"
    exit 1
  fi
  EXTENSION_DIR="$(cd "$EXTENSION_DIR" && pwd)"
}

select_chrome_binary() {
  if [[ -n "$CHROME_BINARY" ]]; then
    if [[ ! -x "$CHROME_BINARY" ]]; then
      log_event "select_chrome_binary" "validation" "Provided Chrome binary $CHROME_BINARY is not executable" "INVALID_BINARY"
      exit 1
    fi
    return
  fi

  local candidates=("google-chrome-stable" "google-chrome" "chromium" "chromium-browser" "chrome")
  for candidate in "${candidates[@]}"; do
    if command -v "$candidate" >/dev/null 2>&1; then
      CHROME_BINARY="$(command -v "$candidate")"
      break
    fi
  done

  if [[ -z "$CHROME_BINARY" ]]; then
    log_event "select_chrome_binary" "validation" "Could not locate a Chrome/Chromium binary on PATH" "CHROME_NOT_FOUND"
    exit 1
  fi
}

prepare_profile() {
  mkdir -p "$PROFILE_DIR"
  log_event "prepare_profile" "profile" "Prepared isolated Chrome profile at $PROFILE_DIR"
}

print_manual_instructions() {
  cat <<INSTRUCTIONS
Chrome profile prepared at: $PROFILE_DIR
Load the extension manually with the following launch command:
  "$CHROME_BINARY" \\
    --user-data-dir="$PROFILE_DIR" \\
    --load-extension="$EXTENSION_DIR" \\
    --disable-extensions-except="$EXTENSION_DIR" \\
    --no-first-run --disable-sync
INSTRUCTIONS
}

launch_chrome() {
  log_event "launch_chrome" "launch" "Launching Chrome with isolated profile"
  "$CHROME_BINARY" \
    --user-data-dir="$PROFILE_DIR" \
    --load-extension="$EXTENSION_DIR" \
    --disable-extensions-except="$EXTENSION_DIR" \
    --no-first-run \
    --disable-sync \
    --disable-background-networking \
    >/dev/null 2>&1 &
  log_event "launch_chrome" "launch" "Chrome launch command issued"
}

ensure_extension_dir
select_chrome_binary
prepare_profile

if [[ $AUTO_LAUNCH -eq 1 ]]; then
  launch_chrome
else
  print_manual_instructions
fi
