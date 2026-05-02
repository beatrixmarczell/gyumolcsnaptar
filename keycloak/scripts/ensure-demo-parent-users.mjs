/**
 * szulo1.demo … szulo4.demo Keycloak userek – Docker + kcadm (Windows/macOS/Linux).
 * Futtatás: npm run infra:keycloak-demo-parents
 */
import { execSync } from 'node:child_process'

const compose = 'keycloak/docker-compose.yml'
const kc = '/opt/keycloak/bin/kcadm.sh'
const realm = 'gyumolcsnaptar'

function run(cmd) {
  execSync(cmd, { stdio: 'inherit', shell: true })
}

function capture(cmd) {
  return execSync(cmd, { encoding: 'utf8', shell: true })
}

try {
  capture(`docker compose -f ${compose} ps --status running -q keycloak`)
} catch {
  console.error('Keycloak konténer nem fut. Indítsd: npm run infra:up')
  process.exit(1)
}

run(
  `docker compose -f ${compose} exec -T keycloak ${kc} config credentials --server http://localhost:8080 --realm master --user admin --password admin`,
)

const users = [
  ['szulo1.demo', 'szulo1@example.com'],
  ['szulo2.demo', 'szulo2@example.com'],
  ['szulo3.demo', 'szulo3@example.com'],
  ['szulo4.demo', 'szulo4@example.com'],
]

for (const [username, email] of users) {
  const json = capture(
    `docker compose -f ${compose} exec -T keycloak ${kc} get users -r ${realm} -q username=${username}`,
  )
  if (json.includes('"username"')) {
    console.log(`OK (már létezik): ${username}`)
  } else {
    console.log(`Létrehozás: ${username}`)
    run(
      `docker compose -f ${compose} exec -T keycloak ${kc} create users -r ${realm} -s username=${username} -s enabled=true -s email=${email} -s emailVerified=true`,
    )
  }
  run(
    `docker compose -f ${compose} exec -T keycloak ${kc} set-password -r ${realm} --username ${username} --new-password ChangeMe123!`,
  )
  try {
    run(
      `docker compose -f ${compose} exec -T keycloak ${kc} add-roles -r ${realm} --uusername ${username} --rolename editor`,
    )
  } catch {
    /* szerep már hozzárendelve */
  }
}

console.log('Kész. Belépés: szulo2.demo / ChangeMe123!')
