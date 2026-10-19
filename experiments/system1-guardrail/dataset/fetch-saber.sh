#!/bin/sh
# Download the recorded SABER runs this dataset is built from, pinned to one
# commit, into the gitignored .saber/ next to this script. Only the folders
# the conversion reads are checked out (about 650 MB on disk, about 100 MB
# downloaded); the 480 MB baselines/ folder and the submodules are skipped.
set -eu
COMMIT=f34f88636fb327e00f06d72624fde3e86f371036
DEST="$(cd "$(dirname "$0")" && pwd)/.saber"
if [ -e "$DEST" ]; then
  echo "$DEST already exists" >&2
  exit 1
fi
git init -q "$DEST"
git -C "$DEST" remote add origin https://github.com/sssr-lab/saber.git
git -C "$DEST" sparse-checkout set results judged human_judge dataset tasks LICENSES
git -C "$DEST" fetch -q --depth 1 --filter=blob:none origin "$COMMIT"
git -C "$DEST" checkout -q FETCH_HEAD
du -sh "$DEST"
