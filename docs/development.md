# Development

← [README](../README.md)

## Local development

### Install dependencies

```bash
bun install
```

### Build

```bash
bun run build
```

Compiled output is written to:

```text
dist/
```

### Run tests

```bash
bun test
```

### Development runs

```bash
bun run dev -- tasks --project-id 87
```

### Real-account smoke verification

```bash
bun run smoke:real -- --project-id 87 --abbr D4
```

This script verifies:

- `auth-method`
- `whoami`
- `doctor`
- `discover`
- `discover --probe`
- `projects`
- `tasks`
- `task show`
- `units`
- `project show`
- `unit show`
- `unit tasks`
- `inbox`
- `feedback list`
- `pdf task`
- `pdf submission`
- `watch`
- `feedback watch`

It currently avoids upload actions on purpose, to reduce the chance of mutating real account data during a smoke check.

## Testing and verification

The repository currently includes:

- [api.test.ts](../test/api.test.ts)
  - API client auth headers
  - error handling
  - PDF download
  - submission upload
  - comment posting
- [cli-helpers.test.ts](../test/cli-helpers.test.ts)
  - task selector parsing
  - watch diff logic
  - filename rules
  - upload argument parsing
- [auto-login.test.ts](../test/auto-login.test.ts)
  - SSO credential capture helpers
  - OnTrack origin/domain isolation
  - private, filtered browser-state persistence
- [auto-login-real-browser.test.ts](../test/auto-login-real-browser.test.ts)
  - real Chromium against loopback Okta and OnTrack stand-ins, with no external
    network; skipped where no system Chromium is installed
  - the first login succeeds although the page tries to spend the one-time
    login token
  - the identity provider recognizes the device on the next login
- [discovery.test.ts](../test/discovery.test.ts)
  - frontend bundle route and API extraction
- [logout.test.ts](../test/logout.test.ts)
  - local cleanup when remote sign-out fails
  - redacted failure output
- [utils.test.ts](../test/utils.test.ts)
  - base URL and redirect URL utilities
  - prompts that fail, instead of exiting 0, when stdin closes unanswered
- [whoami.test.ts](../test/whoami.test.ts)
  - allowlisted identity projection
  - JSON and human-output secret regression checks

Validation tiers. CI and the release workflow run these same scripts:

```bash
bun run verify:fast   # after each change: both typechecks and the test suite
bun run verify        # before a release: every CI gate except GitNexus, the audit and the workflow scanners
bun run verify:graph  # GitNexus graph checks; needs the global GitNexus 1.6.9
bun run audit:check   # full dependency audit; --base <commit> fails only on new advisories
```

If you have a valid real session, add:

```bash
bun run smoke:real -- --project-id <id> --abbr <abbr>
```

## Dependency updates

New dependency versions wait seven days before the project adopts them, so a
compromised release has time to be caught. `bunfig.toml` sets
`install.minimumReleaseAge` to 604800 seconds, so `bun add` and `bun update`
resolve only versions published at least that long ago, and Dependabot waits
the same seven days (`cooldown` in `.github/dependabot.yml`; security updates
skip the wait). Versions already in `bun.lock` install as usual.

A security fix younger than a week goes into `minimumReleaseAgeExcludes` in
`bunfig.toml` until it is a week old. Verify a changed lockfile with Bun
1.3.14, the version CI pins.

## Coverage thresholds

`bun run test:coverage` runs the test suite with coverage and checks the summary
against [config/coverage-thresholds.json](../config/coverage-thresholds.json)
via [scripts/check-coverage.ts](../scripts/check-coverage.ts). The current gates
are 80% lines and 80% functions.

## Lightpanda experiment

Lightpanda is an explicit, local-only, credential-free experiment. It is enabled only when all
of the following are true: `ONTRACK_BROWSER=lightpanda`,
`ONTRACK_EXPERIMENTAL_LIGHTPANDA=1`, an absolute
`ONTRACK_LIGHTPANDA_PATH`, and Bun `1.4.0+`. The provider starts a local
Lightpanda process with a minimal environment and an OS-assigned loopback CDP
endpoint. It validates both the reviewed executable and the returned endpoint
before connecting. Compatibility work has a hard end-to-end deadline; an
unsupported provider, failed validation, or deadline returns a stable error
rather than silently falling back or retrying forever.

The normal HTTP CLI does not load Playwright or any browser provider.
Lightpanda `serve` currently exposes unauthenticated loopback CDP, so the CLI
refuses to use it for saved cookies, username/password, MFA, token capture, or
any real authentication. Real login must use the reviewed Chromium/system
provider. Do not use this experiment as a server default or assume it can bypass
Monash/Okta policy. Lightpanda can become an auth provider only after it offers
an authenticated transport, inherited listener FD, protected Unix socket, or an
equivalent peer-ownership guarantee.

From a development checkout, the only supported Lightpanda entrypoint is the
credential-free public-page probe:

```bash
ONTRACK_BROWSER=lightpanda \
ONTRACK_EXPERIMENTAL_LIGHTPANDA=1 \
ONTRACK_LIGHTPANDA_PATH=/absolute/path/to/lightpanda \
bun run spike:lightpanda
```

It fetches the public OnTrack auth-method redirect, inspects only the allowlisted
Okta login origin, returns counts/booleans instead of DOM or cookie values, and
never fills, clicks, submits, loads saved state, or captures tokens.
