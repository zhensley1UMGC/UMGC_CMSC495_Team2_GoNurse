#!/usr/bin/env bash
set -euo pipefail

destination="${1:?Pass an empty destination directory}"
: "${COMMIT_SHA:?Set COMMIT_SHA}"
: "${RUN_NUMBER:?Set RUN_NUMBER}"
: "${RUN_ATTEMPT:?Set RUN_ATTEMPT}"

if [[ "$COMMIT_SHA" != "$(git rev-parse HEAD)" ]]; then
  echo "COMMIT_SHA does not match the checked-out commit." >&2
  exit 1
fi
if [[ -e "$destination" ]] && [[ -n "$(find "$destination" -mindepth 1 -print -quit)" ]]; then
  echo "The destination must be empty." >&2
  exit 1
fi

test -f Prototype/frontend/dist/index.html
test -f Prototype/frontend/dist/tabbed.html
mkdir -p "$destination/frontend" "$destination/backend"
cp -R Prototype/frontend/dist "$destination/frontend/"
cp Prototype/frontend/package.json Prototype/frontend/package-lock.json \
  Prototype/frontend/vite.config.js "$destination/frontend/"
cp Prototype/backend/requirements.in Prototype/backend/requirements.txt "$destination/backend/"
cp Prototype/RELEASE_CANDIDATE.md "$destination/README.md"

while IFS= read -r -d '' file; do
  case "$file" in
    *.py)
      relative="${file#Prototype/backend/}"
      install -D "$file" "$destination/backend/$relative"
      ;;
  esac
done < <(git ls-files -z -- Prototype/backend/app)
test -f "$destination/backend/app/main.py"

cat > "$destination/RELEASE_INFO.txt" <<EOF
GoNurse release candidate - not a deployment
Commit SHA: $COMMIT_SHA
Workflow run number: $RUN_NUMBER
Workflow run attempt: $RUN_ATTEMPT
EOF

if find "$destination" \( -type l -o -name '.env*' -o -name '*.pem' -o -name '*.key' \) -print -quit | grep -q .; then
  echo "Release candidate contains a prohibited file or symbolic link." >&2
  exit 1
fi
