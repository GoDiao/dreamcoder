#!/bin/bash
set -uo pipefail
source "$(dirname "$0")/lib.sh"

compiled() { grep -c ' Compiling ' "$LOGS/${1}__${2}__${3}.log" 2>/dev/null || echo 0; }

exp_cargo() {
  local name="$1" m="$2" sub="$3" coldall_reps="$4"; shift 4
  local extra=("$@")
  local w="$X/wt-$name"
  echo "== $name prep"
  run "$name" prep-main 0 "$m/$sub" cargo build
  for i in $(seq 1 "$REPS"); do
    if [ "$i" -le "$coldall_reps" ]; then
      rm -rf "$C/cargo"
      wt_new "$m" "$w"; [ ${#extra[@]} -gt 0 ] && clone_paths "$m" "$w" "${extra[@]}"
      run "$name" cold-all "$i" "$w/$sub" cargo build; note "$name" cold-all-compiled "$i" "$(compiled "$name" cold-all "$i")"
      wt_drop "$m" "$w"
    fi
    wt_new "$m" "$w"; [ ${#extra[@]} -gt 0 ] && clone_paths "$m" "$w" "${extra[@]}"
    run "$name" cold-target "$i" "$w/$sub" cargo build; note "$name" cold-target-compiled "$i" "$(compiled "$name" cold-target "$i")"
    wt_drop "$m" "$w"
    wt_new "$m" "$w"; [ ${#extra[@]} -gt 0 ] && clone_paths "$m" "$w" "${extra[@]}"
    run "$name" clone "$i" "$w" clone_paths "$m" "$w" "$sub/target"
    run "$name" clone-target "$i" "$w/$sub" cargo build; note "$name" clone-target-compiled "$i" "$(compiled "$name" clone-target "$i")"
    run "$name" clone-target-again "$i" "$w/$sub" cargo build
    wt_drop "$m" "$w"
  done
}

want() { [ "${1:-all}" = all ] || [ "$1" = "$2" ]; }
SEL="${1:-all}"
if want "$SEL" ripgrep; then
  exp_cargo ripgrep "$REPOS/ripgrep" . "$REPS"
fi
if want "$SEL" dreamcoder-rust; then
  M2="$REPOS/dreamcoder-rust"
  [ -d "$M2" ] || python3 -I "$TOOLS/selclone.py" "${DREAMCODER_SRC:?set DREAMCODER_SRC}" "$M2" .claude/worktrees node_modules desktop/node_modules >/dev/null
  exp_cargo dreamcoder-rust "$M2" desktop/src-tauri 1 desktop/dist desktop/src-tauri/binaries
fi
