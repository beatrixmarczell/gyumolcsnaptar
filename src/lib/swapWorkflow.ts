import { getDefaultGroupId, getDesktopAccessToken, getFunctionUrl } from './supabaseClient'
import type { AppStatePayload, AppUserRole } from './cloudTypes'

export type SwapOffer = {
  id: string
  request_id: string
  offer_user_id: string
  offer_child_name: string
  offer_date_key: string
  note: string | null
  status: string
  created_at: string
  updated_at: string
}

export type SwapRequest = {
  id: string
  group_id: string
  requester_user_id: string
  requester_child_name: string
  requester_date_key: string
  note: string | null
  status: string
  resolved_offer_id: string | null
  created_at: string
  updated_at: string
  offers: SwapOffer[]
}

export type SwapEventRow = {
  id: string
  group_id: string
  request_id: string | null
  offer_id: string | null
  actor_user_id: string | null
  event_type: string
  visibility: string
  payload: Record<string, unknown>
  created_at: string
}

async function callGateway<T>(token: string, body: Record<string, unknown>): Promise<T> {
  const endpoint = getFunctionUrl('keycloak-gateway')
  const groupId = getDefaultGroupId()
  if (!endpoint || !groupId) {
    throw new Error('A keycloak-gateway endpoint nincs konfigurálva.')
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ...body, groupId }),
  })
  const json = (await response.json()) as T & { error?: string }
  if (!response.ok) {
    throw new Error(json.error ?? 'Swap gateway hiba.')
  }
  return json
}

function resolveToken(accessToken?: string | null): string {
  const token = accessToken ?? getDesktopAccessToken()
  if (!token) {
    throw new Error('Hiányzó token.')
  }
  return token
}

export async function loadSwapRequests(params: { accessToken?: string | null; role: AppUserRole }): Promise<SwapRequest[]> {
  if (params.role === 'viewer') {
    return []
  }
  const token = resolveToken(params.accessToken)
  const json = await callGateway<{ requests?: SwapRequest[] }>(token, { action: 'swap_list' })
  return json.requests ?? []
}

export async function createSwapRequest(params: {
  accessToken?: string | null
  requesterChildName: string
  requesterDateKey: string
  note?: string
}): Promise<void> {
  const token = resolveToken(params.accessToken)
  await callGateway(token, {
    action: 'swap_request_create',
    requesterChildName: params.requesterChildName,
    requesterDateKey: params.requesterDateKey,
    note: params.note ?? '',
  })
}

export async function createSwapOffer(params: {
  accessToken?: string | null
  requestId: string
  offerChildName: string
  offerDateKey: string
  note?: string
}): Promise<void> {
  const token = resolveToken(params.accessToken)
  await callGateway(token, {
    action: 'swap_offer_create',
    requestId: params.requestId,
    offerChildName: params.offerChildName,
    offerDateKey: params.offerDateKey,
    note: params.note ?? '',
  })
}

export async function withdrawSwapOffer(params: { accessToken?: string | null; offerId: string }): Promise<void> {
  const token = resolveToken(params.accessToken)
  await callGateway(token, {
    action: 'swap_offer_withdraw',
    offerId: params.offerId,
  })
}

export async function withdrawSwapRequest(params: { accessToken?: string | null; requestId: string }): Promise<void> {
  const token = resolveToken(params.accessToken)
  await callGateway(token, {
    action: 'swap_request_withdraw',
    requestId: params.requestId,
  })
}

export async function approveSwapOffer(params: {
  accessToken?: string | null
  requestId: string
  offerId: string
}): Promise<{ payload: AppStatePayload | null }> {
  const token = resolveToken(params.accessToken)
  const json = await callGateway<{ ok?: boolean; payload?: AppStatePayload | null }>(token, {
    action: 'swap_request_approve',
    requestId: params.requestId,
    offerId: params.offerId,
  })
  return { payload: json.payload ?? null }
}

export async function deleteSwapRequest(params: { accessToken?: string | null; requestId: string }): Promise<void> {
  const token = resolveToken(params.accessToken)
  await callGateway(token, {
    action: 'swap_request_delete',
    requestId: params.requestId,
  })
}

export async function clearClosedSwapRequests(params: { accessToken?: string | null }): Promise<void> {
  const token = resolveToken(params.accessToken)
  await callGateway(token, {
    action: 'swap_requests_clear_closed',
  })
}
