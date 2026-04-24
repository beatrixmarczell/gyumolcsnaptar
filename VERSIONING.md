# Versioning and Rollback

This project uses:
- GitHub commits for detailed history
- Git tags for stable checkpoints
- GitHub Releases for readable change summaries
- Vercel for production deployment

## Recommended release flow

1. Commit changes to `master`.
2. Wait for the **CI Build Check** workflow to pass.
3. Create an annotated tag with a meaningful message:

```bash
git tag -a v1.5.0 -m "Public read-only mode with Keycloak login entry."
git push origin v1.5.0
```

4. GitHub will auto-create a Release from the tag.

## Naming suggestions

- `v1.5.0-readonly-public-view`
- `v1.5.1-cloud-read-fix`
- `v1.6.0-parent-login-foundation`

Keep tags short and understandable by non-developers.

## Rollback options

### Fast local rollback to a known tag

```bash
git checkout v1.5.0
```

### Restore `master` to a known tag with a new commit (safe history)

```bash
git checkout master
git revert --no-edit <bad_commit_sha>
git push origin master
```

### Force reset master to an old tag (dangerous; avoid unless agreed)

```bash
git checkout master
git reset --hard v1.5.0
git push --force origin master
```

Use the force option only when absolutely necessary and coordinated.
