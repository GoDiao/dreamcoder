#!/bin/bash
set -euo pipefail
X="${BENCH_DIR:?set BENCH_DIR to a scratch directory}"
mkdir -p "$X/repos"
cd "$X/repos"
for r in nestjs/nest vitejs/vite fastapi/fastapi BurntSushi/ripgrep cli/cli square/okhttp; do
  n="${r#*/}"
  [ -d "$n" ] || git clone -q --depth 1 "https://github.com/$r.git" "$n"
  echo "$n $(git -C "$n" log -1 --format='%h %cs')"
done
cd okhttp
if grep -q '^toolchainVendor=' gradle/gradle-daemon-jvm.properties; then
  sed -i '' '/^toolchainVendor=/d' gradle/gradle-daemon-jvm.properties
  GIT_AUTHOR_NAME=bench GIT_AUTHOR_EMAIL=bench@localhost GIT_COMMITTER_NAME=bench GIT_COMMITTER_EMAIL=bench@localhost git commit -qam "bench: drop daemon JVM vendor pin"
fi
