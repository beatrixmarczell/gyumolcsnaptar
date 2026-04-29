# Versioning and Release Flow

This project runs with two long-lived lines:

- `master` for stable production (`gyuminaptar.hu`)
- `next/v3` for upcoming larger changes (`next.gyuminaptar.hu`)

Both lines deploy on Vercel automatically when the corresponding branch
is pushed to GitHub. Annotated git tags are the source of truth for
release names; the UI shows the same string in the version pill at the
top right corner of the page.

## Version policy

- Stable line (`master`): `v2.x.y-short-kebab-description`
  - Example: `v2.0.11-web-preview-real-center-hotfix`
- Next line (`next/v3`): `v3.0.x-short-kebab-description`
  - Example: `v3.0.21-next-version-display-fix`
  - Historical `v3.0.0-alpha.N` / `beta.N` / `rc.N` tags exist for the
    earliest milestones but the active flow is the simple `v3.0.x-...`
    scheme aligned with `package.json` `version`.

## Where the version pill string comes from

`vite.config.ts` resolves the displayed version with this precedence:

1. `VITE_APP_VERSION` build-env override (use only for one-off deploys).
2. CI tag environment variables: `GITHUB_REF_NAME`, `VERCEL_GIT_COMMIT_TAG`, `CI_COMMIT_TAG`.
3. `git tag --points-at HEAD` (works on local builds and on CI builds
   that fetch the full git history).
4. **`buildTag` field in `package.json`** — deterministic fallback for
   Vercel branch deploys, which use a shallow git clone and therefore
   cannot see annotated tags. Bump this on every release so the UI on
   `next.gyuminaptar.hu` mirrors the GitHub release tag verbatim.
5. `package.json` `version` (e.g. `v3.0.21`).
6. `git-<short-sha>` last-resort fallback.

## Per-release file changes (next channel)

Bump the following three places in lockstep when releasing on
`next/v3`:

1. `package.json`
   - `"version": "3.0.X"` (semver compliant — digits only).
   - `"buildTag": "v3.0.X-short-kebab-description"` (full tag string).
2. `package-lock.json`
   - top-level `"version": "3.0.X"`
   - first entry under `"packages": { "": { "version": "3.0.X" } }`.
3. Annotated git tag named `v3.0.X-short-kebab-description`.

The same three numbers must match across all three places.

## Stable release checklist (`master`)

1. Make and test fixes on `master` only.
2. Bump `package.json` `version`, `buildTag`, and `package-lock.json`
   (same rule as next channel).
3. Commit and push branch updates to `origin master`.
4. Create the annotated stable tag and push it:

```bash
git tag -a v2.0.11-stable-fix-name -m "Short stable fix summary."
git push origin v2.0.11-stable-fix-name
```

5. Vercel auto-deploys the `master` branch to `gyuminaptar.hu`. If you
   need a manual deploy with an explicit version override, use:

```bash
vercel --prod --yes --build-env "VITE_APP_VERSION=v2.0.11-stable-fix-name"
```

## Next release checklist (`next/v3`)

1. Work in the `Gyumolcsnaptar-next` worktree on the `next/v3` branch.
2. Implement and test the change locally against the dev Supabase
   project (`Gyumolcsnaptar_db_dev`) using `npm run dev`.
3. Bump `package.json` (`version`, `buildTag`) and `package-lock.json`.
4. Commit (e.g. `Release v3.0.X: short summary.`) and push:

```bash
git push origin next/v3
```

5. Create the annotated tag and push it:

```bash
git tag -a v3.0.X-short-kebab-description -F TAG_MSG.tmp
git push origin v3.0.X-short-kebab-description
```

   The annotation should describe the change, list the files touched,
   and include a rollback hint pointing to the previous tag.
6. Vercel auto-deploys `next/v3` to `next.gyuminaptar.hu`. After the
   deploy is "Ready", hard reload (`Ctrl+Shift+R`) and verify the new
   tag string appears in the version pill at the top right.

### Backend changes alongside a next release

If the release also touches Supabase:

- Edge functions: `npx supabase functions deploy <name>`. The
  `keycloak-gateway` function is deployed with `--no-verify-jwt` because
  it accepts a Keycloak-issued bearer.
- SQL migrations on `Gyumolcsnaptar_db_dev` (dev): `npx supabase db push`
  (CLI uses `SUPABASE_DB_PASSWORD` env var).
- SQL migrations on `Gyumolcsnaptar_db` (prod): paste the migration into
  the Supabase Studio SQL Editor on the prod project so we do not need
  to keep the prod Postgres password around. Keep the migration file in
  `supabase/migrations/` for future fresh DB rebuilds.

## Local separation

- Stable workspace: `Gyumolcsnaptar` (branch `master`)
- Next workspace: `Gyumolcsnaptar-next` (branch `next/v3`)
- Keep separate `.env.local` / `.env.development.local` per workspace.
- The dev Supabase password lives in gitignored `.dev-supabase.local`;
  the prod Supabase Postgres password is intentionally not stored on
  disk — reset it on the dashboard if a CLI `db push` is needed.

## Rollback options

### Fastest: Vercel "Promote to Production" / channel promotion

1. Open the Vercel dashboard → project → Deployments.
2. Find the previous Ready deploy (annotated by tag or commit hash).
3. Use the three-dot menu → Promote (or Set as production / next).

This is instant, does not touch git, and is the recommended first move.

### Local checkout of a known good tag

```bash
git checkout v3.0.20-next-swap-approve-instant-ui-update
# Or for stable:
git checkout v2.0.10-web-preview-real-center-hotfix
```

### Safe rollback with a revert commit (preserves history)

```bash
git checkout next/v3   # or master
git revert --no-edit <bad_commit_sha>
git push origin next/v3
```

This pushes a forward-only revert commit, the bad tag stays in git
history for inspection, and Vercel redeploys with the previous state.

### Postgres function rollback (if a SQL migration causes issues)

If an `apply_swap_offer` (or similar) RPC update misbehaves on prod,
re-run the previous version of the function via the Supabase Studio SQL
Editor on the prod project. The previous definition lives in the
preceding migration file under `supabase/migrations/`.
