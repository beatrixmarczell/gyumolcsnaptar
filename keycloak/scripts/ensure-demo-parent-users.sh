#!/usr/bin/env bash
# Létrehozza vagy frissíti a szulo1.demo … szulo4.demo teszt usereket a konténerben futó Keycloakban.
# Futtatás a repo gyökeréből:  bash keycloak/scripts/ensure-demo-parent-users.sh
# Előfeltétel:  npm run infra:up  (Keycloak elérhető a 8080-on a konténerben)

set -euo pipefail

COMPOSE_FILE="keycloak/docker-compose.yml"
KC="/opt/keycloak/bin/kcadm.sh"
R="gyumolcsnaptar"

if ! docker compose -f "$COMPOSE_FILE" ps --status running -q keycloak >/dev/null 2>&1; then
  echo "Keycloak konténer nem fut. Indítsd: npm run infra:up" >&2
  exit 1
fi

docker compose -f "$COMPOSE_FILE" exec -T keycloak "$KC" config credentials \
  --server http://localhost:8080 --realm master --user admin --password admin

ensure_user() {
  local user="$1" email="$2" last="$3"
  local json
  json="$(docker compose -f "$COMPOSE_FILE" exec -T keycloak "$KC" get users -r "$R" -q "username=$user" 2>/dev/null || true)"
  if echo "$json" | grep -q '"username"'; then
    echo "OK (már létezik): $user"
  else
    echo "Létrehozás: $user"
    docker compose -f "$COMPOSE_FILE" exec -T keycloak "$KC" create users -r "$R" \
      -s "username=$user" \
      -s enabled=true \
      -s "email=$email" \
      -s firstName=Teszt \
      -s "lastName=$last" \
      -s emailVerified=true
  fi
  docker compose -f "$COMPOSE_FILE" exec -T keycloak "$KC" set-password -r "$R" --username "$user" --new-password 'ChangeMe123!'
  docker compose -f "$COMPOSE_FILE" exec -T keycloak "$KC" add-roles -r "$R" --uusername "$user" --rolename editor || true
}

ensure_user "szulo1.demo" "szulo1@example.com" "Szülő 1"
ensure_user "szulo2.demo" "szulo2@example.com" "Szülő 2"
ensure_user "szulo3.demo" "szulo3@example.com" "Szülő 3"
ensure_user "szulo4.demo" "szulo4@example.com" "Szülő 4"

echo "Kész. Belépés: szulo2.demo / ChangeMe123!"
