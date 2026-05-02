# Keycloak: szulo1..4 demo userek létrehozása/frissítése (Windows / PowerShell).
# Futtatás repo gyökérből:  pwsh -File keycloak/scripts/ensure-demo-parent-users.ps1
# Előfeltétel:  npm run infra:up

$ErrorActionPreference = "Stop"
$compose = "keycloak/docker-compose.yml"
$kc = "/opt/keycloak/bin/kcadm.sh"
$r = "gyumolcsnaptar"

$running = docker compose -f $compose ps --status running -q keycloak 2>$null
if (-not $running) {
  Write-Error "Keycloak konténer nem fut. Indítsd: npm run infra:up"
}

docker compose -f $compose exec -T keycloak $kc config credentials `
  --server http://localhost:8080 --realm master --user admin --password admin

function Ensure-User($user, $email, $last) {
  $json = docker compose -f $compose exec -T keycloak $kc get users -r $r -q "username=$user" 2>$null
  if ($json -match '"username"') {
    Write-Host "OK (már létezik): $user"
  }
  else {
    Write-Host "Létrehozás: $user"
    docker compose -f $compose exec -T keycloak $kc create users -r $r `
      -s "username=$user" `
      -s enabled=true `
      -s "email=$email" `
      -s firstName=Teszt `
      -s "lastName=$last" `
      -s emailVerified=true
  }
  docker compose -f $compose exec -T keycloak $kc set-password -r $r --username $user --new-password "ChangeMe123!"
  docker compose -f $compose exec -T keycloak $kc add-roles -r $r --uusername $user --rolename editor 2>$null
}

Ensure-User "szulo1.demo" "szulo1@example.com" "Szülő 1"
Ensure-User "szulo2.demo" "szulo2@example.com" "Szülő 2"
Ensure-User "szulo3.demo" "szulo3@example.com" "Szülő 3"
Ensure-User "szulo4.demo" "szulo4@example.com" "Szülő 4"

Write-Host "Kész. Belépés: szulo2.demo / ChangeMe123!"
