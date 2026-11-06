#!/bin/bash
set -uo pipefail
SRC="$(cd "$1" && pwd)"
T="$(cd "$(dirname "$0")" && pwd)"
W="$2"
TEST=src/server/__tests__/session-state.test.ts
export GIT_AUTHOR_NAME=bench GIT_AUTHOR_EMAIL=bench@localhost GIT_COMMITTER_NAME=bench GIT_COMMITTER_EMAIL=bench@localhost

ms() { perl -MTime::HiRes=time -e 'printf "%d\n", time()*1000'; }
avail() { df -k /System/Volumes/Data | tail -1 | awk '{print $4}'; }
step() {
  local label="$1" dir="$2"; shift 2
  local t0 t1 rc log="$W/logs/$(echo "$label" | tr ' /' '__').log"
  t0=$(ms); (cd "$dir" && "$@") >"$log" 2>&1; rc=$?; t1=$(ms)
  echo "STEP | $label | $((t1-t0)) ms | exit $rc"
}
disk() { echo "DISK | $1 | avail $(avail) KB"; }
nm_clone() {
  python3 -I "$T/selclone.py" "$SRC/node_modules" "$1/node_modules" && python3 -I "$T/selclone.py" "$SRC/desktop/node_modules" "$1/desktop/node_modules"
}

mkdir -p "$W/logs" "$W/bd"
echo "START $(date) src=$(git -C "$SRC" log -1 --format=%h)"
disk start

echo "== E3 breakdown"
for p in node_modules desktop/node_modules desktop/src-tauri/target .claude/worktrees .git; do
  step "clone $p" "$W" python3 -I "$T/selclone.py" "$SRC/$p" "$W/bd/$(echo "$p" | tr / _)"
done
step "clone rest (skip the 5 above)" "$W" python3 -I "$T/selclone.py" "$SRC" "$W/bd/rest" node_modules desktop/node_modules desktop/src-tauri/target .claude/worktrees .git
disk "after breakdown"
rm -rf "$W/bd"
disk "after removing breakdown"

echo "== E3 variant C"
step "C-notarget clone (skip worktrees+target)" "$W" python3 -I "$T/selclone.py" "$SRC" "$W/c1" .claude/worktrees desktop/src-tauri/target
disk "after C-notarget"
step "C-target clone (skip worktrees)" "$W" python3 -I "$T/selclone.py" "$SRC" "$W/c2" .claude/worktrees
disk "after C-target"
step "C-notarget run test" "$W/c1" bun test "$TEST"

echo "== E4 target reuse in C-target"
step "C-target cargo build (debug)" "$W/c2/desktop/src-tauri" cargo build
grep -c 'Compiling' "$W/logs/C-target_cargo_build_(debug).log" | sed 's/^/COMPILING | C-target | /'
step "C-target cargo build again" "$W/c2/desktop/src-tauri" cargo build
disk "after E4"

echo "== E2 variant A"
step "A git worktree add" "$W/c2" git worktree add -q --detach "$W/wtA" HEAD
step "A clone node_modules x2" "$W" nm_clone "$W/wtA"
step "A run test" "$W/wtA" bun test "$TEST"
step "A bun install verify root" "$W/wtA" bun install --frozen-lockfile
disk "after A"

echo "== E1 baseline worktree"
step "B1 git worktree add" "$W/c2" git worktree add -q --detach "$W/wt1" HEAD
disk "after B1 worktree add"
step "B1 bun install root" "$W/wt1" bun install --frozen-lockfile
step "B1 bun install desktop" "$W/wt1/desktop" bun install --frozen-lockfile
step "B1 run test" "$W/wt1" bun test "$TEST"
disk "after B1 installs"
step "B1 desktop vite build" "$W/wt1/desktop" bun run build
step "B1 build sidecars" "$W/wt1/desktop" bun run build:sidecars
step "B1 cargo build (debug, cold)" "$W/wt1/desktop/src-tauri" cargo build
grep -c 'Compiling' "$W/logs/B1_cargo_build_(debug,_cold).log" | sed 's/^/COMPILING | B1 | /'
disk "after B1 cargo"

echo "== E5 alternates vs gc"
R="$W/c1"
step "E5 make branch commit" "$R" bash -c 'git switch -q -c e5-tmp && echo "e5 unique $(date +%s%N)" > e5-unique.txt && git add e5-unique.txt && git commit -q -m e5'
BLOB=$(git -C "$R" rev-parse HEAD:e5-unique.txt)
SH="$W/e5-shadow.git"
git init -q --bare "$SH"
echo "$R/.git/objects" > "$SH/objects/info/alternates"
GIT_INDEX_FILE="$W/e5-idx" git --git-dir="$SH" --work-tree="$R" add -A
TREE=$(GIT_INDEX_FILE="$W/e5-idx" git --git-dir="$SH" --work-tree="$R" write-tree)
echo "E5 | blob in shadow's own store before gc: $(find "$SH/objects" -type f -path "*${BLOB:0:2}/${BLOB:2}" | wc -l | tr -d ' ')"
echo "E5 | shadow can read blob before gc: $(git --git-dir="$SH" cat-file -e "$BLOB" && echo yes || echo no)"
step "E5 delete branch and gc" "$R" bash -c 'git switch -q --detach main 2>/dev/null || git switch -q --detach HEAD~1; git branch -q -D e5-tmp; git reflog expire --expire=now --all; git gc -q --prune=now'
echo "E5 | shadow can read blob after gc: $(git --git-dir="$SH" cat-file -e "$BLOB" 2>/dev/null && echo yes || echo no)"
echo "E5 | shadow fsck of base tree: $(git --git-dir="$SH" ls-tree -r "$TREE" >/dev/null 2>&1 && git --git-dir="$SH" fsck --no-dangling >/dev/null 2>&1 && echo ok || echo BROKEN)"

disk end
echo "END $(date)"
