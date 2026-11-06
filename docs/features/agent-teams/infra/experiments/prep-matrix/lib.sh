X="${BENCH_DIR:?set BENCH_DIR to a scratch directory}"
REPOS="$X/repos"
C="$X/caches"
RESULTS="$X/results.tsv"
LOGS="$X/logs"
TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPS="${REPS:-3}"
mkdir -p "$C" "$LOGS" "$X/home"

export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
export JAVA_HOME="${JAVA_HOME:?set JAVA_HOME to a JDK 21}"
export HOME="$X/home"
export BUN_INSTALL_CACHE_DIR="$C/bun"
export npm_config_cache="$C/npm"
export npm_config_store_dir="$C/pnpm-store"
export npm_config_cache_dir="$C/pnpm-cache"
export npm_config_state_dir="$C/pnpm-state"
export npm_config_manage_package_manager_versions=false
export npm_config_update_notifier=false
export XDG_CACHE_HOME="$C/xdg-cache" XDG_DATA_HOME="$C/xdg-data" XDG_STATE_HOME="$C/xdg-state" XDG_CONFIG_HOME="$C/xdg-config"
export COREPACK_HOME="$X/corepack" COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export UV_CACHE_DIR="$C/uv" UV_PYTHON_DOWNLOADS=never UV_PYTHON_INSTALL_DIR="$C/uv-python" UV_NO_PROGRESS=1
export CARGO_HOME="$C/cargo"
export GOPATH="$C/gopath" GOMODCACHE="$C/gopath/pkg/mod" GOCACHE="$C/gocache" GOTOOLCHAIN=local GOFLAGS=-modcacherw
export GRADLE_USER_HOME="$C/gradle"
export GIT_AUTHOR_NAME=bench GIT_AUTHOR_EMAIL=bench@localhost GIT_COMMITTER_NAME=bench GIT_COMMITTER_EMAIL=bench@localhost

ms() { perl -MTime::HiRes=time -e 'printf "%d\n", time()*1000'; }

run() {
  local exp="$1" variant="$2" rep="$3" dir="$4"; shift 4
  local log="$LOGS/${exp}__${variant}__${rep}.log" t0 t1 rc
  t0=$(ms); (cd "$dir" && "$@") >"$log" 2>&1; rc=$?; t1=$(ms)
  printf "%s\t%s\t%s\t%s\t%s\n" "$exp" "$variant" "$rep" "$((t1-t0))" "$rc" | tee -a "$RESULTS"
  return $rc
}

note() { printf "%s\t%s\t%s\tNOTE\t%s\n" "$1" "$2" "$3" "$4" | tee -a "$RESULTS"; }

wt_new() {
  local src="$1" dst="$2"
  rm -rf "$dst"
  git -C "$src" worktree prune
  git -C "$src" worktree add -q --detach "$dst" HEAD
}

wt_drop() { git -C "$1" worktree remove --force "$2" 2>/dev/null; rm -rf "$2"; git -C "$1" worktree prune; }

clone_paths() {
  local src="$1" dst="$2"; shift 2
  for p in "$@"; do
    mkdir -p "$(dirname "$dst/$p")"
    rm -rf "$dst/$p"
    python3 -I "$TOOLS/selclone.py" "$src/$p" "$dst/$p" >/dev/null || return 1
  done
}

dirs_named() { (cd "$1" && find . -name "$2" -type d -prune -not -path './.git/*' | sed 's|^\./||' | while read -r d; do [ -z "$(git ls-files "$d" | head -1)" ] && echo "$d"; done); }
