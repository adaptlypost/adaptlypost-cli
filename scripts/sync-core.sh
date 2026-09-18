#!/bin/sh
set -eu
SRC="${CORE_SRC:-../../adaptlypost/adaptlypost-cli/src/core}"

if [ ! -d "$SRC" ]; then
  echo "canonical core not found at $SRC, set CORE_SRC" >&2
  exit 1
fi

rsync -a --delete "$SRC/" src/core/

git diff --quiet src/core || echo "core updated, review and commit"
