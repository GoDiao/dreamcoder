#!/bin/bash
set -uo pipefail
source "$(dirname "$0")/lib.sh"

GRADLE_ARGS=(--no-daemon --console=plain -Pkotlin.compiler.execution.strategy=in-process :okhttp:compileKotlinJvm)
gsummary() { grep -E 'actionable tasks' "$LOGS/${1}__${2}__${3}.log" | tail -1; }

exp_global() {
  local name="$1" m="$2" wipe="$3"; shift 3
  local cmd=("$@")
  local w="$X/wt-$name"
  echo "== $name prep"
  run "$name" prep-main 0 "$m" "${cmd[@]}"
  for i in $(seq 1 "$REPS"); do
    rm -rf $wipe
    wt_new "$m" "$w"; run "$name" cold "$i" "$w" "${cmd[@]}"; [ "$name" = gradle ] && note "$name" cold-tasks "$i" "$(gsummary "$name" cold "$i")"; wt_drop "$m" "$w"
    wt_new "$m" "$w"; run "$name" warm-worktree "$i" "$w" "${cmd[@]}"; [ "$name" = gradle ] && note "$name" warm-worktree-tasks "$i" "$(gsummary "$name" warm-worktree "$i")"; wt_drop "$m" "$w"
    rm -rf "$w"
    run "$name" clone "$i" "$X" python3 -I "$TOOLS/selclone.py" "$m" "$w"
    run "$name" warm-clone "$i" "$w" "${cmd[@]}"; [ "$name" = gradle ] && note "$name" warm-clone-tasks "$i" "$(gsummary "$name" warm-clone "$i")"
    rm -rf "$w"
  done
}

want() { [ "${1:-all}" = all ] || [ "$1" = "$2" ]; }
SEL="${1:-all}"
if want "$SEL" go; then
  exp_global go "$REPOS/cli" "$C/gocache $C/gopath" go build -o bin/gh ./cmd/gh
fi
if want "$SEL" gradle; then
  exp_global gradle "$REPOS/okhttp" "$C/gradle" ./gradlew "${GRADLE_ARGS[@]}"
  note gradle leftover-java-processes 0 "$(pgrep -f "$C/gradle" | wc -l | tr -d ' ')"
fi
