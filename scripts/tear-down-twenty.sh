#!/usr/bin/env bash
# Tear down the integration-test Twenty stack and remove its volumes.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$DIR/integration-twenty.compose.yml"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-twenty-mcp-it}"
docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" down -v --remove-orphans
rm -f "$DIR/.twenty.env"
