#!/usr/bin/env bash
set -euo pipefail
service_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="${1:-${service_dir}/.venv/bin/eduscope-webrtc-worker}"
gcc -O2 -Wall -Wextra -DGST_USE_UNSTABLE_API -o "$output" "${service_dir}/native/webrtc-worker.c" \
  -I/usr/include/gstreamer-1.0 \
  $(pkg-config --cflags --libs json-glib-1.0 gio-unix-2.0) \
  -lgstwebrtc-1.0 -lgstsdp-1.0 -lgstreamer-1.0
