#!/usr/bin/env sh
# Fails when the API's OpenAPI document or the generated Angular client differs
# from what is committed, and names the files that differ.
set -e
npx nx run data-access:generate --skip-nx-cache --output-style=static >/dev/null
changed=$(git status --porcelain -- apps/api/openapi.json libs/data-access/src/lib)
if [ -n "$changed" ]; then
  echo "The API contract changed but the committed document or client did not."
  echo "Run: npx nx run data-access:generate, then commit:"
  echo "$changed"
  exit 1
fi
