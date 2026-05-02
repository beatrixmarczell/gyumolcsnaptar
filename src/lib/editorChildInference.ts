/**
 * Szerkesztő / szülő: a Keycloak név, felhasználónév és e-mail lokális része alapján
 * megtalálja a gyerek(ek)et a névsorban (megegyezik a keycloak-gateway logikájával).
 */
export function collectEditorInferTokens(
  displayName: string | null | undefined,
  preferredUsername: string | null | undefined,
  email: string | null | undefined,
): Set<string> {
  const tokens = new Set<string>()
  const harvest = (source: string | null | undefined): void => {
    if (!source) {
      return
    }
    for (const part of source.split(/[\s._-]+/)) {
      const t = part.trim()
      if (t.length >= 4) {
        tokens.add(t.toLowerCase())
      }
    }
  }
  harvest(displayName)
  harvest(preferredUsername)
  const raw = email?.trim()
  if (raw) {
    const local = raw.split('@')[0]?.split('+')[0]?.trim() ?? ''
    harvest(local)
  }
  return tokens
}

export function inferEditorLinkedChildrenFromTokens(
  displayName: string | null | undefined,
  preferredUsername: string | null | undefined,
  email: string | null | undefined,
  roster: string[],
): string[] {
  const tokens = collectEditorInferTokens(displayName, preferredUsername, email)
  if (tokens.size === 0 || roster.length === 0) {
    return []
  }
  const out = new Set<string>()
  for (const token of tokens) {
    for (const child of roster) {
      if (child.toLowerCase().includes(token)) {
        out.add(child)
      }
    }
  }
  return [...out]
}

/** Csere jogosultság: a gyerek neve tartalmazza valamelyik ≥4 karakteres tokent (név/e-mail). */
export function editorChildMatchesInferTokens(
  childName: string,
  displayName: string | null | undefined,
  preferredUsername: string | null | undefined,
  email: string | null | undefined,
): boolean {
  const tokens = collectEditorInferTokens(displayName, preferredUsername, email)
  if (tokens.size === 0) {
    return false
  }
  const childLower = childName.trim().toLowerCase()
  return [...tokens].some((t) => childLower.includes(t))
}
