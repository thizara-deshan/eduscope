#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

manifest=
fixture=
profile=production
while (($#)); do
  case "$1" in
    --manifest) [[ $# -ge 2 ]] || exit 64; manifest=$2; shift 2 ;;
    --xrandr-fixture) [[ $# -ge 2 ]] || exit 64; fixture=$2; shift 2 ;;
    --profile) [[ $# -ge 2 ]] || exit 64; profile=$2; shift 2 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 64 ;;
  esac
done
[[ -n "$manifest" && ( "$profile" == production || "$profile" == demo-staging ) ]] || {
  printf 'usage: xrandr-layout.sh --manifest PATH [--profile production|demo-staging] [--xrandr-fixture PATH]\n' >&2
  exit 64
}

if [[ -n "$fixture" ]]; then
  topology=$fixture
else
  topology=$(mktemp)
  trap 'rm -f -- "$topology"' EXIT
  xrandr --props >"$topology"
fi

mapfile -t connected < <(awk '$2 == "connected" {print $1}' "$topology")
if [[ "$profile" == demo-staging ]]; then
  if [[ ${#connected[@]} -ne 2 ]] ||
    [[ ! ( ${connected[0]:-} == HDMI-1 && ${connected[1]:-} == DP-2 ) &&
       ! ( ${connected[0]:-} == DP-2 && ${connected[1]:-} == HDMI-1 ) ]]; then
    printf 'topology mismatch; observed:' >&2
    printf ' %s' "${connected[@]}" >&2
    printf '\n' >&2
    exit 78
  fi
  touch_name=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["touch"]["name"])' "$manifest")
  xrandr --output HDMI-1 --mode 1280x800 --pos 0x0 --primary \
    --output DP-2 --auto --pos 1280x0
  xinput map-to-output "$touch_name" HDMI-1
  printf 'multi-display acceptance open\n'
  exit 0
fi

mapfile -t layout < <(python3 - "$manifest" "$topology" <<'PY'
import hashlib
import json
import re
import sys

manifest = json.load(open(sys.argv[1]))
lines = open(sys.argv[2]).read().splitlines()
observed = []
for index, line in enumerate(lines):
    match = re.match(r"^(\S+) connected(?:\s|$)", line)
    if not match:
        continue
    connector = match.group(1)
    edid = ""
    cursor = index + 1
    while cursor < len(lines) and not re.match(r"^\S+ (?:dis)?connected(?:\s|$)", lines[cursor]):
        if lines[cursor].strip() == "EDID:":
            cursor += 1
            while cursor < len(lines) and re.fullmatch(r"\s+[0-9a-fA-F]+\s*", lines[cursor]):
                edid += lines[cursor].strip()
                cursor += 1
            break
        cursor += 1
    digest = hashlib.sha256(bytes.fromhex(edid)).hexdigest() if edid else "none"
    observed.append((connector, digest))

roles = {display["role"]: display for display in manifest["displays"]}
resolved = {}
for role in ("projector", "meeting", "panel"):
    digest = roles[role].get("edidSha256")
    matches = [connector for connector, found in observed if found == digest]
    if len(matches) != 1:
        print("ERROR\t" + " ".join(f"{connector}/{found}" for connector, found in observed))
        raise SystemExit
    resolved[role] = matches[0]

for role in ("projector", "meeting", "panel"):
    display = roles[role]
    print("DISPLAY\t%s\t%s\t%s\t%s" % (role, resolved[role], display["mode"], display["width"]))
for connector, _ in observed:
    if connector not in resolved.values():
        print("OFF\t" + connector)
print("TOUCH\t" + manifest["touch"]["name"])
PY
)

if [[ ${#layout[@]} -eq 0 || ${layout[0]} == ERROR$'\t'* ]]; then
  printf 'topology mismatch; observed %s\n' "${layout[0]#*$'\t'}" >&2
  exit 78
fi

declare -A connector mode width
off=()
touch_name=
for record in "${layout[@]}"; do
  IFS=$'\t' read -r kind first second third fourth <<<"$record"
  case "$kind" in
    DISPLAY) connector[$first]=$second; mode[$first]=$third; width[$first]=$fourth ;;
    OFF) off+=("$first") ;;
    TOUCH) touch_name=$first ;;
  esac
done

projector_x=0
meeting_x=${width[projector]}
panel_x=$((width[projector] + width[meeting]))
args=(
  --output "${connector[projector]}" --mode "${mode[projector]}" --pos "${projector_x}x0"
  --output "${connector[meeting]}" --mode "${mode[meeting]}" --pos "${meeting_x}x0"
  --output "${connector[panel]}" --mode 1280x800 --pos "${panel_x}x0" --primary
)
for output in "${off[@]}"; do
  args+=(--output "$output" --off)
done
xrandr "${args[@]}"
xinput map-to-output "$touch_name" "${connector[panel]}"
