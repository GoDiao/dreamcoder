#!/bin/bash
set -euo pipefail

SRC="$(cd "$1" && pwd)"
WORK="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC_GIT="$(git -C "$SRC" rev-parse --path-format=absolute --git-common-dir)"
L="$WORK/lab"
SH="$L/shadow.git"
FAST="-c core.checkStat=minimal -c core.trustctime=false"

ms() { perl -MTime::HiRes=time -e 'printf "%d\n", time()*1000'; }
run() {
  local label="$1"; shift
  local t0 t1
  t0=$(ms); "$@" >"$L/out.txt" 2>"$L/err.txt" || { echo "FAIL $label"; cat "$L/err.txt"; exit 1; }; t1=$(ms)
  echo "$label: $((t1-t0)) ms"
}
g() { local sh="$1" wt="$2" idx="$3"; shift 3; GIT_INDEX_FILE="$idx" git --git-dir="$sh" --work-tree="$wt" "$@"; }
snap() { local sh="$1" wt="$2" idx="$3" extra="${4:-}"; g "$sh" "$wt" "$idx" $extra add -A && g "$sh" "$wt" "$idx" write-tree; }
shadow() {
  git init -q --bare "$1"
  cp "$SRC_GIT/info/exclude" "$1/info/exclude"
  git --git-dir="$1" config user.name shadow
  git --git-dir="$1" config user.email shadow@localhost
  git --git-dir="$1" config core.autocrlf "$(git --git-dir="$SRC_GIT" config core.autocrlf || echo false)"
  git --git-dir="$1" config core.filemode "$(git --git-dir="$SRC_GIT" config core.filemode || echo true)"
}

if [ -e "$L" ]; then echo "$L exists, remove it first"; exit 1; fi
mkdir -p "$L"
python3 -I "$HERE/clone.py" "$SRC" "$L/base"
python3 -I "$HERE/clone.py" "$L/base" "$L/member"
B="$L/base"
M="$L/member"
shadow "$SH"

echo "== base snapshot"
run "base fresh add+write-tree" snap "$SH" "$B" "$L/idx-base"
BASE_TREE=$(g "$SH" "$B" "$L/idx-base" write-tree)
echo "files in tree: $(git --git-dir="$SH" ls-tree -r "$BASE_TREE" | wc -l | tr -d ' ')"
echo "shadow size: $(du -sk "$SH" | cut -f1) KB"
run "base re-snapshot, no change" snap "$SH" "$B" "$L/idx-base"

echo "== member edits"
for f in src/utils/cwd.ts src/utils/worktree.ts src/server/services/teamService.ts desktop/src/stores/teamStore.ts README.md; do echo "// member edit" >> "$M/$f"; done
printf 'export const a = 1\n' > "$M/src/utils/newFileA.ts"
printf 'export const b = 2\n' > "$M/src/utils/newFileB.ts"
rm "$M/LICENSE"
mv "$M/PRIVACY.md" "$M/PRIVACY-renamed.md"
mkdir -p "$M/node_modules"
printf 'x\n' > "$M/node_modules/.member-ignored-file"

echo "== member snapshot"
run "member, fresh index" snap "$SH" "$M" "$L/idx-m1"
cp "$L/idx-base" "$L/idx-m2"
run "member, base index copy, default checkStat" snap "$SH" "$M" "$L/idx-m2"
cp "$L/idx-base" "$L/idx-m3"
run "member, base index copy, checkStat=minimal" snap "$SH" "$M" "$L/idx-m3" "$FAST"
MEM_TREE=$(g "$SH" "$M" "$L/idx-m3" write-tree)
run "member re-snapshot, no change" snap "$SH" "$M" "$L/idx-m3" "$FAST"

echo "== diff base vs member"
run "diff-tree -r -M" git --git-dir="$SH" diff-tree -r -M --name-status "$BASE_TREE" "$MEM_TREE"
cat "$L/out.txt"

echo "== reference: git status"
run "git status in member clone, first" git -C "$M" status --porcelain
run "git status in member clone, second" git -C "$M" status --porcelain
run "git status in source, read-only" git --no-optional-locks -C "$SRC" status --porcelain

echo "== alternates"
shadow "$L/alt.git"
echo "$SRC_GIT/objects" > "$L/alt.git/objects/info/alternates"
run "member fresh snapshot with alternates" snap "$L/alt.git" "$M" "$L/idx-alt"
echo "alternates shadow size: $(du -sk "$L/alt.git" | cut -f1) KB"

echo "== three-way merge"
echo "// lead edit at end" >> "$B/src/utils/worktree.ts"
python3 -I - "$B/src/utils/cwd.ts" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read().split('\n')
s[0] = "import { AsyncLocalStorage } from 'node:async_hooks'"
open(p, 'w').write('\n'.join(s))
PY
echo "// lead conflicting edit" >> "$B/README.md"
run "base re-snapshot after lead edits" snap "$SH" "$B" "$L/idx-base" "$FAST"
MAIN_TREE=$(g "$SH" "$B" "$L/idx-base" write-tree)
C0=$(echo base | git --git-dir="$SH" commit-tree "$BASE_TREE")
C1=$(echo main | git --git-dir="$SH" commit-tree -p "$C0" "$MAIN_TREE")
C2=$(echo member | git --git-dir="$SH" commit-tree -p "$C0" "$MEM_TREE")
t0=$(ms); set +e; git --git-dir="$SH" merge-tree --write-tree --name-only "$C1" "$C2" > "$L/merge.txt"; rc=$?; set -e; t1=$(ms)
echo "merge-tree --write-tree: $((t1-t0)) ms (exit $rc)"
cat "$L/merge.txt"

echo "== done; remove $L when finished"
