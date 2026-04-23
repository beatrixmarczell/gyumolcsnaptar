# Keycloak beállítás (Admin / Editor / Viewer)

Ez a projekt Keycloak OIDC bejelentkezést használ a közös naptár védésére.

## 1) Keycloak indítás (lokál teszt)

1. Nyisd meg a `keycloak` mappát.
2. Indítás: `docker compose up -d`
3. Admin felület: [http://localhost:8080](http://localhost:8080)
4. Belépés: `admin / admin`

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

Ha már megvan a domain (pl. `gyumolcsnaptar.hu`), állíts be fix app/auth hostot:

- app: `https://app.gyumolcsnaptar.hu` (vagy `https://gyumolcsnaptar.hu`)
- auth: `https://auth.gyumolcsnaptar.hu` (Keycloak)

Keycloak `gyumolcsnaptar-web` kliensben:

- `Valid redirect URIs`
  - `https://app.gyumolcsnaptar.hu/*`
  - `https://gyumolcsnaptar.hu/*`
  - `http://localhost:5173/*`
- `Web origins`
  - `https://app.gyumolcsnaptar.hu`
  - `https://gyumolcsnaptar.hu`
  - `http://localhost:5173`

GitHub Actions secret-ek:

- `VITE_AUTH_MODE=keycloak`
- `VITE_KEYCLOAK_URL=https://auth.gyumolcsnaptar.hu`
- `VITE_KEYCLOAK_REALM=gyumolcsnaptar`
- `VITE_KEYCLOAK_CLIENT_ID=gyumolcsnaptar-web`

Supabase function secret-ek:

- `KEYCLOAK_ISSUER=https://auth.gyumolcsnaptar.hu/realms/gyumolcsnaptar`
- `KEYCLOAK_JWKS_URL=https://auth.gyumolcsnaptar.hu/realms/gyumolcsnaptar/protocol/openid-connect/certs`
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
