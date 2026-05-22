import { useCallback, useEffect, useState } from 'react'
import {
  loadParentLinks,
  setParentLinks,
  type MemberRow,
  type ParentLinkRow,
} from '../lib/swapWorkflow'

type Props = {
  accessToken: string | null
  children: string[]
}

type ChildMapping = {
  childName: string
  userIds: string[]
}

function getUserLabel(member: MemberRow): string {
  const profile = Array.isArray(member.user_profiles) ? member.user_profiles[0] : member.user_profiles
  return profile?.display_name || profile?.email || member.user_id.slice(0, 8)
}

export function ParentLinksAdminPanel({ accessToken, children }: Props) {
  const [links, setLinks] = useState<ParentLinkRow[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [mappings, setMappings] = useState<ChildMapping[]>([])
  const [loading, setLoading] = useState(false)
  const [savingChild, setSavingChild] = useState<string | null>(null)
  const [savedChild, setSavedChild] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await loadParentLinks({ accessToken })
      setLinks(result.links)
      setMembers(result.members)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba a lekéréskor.')
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    void reload()
  }, [reload])

  // Mappings összeállítása a linkek és a children lista alapján
  useEffect(() => {
    const byChild = new Map<string, string[]>()
    for (const childName of children) {
      byChild.set(childName, [])
    }
    for (const link of links) {
      const existing = byChild.get(link.child_name) ?? []
      if (link.user_id && !existing.includes(link.user_id)) {
        existing.push(link.user_id)
      }
      byChild.set(link.child_name, existing)
    }
    const result: ChildMapping[] = []
    for (const childName of children) {
      result.push({ childName, userIds: byChild.get(childName) ?? [] })
    }
    // Extra gyerekek a linkekből (nem szerepelnek a children listában)
    for (const [childName, userIds] of byChild) {
      if (!children.includes(childName)) {
        result.push({ childName, userIds })
      }
    }
    setMappings(result)
  }, [links, children])

  const handleToggleUser = (childName: string, userId: string) => {
    setMappings((prev) =>
      prev.map((m) => {
        if (m.childName !== childName) return m
        const has = m.userIds.includes(userId)
        return {
          ...m,
          userIds: has ? m.userIds.filter((id) => id !== userId) : [...m.userIds, userId],
        }
      }),
    )
  }

  const handleSave = async (childName: string) => {
    const mapping = mappings.find((m) => m.childName === childName)
    if (!mapping) return
    setSavingChild(childName)
    setSavedChild(null)
    setError(null)
    try {
      await setParentLinks({ accessToken, childName, userIds: mapping.userIds })
      setSavedChild(childName)
      setTimeout(() => setSavedChild(null), 2500)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mentési hiba.')
    } finally {
      setSavingChild(null)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          👨‍👩‍👧 Szülő-gyerek hozzárendelés
        </h3>
        <button
          onClick={() => { void reload() }}
          disabled={loading}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            cursor: loading ? 'not-allowed' : 'pointer',
            padding: '4px 10px',
            fontSize: '0.78rem',
            color: 'var(--text-secondary)',
          }}
        >
          {loading ? '...' : '↻ Frissítés'}
        </button>
      </div>

      {error && (
        <div
          style={{
            background: '#fee2e2',
            color: '#991b1b',
            borderRadius: '8px',
            padding: '8px 12px',
            fontSize: '0.82rem',
            marginBottom: '10px',
          }}
        >
          {error}
        </div>
      )}

      {members.length === 0 && !loading && (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Nincsenek editor/admin tagok a csoportban.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {mappings.map((mapping) => (
          <div
            key={mapping.childName}
            style={{
              background: 'var(--bg-surface-soft)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              padding: '10px 14px',
            }}
          >
            <div
              style={{
                fontWeight: 600,
                fontSize: '0.88rem',
                color: 'var(--text-primary)',
                marginBottom: '8px',
              }}
            >
              {mapping.childName}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
              {members.map((member) => {
                const isSelected = mapping.userIds.includes(member.user_id)
                return (
                  <button
                    key={member.user_id}
                    onClick={() => handleToggleUser(mapping.childName, member.user_id)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '999px',
                      border: `1px solid ${isSelected ? '#2d7a2d' : 'var(--border)'}`,
                      background: isSelected ? '#d1fae5' : 'var(--bg-surface)',
                      color: isSelected ? '#065f46' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                      fontWeight: isSelected ? 600 : 400,
                      transition: 'all 0.15s',
                    }}
                  >
                    {isSelected ? '✓ ' : ''}
                    {getUserLabel(member)}
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                onClick={() => { void handleSave(mapping.childName) }}
                disabled={savingChild === mapping.childName}
                style={{
                  padding: '5px 14px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#2d7a2d',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  cursor: savingChild === mapping.childName ? 'not-allowed' : 'pointer',
                  opacity: savingChild === mapping.childName ? 0.7 : 1,
                }}
              >
                {savingChild === mapping.childName ? 'Mentés...' : 'Mentés'}
              </button>
              {savedChild === mapping.childName && (
                <span style={{ fontSize: '0.78rem', color: '#2d7a2d', fontWeight: 600 }}>✓ Mentve</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
