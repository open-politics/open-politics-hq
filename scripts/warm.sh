#!/usr/bin/env bash
#
# Warm the dev frontend: request the core pages so Turbopack compiles them
# now instead of on your first click. Auth lives client-side (localStorage
# token, no middleware), so the server renders and compiles each route for an
# anonymous request — no login needed.
#
#   scripts/warm.sh                     # default pages
#   scripts/warm.sh /hq/chat /hq/search # these instead
#
# From your machine: ssh <host> 'cd ~/open-politics-hq && scripts/warm.sh'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="$(grep -E '^FRONTEND_PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2)"
BASE="http://127.0.0.1:${PORT:-3000}"

PAGES=("$@")
[ ${#PAGES[@]} -eq 0 ] && PAGES=(
  /hq
  /hq/infospaces/asset-manager
  /hq/infospaces/annotation-runner
)

for page in "${PAGES[@]}"; do
  html="$(curl -s --max-time 600 -w '\n%{http_code} %{time_total}' "$BASE$page")"
  read -r code secs <<< "$(tail -n1 <<< "$html")"
  # The page's client chunks: cheap once the route is compiled, but fetching
  # them makes sure the browser's first load serves nothing cold.
  grep -oE '/_next/static/[^"\\ ]+\.(js|css)' <<< "$html" | sort -u |
    xargs -r -P 8 -I{} curl -s -o /dev/null --max-time 120 "$BASE{}"
  printf '%-40s %s  %6.1fs\n' "$page" "$code" "$secs"
done
