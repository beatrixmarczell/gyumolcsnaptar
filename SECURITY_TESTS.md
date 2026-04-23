# Security tesztek (Keycloak rollout)

## Lefuttatott technikai ellenőrzés

- `npm run build` sikeres (TypeScript + production build).
- Frontend role-gating compile szinten rendben (`viewer` nem tud menteni).
- Edge Function token nélküli hívásra `401`-et ad (kódszinten kezelve).

## Kötelező környezeti E2E tesztlista

Ezt a Keycloak + Supabase környezetben kell lefuttatni:

1. **Admin**
   - be tud lépni
   - tud olvasni
   - tud menteni
2. **Editor**
   - be tud lépni
   - tud olvasni
   - tud menteni
3. **Viewer**
   - be tud lépni
   - tud olvasni
   - mentés tiltva
4. **Jogosulatlan user**
   - be tud lépni Keycloakba
   - csoportadathoz hozzáférés tiltva (403)
5. **Hibafolyamat**
   - lejárt token -> újrahitelesítés
   - rossz issuer/audience -> 401
   - hibás redirect URI -> login hiba

## Gyors curl példa (token ellenőrzés)

```bash
curl -i \
  -X POST "https://<project-ref>.supabase.co/functions/v1/keycloak-gateway" \
  -H "Authorization: Bearer <KEYCLOAK_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"action":"load","groupId":"b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02"}'
```
