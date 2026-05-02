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
- teszt userek: `admin.demo`, `editor.demo`, `viewer.demo`, valamint **négy szülő** `szulo1.demo` … `szulo4.demo` (fix JWT `sub` / Keycloak user `id`, lásd `supabase/migrations/20260430120200_test_parents_seed.sql`)

**Megjegyzés:** Ha a realm már korábban importálva volt, az új userek nem jelennek meg automatikusan. Ilyenkor Keycloak adminból vedd fel őket kézzel (ugyanaz a felhasználónév, email, jelszó; **User ID** módosítása a megadott UUID-ra, ha elérhető), vagy állítsd újra a Keycloak adatkötetet és importáld újra a realm fájlt.

### szulo2.demo (vagy más szülő) nem tud belépni

Gyakori ok: **a felhasználó nincs a futó Keycloakban** – a `--import-realm` nem mindig veszi fel a JSON-ban később hozzáadott usereket egy **már meglévő** realm-adatbázisba.

1. **Admin:** [http://localhost:8080](http://localhost:8080) → *Users* → keresés: `szulo2`. Ha üres, a user hiányzik.
2. **Gyors javítás (Docker, dev):** Keycloak fusson (`npm run infra:up`), majd a repó gyökerében: **`npm run infra:keycloak-demo-parents`** (Node + `kcadm` a konténerben). Alternatíva: Git Bash alatt `bash keycloak/scripts/ensure-demo-parent-users.sh`.
3. **Teljes reset (csak dev):** `docker compose -f keycloak/docker-compose.yml down -v`, majd `npm run infra:up` – a KC kötet törlése után minden user újraimportálódik a JSON-ból.

Belépés: **`szulo2.demo`** / **`ChangeMe123!`** (vagy email **`szulo2@example.com`**, ha a login képernyő azt kéri).

## 2) Supabase migration futtatás

Futtasd sorrendben:
- `supabase/migrations/20260215120000_init.sql`
- `supabase/migrations/20260423090000_keycloak_auth.sql`
- … (swap / további migrációk a projektben)
- `supabase/migrations/20260430120000_swap_notifications.sql`
- `supabase/migrations/20260430120100_fruit_reminder_log.sql`
- `supabase/migrations/20260430120200_test_parents_seed.sql`
- `supabase/migrations/20260430120300_realign_szulo_keycloak_subs.sql` — **vigyázat:** ez a fájl **konkrét, Keycloak által kiosztott** `szulo*` user id-kra van szabva (lásd a fájl elején). Ha **friss** Keycloak importod van **és** a realm JSON `id` mezői egyeznek a `301202` seed UUID-jaival, **ne** add hozzá ezt a migrációt, vagy cseréld az id-kat a te környezeted `kcadm get users` kimenetére. Eltérő környezeteken előfordulhat, hogy ezt a migrációt egyáltalán nem kell futtatni.

Az első két fájl fent létrehozza a `user_profiles` / `group_memberships` táblákat és szigorítja az írást; a projekt többi migrációja a swap sémát; a **20260430120*** fájlok: `swap_notifications`, `fruit_reminder_log`, teszt szülő seed, opcionális Keycloak sub realign.

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

### Next / éles: szülő – csak a saját gyerek napjai (csere igénylés)

A szűrés akkor működik, ha **mind** teljesül:

1. **Friss frontend build** (a `linkedChildren` + 3 hónapos csereablak kódja benne van a deployban).
2. A **`VITE_SUPABASE_URL`** ugyanarra a Supabase projektre mutat, ahová a **`keycloak-gateway`** deployolva van, és az a függvény **friss** (`load` visszaadja a `linkedChildren` mezőt).
3. **Edge secret:** `KEYCLOAK_ISSUER` / `KEYCLOAK_JWKS_URL` az **éles** Keycloakra mutat.
4. **Adatbázis:** `parent_child_links` `user_id` értéke megegyezik a **jelenlegi** `user_profiles.id`-val ugyanarra az e-mailre. Ha az első belépés új profilt hozott létre, futtasd a **`20260502120500_parent_child_links_resync_demo_parents_by_email`** migrációt (ha korábban hibázott a `20260502120000`, előtte: `supabase migration repair --status reverted 20260502120000`).

Ha a szülő **minden napot** lát: ellenőrizd, nem **admin**-e (Keycloak realm role + `group_memberships.role`).

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
