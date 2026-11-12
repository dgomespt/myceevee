#!/usr/bin/env bash
# Clears the running server's in-memory gist + photo caches (CVs are rebuilt from the gist on every request, so
# nothing else is cached) by doing what the admin page's
# "Refresh from gist" button does: log in with ADMIN_TOKEN and POST the refresh action.
# Usage: scripts/refresh-server-cache.sh [base-url]     (default http://localhost:${PORT:-4321})
set -u

url="${1:-http://localhost:${PORT:-4321}}"
url="${url%/}"

# ADMIN_TOKEN: from the environment, else from .env
token="${ADMIN_TOKEN:-}"
if [ -z "$token" ] && [ -f .env ]; then
  token="$(grep -E '^ADMIN_TOKEN=' .env | tail -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"
fi
if [ -z "$token" ]; then
  echo "ADMIN_TOKEN not found (set it in .env or the environment)." >&2
  exit 1
fi

# Log in; the session cookie is read from the response headers so this also works when the cookie is marked Secure.
headers="$(curl -s -i --max-time 10 -X POST -H "Origin: $url" --data-urlencode "token=$token" "$url/admin/login")" || {
  echo "No server is answering at $url, so there is no in-memory cache to clear (it starts empty)."
  exit 0
}
status="$(printf '%s' "$headers" | head -1 | awk '{print $2}')"
case "$status" in
  303) ;;
  401) echo "Login was rejected: ADMIN_TOKEN does not match the one the server is running with." >&2; exit 1 ;;
  429) echo "Login is rate limited. Wait a few minutes and try again." >&2; exit 1 ;;
  *)   echo "Unexpected response $status from $url/admin/login. Is that the myceevee server (try PORT=...)?" >&2; exit 1 ;;
esac
cookie="$(printf '%s' "$headers" | tr -d '\r' | grep -i '^set-cookie: myceevee_session=' | head -1 | sed -E 's/^[^:]*: *//; s/;.*//')"
if [ -z "$cookie" ]; then echo "Logged in but no session cookie was returned." >&2; exit 1; fi

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST -H "Origin: $url" -H "Cookie: $cookie" \
  --data-urlencode 'action=refresh' "$url/admin")"
if [ "$code" = "303" ]; then
  echo "Cleared the gist and photo caches on $url."
else
  echo "Refresh failed (HTTP $code)." >&2
  exit 1
fi
