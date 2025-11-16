#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$ROOT_DIR/extension"
DIST_DIR="$ROOT_DIR/dist"
TASK_FILE="$ROOT_DIR/task.md"
SCRIPT_BASENAME="$(basename "${BASH_SOURCE[0]}")"

log_event() {
  local function_name="$1"
  local system_section="$2"
  local message="$3"
  local error="${4:-}"
  local method="${5:-NONE}"
  local line_num="${6:-${BASH_LINENO[0]}}"
  local timestamp
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  printf '{"filename":"%s","timestamp":"%s","classname":"build","function":"%s","system_section":"%s","line_num":%d,"error":"%s","db_phase":"none","method":"%s","message":"%s"}\n' \
    "$SCRIPT_BASENAME" "$timestamp" "$function_name" "$system_section" "$line_num" "$error" "$method" "$message"
  printf '[build] %s\n' "$message"
}

verify_epic_completion() {
  log_event "verify_epic_completion" "validation" "Checking task tracker for incomplete epics"
  if grep -q '\\[ \\]' "$TASK_FILE"; then
    log_event "verify_epic_completion" "validation" "Detected incomplete work items in task.md" "EPICS_INCOMPLETE"
    exit 1
  fi
  log_event "verify_epic_completion" "validation" "All epics and stories are marked complete"
}

install_dependencies() {
  log_event "install_dependencies" "dependencies" "Installing npm dependencies via npm ci"
  npm ci >/dev/null
  log_event "install_dependencies" "dependencies" "Dependency installation finished"
}

run_quality_checks() {
  log_event "run_quality_checks" "quality" "Running eslint"
  npm run lint >/dev/null
  log_event "run_quality_checks" "quality" "Running node --test"
  npm test >/dev/null
  log_event "run_quality_checks" "quality" "Quality checks completed"
}

regenerate_icons() {
  log_event "regenerate_icons" "artifacts" "Regenerating extension icons"
  local icon_dir="$EXT_DIR/icons"
  mkdir -p "$icon_dir"

  if base64 --help 2>&1 | grep -q -- '--decode'; then
    BASE64_DECODE=(base64 --decode)
  else
    BASE64_DECODE=(base64 -d)
  fi

  write_icon() {
    local filename="$1"
    local payload="$2"
    printf '%s' "$payload" | "${BASE64_DECODE[@]}" > "$icon_dir/$filename"
  }

  write_icon "icon16.png" "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR42mNQ0I35TwlmGDVg1IBRA4aLAQAQdKgQSxMnigAAAABJRU5ErkJggg=="
  write_icon "icon48.png" "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAARUlEQVR42u3PQREAAAQAMFEU0Ej/GlTwdbfHAiyyej4LAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAYGrBRwH6NMPcfe7AAAAAElFTkSuQmCC"
  write_icon "icon128.png" "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAA80lEQVR42u3SMQ0AAAjAMKRgAEf4twE2SOgxA0sjq0d/CxMAMAIAASAABIAAEAACQAAIAAEgAASAABAAAkAACAABIAAEgAAQAAJAAAgAASAABIAAEAACQAAIAAEgAASAABAAAkAACAABIAAEgAAQAAJAAAgAASAABIAAEAACQAAIAAEgAASAABAAAkAACAABIAAEgAAQAAJAAAgAASAABIButDd8BjfYn9gLAAAAAElFTkSuQmCC"

  log_event "regenerate_icons" "artifacts" "Extension icons regenerated"
}

package_extension() {
  log_event "package_extension" "artifacts" "Packaging extension into dist/extension.zip"
  mkdir -p "$DIST_DIR"
  local artifact="$DIST_DIR/extension.zip"
  rm -f "$artifact"
  python - <<'PY' "$artifact" "$EXT_DIR"
import os
import sys
import zipfile
artifact = sys.argv[1]
source = sys.argv[2]
with zipfile.ZipFile(artifact, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for root, _, files in os.walk(source):
        for filename in files:
            full_path = os.path.join(root, filename)
            rel_path = os.path.relpath(full_path, source)
            archive.write(full_path, rel_path)
PY
  log_event "package_extension" "artifacts" "Extension artifact created" "" "NONE" "${BASH_LINENO[0]}"
}

main() {
  log_event "main" "init" "Starting build pipeline"
  verify_epic_completion
  install_dependencies
  run_quality_checks
  regenerate_icons
  package_extension
  log_event "main" "complete" "Build pipeline completed successfully"
}

main "$@"
