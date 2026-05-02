/**
 * Keycloak demó szülő fiókok (szulo1.demo …) — a token-alapú név egyezés itt nem működik,
 * mert a megjelenített név „Szülő 2”, nem tartalmazza a gyerek nevét. Egyezik a DB seeddel.
 */
const BY_USERNAME: Record<string, string> = {
  'szulo1.demo': 'Marczell Zsombor Dániel',
  'szulo2.demo': 'Baló Olívia',
  'szulo3.demo': 'Burik Bendegúz',
  'szulo4.demo': 'Czakó Adél Luca',
}

const BY_EMAIL: Record<string, string> = {
  'szulo1@example.com': 'Marczell Zsombor Dániel',
  'szulo2@example.com': 'Baló Olívia',
  'szulo3@example.com': 'Burik Bendegúz',
  'szulo4@example.com': 'Czakó Adél Luca',
}

export function resolveDemoParentLinkedChild(
  preferredUsername: string | null | undefined,
  email: string | null | undefined,
): string | null {
  const u = preferredUsername?.trim().toLowerCase().replace(/_/g, '.')
  if (u && BY_USERNAME[u]) {
    return BY_USERNAME[u]
  }
  const e = email?.trim().toLowerCase()
  if (e && BY_EMAIL[e]) {
    return BY_EMAIL[e]
  }
  return null
}
