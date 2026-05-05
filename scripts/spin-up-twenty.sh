#!/usr/bin/env bash
# Spin up a clean Twenty stack for integration tests, sign up an admin,
# mint an API key, and write the key + base URL to ./twenty.env.
#
# Usage:
#   TWENTY_TAG=v2.2.0 scripts/spin-up-twenty.sh
#   scripts/spin-up-twenty.sh   # defaults to v2.2.0
#
# Env vars produced (in $OUT_FILE, default scripts/.twenty.env):
#   TWENTY_BASE_URL=http://127.0.0.1:3300
#   TWENTY_API_KEY=<jwt>
#   TWENTY_TAG=<resolved tag>
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$DIR/integration-twenty.compose.yml"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-twenty-mcp-it}"
OUT_FILE="${OUT_FILE:-$DIR/.twenty.env}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@twenty-mcp.test}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-TestPassword123!}"
TWENTY_TAG="${TWENTY_TAG:-v2.2.0}"
BASE_URL="http://127.0.0.1:3300"

export TWENTY_TAG
export APP_SECRET="${APP_SECRET:-$(openssl rand -base64 32)}"
export PG_DATABASE_PASSWORD="${PG_DATABASE_PASSWORD:-$(openssl rand -hex 32)}"

echo "[twenty] tag=$TWENTY_TAG project=$COMPOSE_PROJECT"
# Always start from clean volumes so APP_SECRET/PG password rotation can't
# desync the postgres data file. Use scripts/tear-down-twenty.sh between
# runs if you need a persistent stack.
docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" down -v --remove-orphans >/dev/null 2>&1 || true
docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" up -d --quiet-pull

echo "[twenty] waiting for healthz..."
for i in $(seq 1 120); do
  if curl -fsS "$BASE_URL/healthz" >/dev/null 2>&1; then
    echo "[twenty] healthy after ${i}s"
    break
  fi
  if [ "$i" -eq 120 ]; then
    echo "[twenty] never became healthy" >&2
    docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" logs --tail=80 server >&2
    exit 1
  fi
  sleep 1
done

curl_meta() {
  local query="$1"; shift
  local extra=()
  if [ "$#" -gt 0 ] && [ -n "$1" ]; then
    extra+=(-H "authorization: Bearer $1")
  fi
  curl -fsS -X POST "$BASE_URL/metadata" \
    -H 'content-type: application/json' \
    ${extra[@]+"${extra[@]}"} \
    --data "$(jq -nc --arg q "$query" '{query:$q}')"
}

echo "[twenty] signing up $ADMIN_EMAIL"
SIGNUP=$(curl_meta "mutation { signUp(email: \"$ADMIN_EMAIL\", password: \"$ADMIN_PASSWORD\") { tokens { accessOrWorkspaceAgnosticToken { token } } } }")
WA=$(jq -er '.data.signUp.tokens.accessOrWorkspaceAgnosticToken.token' <<<"$SIGNUP")

echo "[twenty] creating workspace"
WS=$(curl_meta "mutation { signUpInNewWorkspace { loginToken { token } workspace { id } } }" "$WA")
LT=$(jq -er '.data.signUpInNewWorkspace.loginToken.token' <<<"$WS")

echo "[twenty] exchanging login token for access token"
EX=$(curl_meta "mutation { getAuthTokensFromLoginToken(loginToken: \"$LT\", origin: \"$BASE_URL\") { tokens { accessOrWorkspaceAgnosticToken { token } } } }")
ACCESS=$(jq -er '.data.getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token' <<<"$EX")

echo "[twenty] activating workspace"
curl_meta "mutation { activateWorkspace(data: { displayName: \"Integration Test\" }) { id } }" "$ACCESS" >/dev/null

echo "[twenty] creating Admin-role API key"
ADMIN_ROLE_ID=$(curl_meta "{ getRoles { id label } }" "$ACCESS" | jq -er '.data.getRoles[] | select(.label=="Admin") | .id')
EXP=$(date -u -v+1d +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -d '+1 day' +%Y-%m-%dT%H:%M:%S.000Z)
APIKEY_ID=$(curl_meta "mutation { createApiKey(input: { name: \"integration-test\", expiresAt: \"$EXP\", roleId: \"$ADMIN_ROLE_ID\" }) { id } }" "$ACCESS" | jq -er '.data.createApiKey.id')
TOKEN=$(curl_meta "mutation { generateApiKeyToken(apiKeyId: \"$APIKEY_ID\", expiresAt: \"$EXP\") { token } }" "$ACCESS" | jq -er '.data.generateApiKeyToken.token')

cat > "$OUT_FILE" <<EOF
TWENTY_BASE_URL=$BASE_URL
TWENTY_API_KEY=$TOKEN
TWENTY_TAG=$TWENTY_TAG
TWENTY_ADMIN_ACCESS_TOKEN=$ACCESS
EOF
chmod 600 "$OUT_FILE"
echo "[twenty] wrote $OUT_FILE"
echo "[twenty] API_KEY=${TOKEN:0:24}..."
