# OnTrack CLI Release Runbook

This runbook operates the repository workflows in `.github/workflows/`. It deliberately separates repository code from GitHub and npm administrative settings, so an unreviewed pull request cannot enable production publication.

## One-time administration

Complete these settings in the GitHub and npm UIs before enabling registry publication:

1. Protect `master`: require the `CI / Verify Bun CLI` and `Dependency review / Dependency review` checks, at least one review, resolved conversations, and no force pushes.
2. Create a protected GitHub Environment named `release`. Require maintainer approval and restrict deployment branches/tags to the intended release tags.
3. In npm package settings for `ontrack-cli`, create a Trusted Publisher with owner `MarkChu-git`, repository `Always-Ontrack`, workflow file `release.yml`, and Environment `release`.
4. Set the repository variable `PUBLISH_TO_NPM` to `true` only after step 3 is verified. Its absence or any value other than the lowercase string `true` keeps the npm job disabled.
5. Do not configure `NPM_TOKEN`, `NODE_AUTH_TOKEN`, an automation token, or OnTrack credentials. The publish job uses GitHub OIDC and the rest of CI has no secrets.
6. Keep GitHub secret scanning, push protection, Dependabot alerts, and Dependabot security updates enabled. They were turned on on 2026-10-09.

Do not enable automatic merge for Bun, TypeScript, Playwright, or GitHub Action major-version updates.

## Release procedure

1. Merge the release version change into `master`. `package.json` must contain the final SemVer version and `bun.lock` must be current.
2. Wait for required checks to pass. Locally, run the same gates with Bun 1.3.14, the version CI pins. `bun run verify` packs the tarball into a temporary directory and removes it; set `PACKAGE_OUTPUT_DIR` to a directory inside the checkout, such as `artifacts`, to keep it.

   ```bash
   bun install --frozen-lockfile
   bun run verify
   bun run verify:graph
   bun run audit:check
   ```

3. From the exact `master` commit, create an annotated tag whose name is exactly `v` plus `package.json`'s version. Do not reuse, move, or force-push tags.

   ```bash
   git switch master
   git pull --ff-only
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

4. The Release workflow checks out the tag and proves it is annotated and an ancestor of `origin/master`. It then runs `bun run verify` (which packs the one tarball into `artifacts/`), `bun run verify:graph`, and `bun run audit:check`, and records a SHA256 manifest of that tarball. It never reads the Actions cache.
5. It attests the build provenance of that verified tarball, then creates a draft GitHub Release with it. If a draft already exists, it must contain exactly that one tarball and no other asset; the workflow downloads it and refuses to continue unless its SHA256 matches the newly verified artifact. It never replaces or silently removes a release asset.
6. Approve the `release` Environment. When `PUBLISH_TO_NPM` is disabled, approval publishes the GitHub Release only. When it is enabled, approval first publishes the exact verified tarball to npm through OIDC, validates npm name/version/SHA512 integrity, then publishes the GitHub Release.
7. Verify the public GitHub Release has a single `ontrack-cli-X.Y.Z.tgz` asset, that `gh attestation verify ontrack-cli-X.Y.Z.tgz --repo MarkChu-git/Always-Ontrack` succeeds for the downloaded asset, and, when registry publishing is enabled, that `npm view ontrack-cli@X.Y.Z dist.integrity` is present.

The workflows never run `smoke:real` or upload browser state, OnTrack sessions, cookies, tokens, downloaded work, `.env` files, or browser profiles.

## Recovery and rollback

| Situation | Response |
| --- | --- |
| CI or package verification fails | Fix through a PR; do not bypass a required check. |
| A release run needs to be retried | Dispatch it from the tag itself: `gh workflow run release.yml --ref vX.Y.Z -f tag=vX.Y.Z`. A run dispatched from a branch stops before it builds, because the build provenance names the run's ref. |
| Tag/version/ancestry check fails | Do not retag a pushed version. Make a new patch version from `master`. |
| Draft has an extra/missing asset or its SHA256 differs | Stop. Investigate the source/tag; do not overwrite or publish the draft. |
| npm OIDC fails | Check the Trusted Publisher owner, repository, `release.yml`, Environment, `repository.url`, and `id-token: write`; do not add a long-lived token as a workaround. |
| npm publish succeeds but draft remains | Re-run the workflow against the same tag only after verifying registry metadata. The public GitHub Release remains gated by the Environment. |
| Released version is defective | Release a new patch. Deprecate the bad immutable registry version with a reason; never overwrite it. |

## Coverage ratchet maintenance

`config/coverage-thresholds.json` enforces weighted Bun LCOV lines and functions at 80% (`LF/LH` and `FNF/FNH`) across every library/script instrumented by Bun, with no configured exclusion. The process-entry CLI Adapter is exercised by spawned stub E2E tests (Bun does not merge child-process counters into the parent LCOV). The real-browser/Okta code is exercised without production network access through the narrow `BrowserLaunchAdapter` Seam plus focused origin, cookie, storage, CAPTCHA, MFA and guided-flow tests. Never add an exclusion or lower either threshold merely to make a pull request pass.
