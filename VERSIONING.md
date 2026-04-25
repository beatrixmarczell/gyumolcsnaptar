# Versioning and Release Flow

This project now runs with two long-lived lines:
- `master` for stable production (`gyuminaptar.hu`)
- `next/v3` for large upcoming changes (`next.gyuminaptar.hu`)

## Version policy

- Stable line (`master`): `v2.x.y-*`
- Next line (`next/v3`): `v3.0.0-alpha.N`, later `beta.N`, then `rc.N`
- First next checkpoint tag: `v3.0.0-alpha.1`

## Stable release checklist (`master`)

1. Make and test fixes on `master` only.
2. Push branch updates to origin.
3. Create annotated stable tag:

```bash
git tag -a v2.0.11-stable-fix-name -m "Short stable fix summary."
git push origin v2.0.11-stable-fix-name
```

4. Deploy to production:

```bash
vercel --prod --yes --build-env "VITE_APP_VERSION=v2.0.11"
```

## Next release checklist (`next/v3`)

1. Work only in the separate `next/v3` worktree folder.
2. Push branch updates to origin `next/v3`.
3. Create annotated next milestone tag:

```bash
git tag -a v3.0.0-alpha.2 -m "v3 milestone summary."
git push origin v3.0.0-alpha.2
```

4. Deploy for next subdomain preview:

```bash
vercel --yes --build-env "VITE_APP_VERSION=v3.0.0-alpha.2"
```

## Local separation

- Stable workspace: `Gyumolcsnaptar` (branch `master`)
- Next workspace: `Gyumolcsnaptar-next` (branch `next/v3`)
- Keep separate `.env.local` values per workspace if needed.

## Rollback options

### Fast local rollback to known tag

```bash
git checkout v2.0.10-web-preview-real-center-hotfix
```

### Safe rollback on `master` with new commit

```bash
git checkout master
git revert --no-edit <bad_commit_sha>
git push origin master
```
