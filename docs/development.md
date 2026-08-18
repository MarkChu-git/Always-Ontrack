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
- [discovery.test.ts](../test/discovery.test.ts)
  - frontend bundle route and API extraction
- [logout.test.ts](../test/logout.test.ts)
  - local cleanup when remote sign-out fails
  - redacted failure output
- [utils.test.ts](../test/utils.test.ts)
  - base URL and redirect URL utilities
- [whoami.test.ts](../test/whoami.test.ts)
  - allowlisted identity projection
  - JSON and human-output secret regression checks

Minimum recommended validation before release:

```bash
bun test
bun run test:coverage
bun run build
```

If you have a valid real session, add:

```bash
bun run smoke:real -- --project-id <id> --abbr <abbr>
```

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

The normal HTTP CLI and Auth MCP do not load Playwright or any browser provider.
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
