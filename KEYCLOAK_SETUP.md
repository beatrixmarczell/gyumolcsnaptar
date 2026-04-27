# Keycloak beállítás (Admin / Editor / Viewer)

Ez a projekt Keycloak OIDC bejelentkezést használ a közös naptár védésére.

## 1) Keycloak + Tunnel indítás (lokál teszt, fix)

1. A `keycloak/.env.example` fájlt másold `.env` néven a `keycloak` mappába.
2. A `.env`-ben állítsd be:
   - `CLOUDFLARED_CREDENTIALS_FILE=C:/Users/<te-felhasznalo>/.cloudflared/a4de70c3-84bd-4ab6-a27d-1b2578b15f26.json`
3. Projekt gyökérből indítás:
   - `npm run infra:up`
4. Ellenőrzés:
   - Keycloak admin: [http://localhost:8080](http://localhost:8080) (`admin / admin`)
   - Auth host: `https://auth.gyuminaptar.hu`

Leállítás:

- `npm run infra:down`

Logok:

- `npm run infra:logs`

Megjegyzés: a compose-ban a `keycloak` és a `cloudflared` is `restart: unless-stopped` módban fut, így Docker újraindítás után automatikusan visszaállnak.

A realm import automatikus (`keycloak/realm/gyumolcsnaptar-realm.json`):
- realm: `gyumolcsnaptar`
- client: `gyumolcsnaptar-web` (PKCE SPA)
- szerepkörök: `admin`, `editor`, `viewer`
- teszt userek: `admin.demo`, `editor.demo`, `viewer.demo`

## 2) Supabase migration futtatás

Futtasd sorrendben:
- `supabase/migrations/20260215120000_init.sql`
- `supabase/migrations/20260423090000_keycloak_auth.sql`

Ez létrehozza:
- `user_profiles`
- `group_memberships`
- szigorított jogosultságot (anon közvetlen írás tiltva)

## 3) Edge Function deploy

Function: `supabase/functions/keycloak-gateway/index.ts`

Deploy (Supabase CLI):
- `supabase functions deploy keycloak-gateway`

Szükséges Function Secrets:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DEFAULT_GROUP_ID` (demo: `b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02`)
- `KEYCLOAK_ISSUER` (pl. `http://localhost:8080/realms/gyumolcsnaptar`)
- `KEYCLOAK_AUDIENCE` (client id: `gyumolcsnaptar-web`)
- `KEYCLOAK_JWKS_URL` (pl. `http://localhost:8080/realms/gyumolcsnaptar/protocol/openid-connect/certs`)

## 4) Frontend env

`.env.local`:

```env
VITE_AUTH_MODE=keycloak
VITE_KEYCLOAK_URL=http://localhost:8080
VITE_KEYCLOAK_REALM=gyumolcsnaptar
VITE_KEYCLOAK_CLIENT_ID=gyumolcsnaptar-web
```

Plusz a meglévő Supabase env változók.

## 4/b) Publikus domain (stabil URL) beállítás

Ha már megvan a domain (pl. `gyuminaptar.hu`), állíts be fix app/auth hostot:

- app: `https://app.gyuminaptar.hu` (vagy `https://gyuminaptar.hu`)
- auth: `https://auth.gyuminaptar.hu` (Keycloak)

Keycloak `gyumolcsnaptar-web` kliensben:

- `Valid redirect URIs`
  - `https://app.gyuminaptar.hu/*`
  - `https://gyuminaptar.hu/*`
  - `http://localhost:5173/*`
- `Web origins`
  - `https://app.gyuminaptar.hu`
  - `https://gyuminaptar.hu`
  - `http://localhost:5173`

GitHub Actions secret-ek:

- `VITE_AUTH_MODE=keycloak`
- `VITE_KEYCLOAK_URL=https://auth.gyuminaptar.hu`
- `VITE_KEYCLOAK_REALM=gyumolcsnaptar`
- `VITE_KEYCLOAK_CLIENT_ID=gyumolcsnaptar-web`

Supabase function secret-ek:

- `KEYCLOAK_ISSUER=https://auth.gyuminaptar.hu/realms/gyumolcsnaptar`
- `KEYCLOAK_JWKS_URL=https://auth.gyuminaptar.hu/realms/gyumolcsnaptar/protocol/openid-connect/certs`
- `KEYCLOAK_AUDIENCE=gyumolcsnaptar-web`

## 5) User mapping és role kiosztás

Az első sikeres bejelentkezésnél a Function létrehozza a `user_profiles` sort (`keycloak_sub` alapján).

Role adás SQL-lel:

```sql
insert into public.group_memberships (group_id, user_id, role)
values ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02', '<user_profiles.id>', 'editor')
on conflict (group_id, user_id) do update set role = excluded.role;
```

## 6) Üzemeltetési runbook (rövid)

- **Új user felvétele:** Keycloak user létrehozás -> első login -> `group_memberships` role adás.
- **Role csere:** `group_memberships.role` frissítés.
- **Kulcsrotáció:** Keycloak kliens változtatás után frissítsd a `KEYCLOAK_JWKS_URL`/issuer beállításokat, majd Function secret rotate.
- **Hiba esetén:** Edge Function log + browser konzol + Keycloak realm events.
