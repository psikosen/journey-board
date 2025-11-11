#!/usr/bin/env bash
set -euo pipefail

# Reconstruct extension icon PNGs without storing binary blobs in the repo.
# The base64 payloads are derived from the original icons checked in previously.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ICON_DIR="$ROOT_DIR/extension/icons"
mkdir -p "$ICON_DIR"

if base64 --help 2>&1 | grep -q -- '--decode'; then
  BASE64_DECODE=(base64 --decode)
else
  BASE64_DECODE=(base64 -d)
fi

write_icon() {
  local filename="$1"
  local payload="$2"
  printf '%s' "$payload" | "${BASE64_DECODE[@]}" > "$ICON_DIR/$filename"
}

write_icon "icon16.png" "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR42mNQ0I35TwlmGDVg1IBRA4aLAQAQdKgQSxMnigAAAABJRU5ErkJggg=="
write_icon "icon48.png" "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAARUlEQVR42u3PQREAAAQAMFEU0Ej/GlTwdbfHAiyyej4LAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAYGrBRwH6NMPcfe7AAAAAElFTkSuQmCC"
write_icon "icon128.png" "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAA80lEQVR42u3SMQ0AAAjAMKRgAEf4twE2SOgxA0sjq0d/CxMAMAIAASAABIAAEAACQAAIAAEgAASAABAAAkAACAABIAAEgAAQAAJAAAgAASAABIAAEAACQAAIAAEgAASAABAAAkAACAABIAAEgAAQAAJAAAgAASAABIAAEAACQAAIAAEgAASAABAAAkAACAABIAAEgAAQAAJAAAgAASAABIAAEAACQAAIAAEgAAQAACYAYAQAAkAACAABIAAEgAAQAAJAAAgAASAABIAAEAACQAAIAAEgAASAABAAAkAACAABIAAEgAAQAAJAAAgAASAABIButDd8BjfYn9gLAAAAAElFTkSuQmCC"

echo "Extension icons have been regenerated in $ICON_DIR"
