#!/usr/bin/env bash
# Simulation equality gate: capture final authority state and timings for every
# native scenario, then compare two captures byte for byte.
#
#   scripts/diagnostics/sim-step-gate.sh capture <label> [seconds]
#   scripts/diagnostics/sim-step-gate.sh compare <label-a> <label-b>
#
# Captures live in ignored .build/sim-gate/<label>/. Capture master first
# (e.g. from a temporary worktree), then the branch, then compare. Bit-exact
# changes must show "identical" for every scenario; behaviour changes must say
# in their PR which scenarios differ and why. Fleet-command scenarios run
# <seconds> (default 600); the heavier custom/server scenarios run a quarter.
set -euo pipefail
cd "$(dirname "$0")/../.."
mode=${1:?capture|compare}
case "$mode" in
  capture)
    label=${2:?label}; seconds=${3:-600}
    out=.build/sim-gate/$label; mkdir -p "$out"
    export PATH="$HOME/.cargo/bin:$PATH"
    cargo build --release -p naval-wasm --example pve_speed --quiet
    bin=target/release/examples/pve_speed
    for scenario in surface carrier custom server; do
      s=$seconds; case $scenario in custom|server) s=$(( seconds / 4 ));; esac
      "$bin" "$scenario" "$s" --dump "$out/$scenario.json" 2> "$out/$scenario.log" > "$out/$scenario.summary.json"
      echo "$scenario: $(cat "$out/$scenario.summary.json")"
    done
    git rev-parse HEAD > "$out/commit"
    ;;
  compare)
    a=.build/sim-gate/${2:?label-a}; b=.build/sim-gate/${3:?label-b}
    status=0
    for scenario in surface carrier custom server; do
      if cmp -s "$a/$scenario.json" "$b/$scenario.json"; then verdict=identical; else verdict=DIFFERENT; status=1; fi
      python3 - "$a/$scenario.summary.json" "$b/$scenario.summary.json" "$scenario" "$verdict" <<'PY'
import json, sys
a, b = (json.load(open(p)) for p in sys.argv[1:3])
r = lambda k: (a[k] / b[k]) if b[k] else float('nan')
print(f"{sys.argv[3]:8s} {sys.argv[4]:10s} step {a['stepMs']/1000:8.1f}s -> {b['stepMs']/1000:8.1f}s ({100*(1-b['stepMs']/a['stepMs']):+.1f}% saved)  snapshot {a['snapshotMs']/1000:6.1f}s -> {b['snapshotMs']/1000:6.1f}s  bytes {a['bytes']/1e6:8.1f}MB -> {b['bytes']/1e6:8.1f}MB  ticks {a['ticks']} / {b['ticks']}")
PY
    done
    exit $status
    ;;
  *) echo "unknown mode $mode" >&2; exit 2;;
esac
