#!/bin/bash
set -uo pipefail
source "$(dirname "$0")/lib.sh"

abs_links() { find "$1" -type l -lname "$2*" 2>/dev/null | wc -l | tr -d ' '; }
abs_text() { grep -rlsI --exclude-dir=.git -F "$2" "$1" 2>/dev/null | wc -l | tr -d ' '; }

exp_deps() {
  local name="$1" m="$2" depname="$3" wipe="$4" install="$5" verify="$6"
  local w="$X/wt-$name"
  echo "== $name prep"
  run "$name" prep-main 0 "$m" bash -c "$install"
  local deps; deps=$(dirs_named "$m" "$depname" | tr '\n' ' ')
  note "$name" deps 0 "$deps"
  for i in $(seq 1 "$REPS"); do
    rm -rf $wipe
    wt_new "$m" "$w"; run "$name" cold "$i" "$w" bash -c "$install"; wt_drop "$m" "$w"
    wt_new "$m" "$w"; run "$name" warm "$i" "$w" bash -c "$install"; wt_drop "$m" "$w"
    wt_new "$m" "$w"
    run "$name" clone "$i" "$w" clone_paths "$m" "$w" $deps
    run "$name" clone-verify "$i" "$w" bash -c "$verify"
    if [ "$i" = 1 ]; then
      note "$name" clone-abs-symlinks-to-main 1 "$(for d in $deps; do abs_links "$w/$d" "$m"; done | paste -sd+ - | bc)"
      note "$name" clone-text-files-mentioning-main 1 "$(for d in $deps; do abs_text "$w/$d" "$m"; done | paste -sd+ - | bc)"
    fi
    wt_drop "$m" "$w"
  done
}

prep_bun_main() {
  local m="$REPOS/dreamcoder"
  [ -d "$m" ] || python3 -I "$TOOLS/selclone.py" "${DREAMCODER_SRC:?set DREAMCODER_SRC}" "$m" .claude/worktrees desktop/src-tauri/target node_modules desktop/node_modules >/dev/null
}

want() { [ "${1:-all}" = all ] || [ "$1" = "$2" ]; }
SEL="${1:-all}"
if want "$SEL" bun; then
  prep_bun_main
  exp_deps bun "$REPOS/dreamcoder" node_modules "$C/bun" \
    "bun install --frozen-lockfile && cd desktop && bun install --frozen-lockfile" \
    "bun install --frozen-lockfile && cd desktop && bun install --frozen-lockfile"
fi
if want "$SEL" npm; then
  exp_deps npm "$REPOS/nest" node_modules "$C/npm" \
    "npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund" \
    "npm install --legacy-peer-deps --ignore-scripts --no-audit --no-fund --prefer-offline"
fi
if want "$SEL" pnpm; then
  exp_deps pnpm "$REPOS/vite" node_modules "$C/pnpm-store $C/pnpm-cache $C/pnpm-state $C/xdg-cache $C/xdg-data $C/xdg-state" \
    "corepack pnpm@12.14.0 install --frozen-lockfile --ignore-scripts" \
    "corepack pnpm@12.14.0 install --frozen-lockfile --ignore-scripts --offline"
fi
if want "$SEL" uv; then
  export UV_PYTHON="${BENCH_PYTHON:-python3.13}"; exp_deps uv "$REPOS/fastapi" .venv "$C/uv" \
    "uv sync --frozen" \
    "uv sync --frozen --offline && .venv/bin/python -c 'import fastapi;print(fastapi.__file__)'"
fi
