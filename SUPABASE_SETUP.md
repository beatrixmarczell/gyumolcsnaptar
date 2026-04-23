# Supabase beállítás (közös naptár)

A webalkalmazás a **Supabase** PostgreSQL adatbázisában tartja a naptár állapotát. Ha ezek a változók nincsenek beállítva, a program továbbra is **csak a böngészőben** (`localStorage`) ment — ahogy eddig.

## 1. Projekt létrehozása

1. Regisztráció: [https://supabase.com](https://supabase.com)
2. **New project** (válassz jelszót az adatbázishoz, régió: pl. EU, ha kell)

## 2. Táblák létrehozása

1. A projektben: **SQL Editor** → New query
2. Másold be a `supabase/migrations/20260215120000_init.sql` fájl teljes tartalmát, majd **Run**
3. Ezután futtasd a `supabase/migrations/20260423090000_keycloak_auth.sql` migrationt is.
4. Ellenőrzés: **Table Editor** alatt látod: `organizations`, `groups`, `group_calendar_state`, `user_profiles`, `group_memberships`  
   A demo ovi + demo csoport egy sor már létrejött.

## 3. Kliens kulcs (anon)

1. **Project Settings** → **API**
2. Másold: **Project URL** → `VITE_SUPABASE_URL`
3. Másold: **anon public** kulcs → `VITE_SUPABASE_ANON_KEY`

## 4. Helyi futtatás

1. A projekt gyökerében: másold a `.env.example` fájlt `.env.local` néven
2. Töltsd be a fenti két értéket, és állítsd a csoportot:

   `VITE_DEFAULT_GROUP_ID=b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02`

3. Indítsd újra: `npm run dev` (vagy `npm.cmd run dev` PowerShell alatt)
4. A fejlécben megjelenik: **„Felhő: …”** — sikeres mentéskor **„Felhő: mentve (közös)”**

## 5. GitHub Pages (GitHub Actions)

A buildnek is látnia kell a környezeti változókat. A repóban: **Settings** → **Secrets and variables** → **Actions** → ezek a **repository secrets**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DEFAULT_GROUP_ID`  (ugyanaz, mint a demo csoport, vagy a saját csoportod UUID-ja, ha cserélted)

A `.github/workflows/deploy-pages.yml` már ezekre hivatkozik.

## 6. Biztonság (fontos!)

- A korábbi anon írható működést a Keycloak rollout lezárja: közvetlen anon írás tiltva van.
- A mentés/olvasás a `keycloak-gateway` Edge Functionön keresztül történik (lásd `KEYCLOAK_SETUP.md`).

## 7. Új ovi vagy csoport (később)

- Új sort adsz a `groups` (és szükség esetén `organizations`) táblához
- Az alkalmazás későbbi verziójában: választó vagy célzott link `VITE_DEFAULT_GROUP_ID` (vagy bejelentkezés) szerint
