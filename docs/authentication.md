# Authentication and session management

← [README](../README.md)

`ontrack login` supports four credential paths: pairing-relay sign-in (the
default on every environment), controlled-browser capture, manual redirect URL
import, and direct token login. Credentials are never typed into the CLI.

## Recommended login: `ontrack login`

This is the default recommended path on all environments:

```bash
ontrack login
```

This flow:

1. first probes the CLI's previously saved, OnTrack-only browser state and reuses it when valid
2. prints a one-time pairing link — you sign in in your own browser on any device, reusing an existing OnTrack session if you have one, and the credential arrives end-to-end encrypted (see the pairing section below)
3. `--auto` opts into controlled-browser capture instead: a visible browser window on machines with a display
4. captures the resulting credentials, exchanging them through `/api/auth` only when they are not already API credentials
5. stores a local session cache
6. tells you how to install a browser runtime manually if one is missing

The retired guided terminal flow (`--sso`, `--sso-username`,
`--sso-timeout-sec`) now fails with a pointer to this behavior.

## Pairing sign-in (default on every environment)

`ontrack login` defaults to pairing mode instead of any terminal credential entry:

```text
$ ontrack login
[PAIRING SIGN-IN]
- Open the link below on any device and sign in with SSO.
- Pairing code: XXXX-XXXX-XXXX-XXXX
https://pair.markchu.work/#c=...&k=...
Waiting for pairing sign-in... (5 min left)
```

You open the link on any device (phone or laptop), sign in through the real
Monash SSO pages in your own browser — your password and MFA never leave your
device — and click the pairing bookmarklet the page gives you (first use: drag
it to your bookmarks bar once). The bookmark is permanent: each time it asks
you to paste that session's pairing link into its prompt, then it captures the
credential — on current OnTrack (doubtfire ≥11) by minting a fresh token from
the `POST /api/auth/access-token` endpoint with your HttpOnly refresh cookie,
on older versions by reading the legacy `localStorage` keys. The captured
credential is encrypted in your
browser to a one-time key only the CLI holds, and travels through a blind
relay mailbox that only ever sees ciphertext. The CLI polls the mailbox and
decrypts locally.

A minted token is already an API credential, so the CLI keeps it as it arrived
rather than replaying it through `POST /api/auth`, which answers 419 for an
already active token. The bookmarklet says which of the two it captured; when it
is an older bookmarklet that says nothing, the CLI performs one authenticated
read to find out, and only a credential OnTrack actively rejects is offered to
the exchange. If OnTrack refuses it on both paths, `login` says so and asks you
to pair again instead of leaving a dead session behind.

Pairing deliberately carries no refresh cookie: yours is HttpOnly in your own
browser, so neither the bookmarklet nor the relay can read it. A paired session
therefore cannot renew itself silently — when it expires, sign in again. Use
`--auto` on a machine with a display if you want a session that renews for a
week without re-authenticating.

- `--pair` / `--no-pair`: force pairing on/off (off means the --auto browser-capture/manual flows).
- `--relay-url URL` or `ONTRACK_RELAY_URL`: point at another relay (self-hosters);
  set it empty to disable pairing entirely.
- `--pair-timeout-sec N`: pairing wait budget (default 300, minimum 60).
- If pairing times out or the relay is unreachable, the CLI falls back to the
  manual redirect URL flow automatically.

See [PAIRING_RELAY_LOGIN_PLAN.md](PAIRING_RELAY_LOGIN_PLAN.md) for the protocol
and trust model, and the `ontrack-pair-relay` repository for the relay worker
and pairing page.

## Browser capture: `--auto`, `--show-browser`, `--hide-browser`

`--auto` is an explicit alias for the default browser-capture mode. The browser
window is visible by default on machines with a display; `--hide-browser`
forces a hidden capture (useful on headless environments together with
`--no-pair`), and `--show-browser` forces a visible one.

The capture implementation can read credentials from:

- URL query parameters
- `/api/auth` request payload
- `/api/auth` response body
- `localStorage`
- cookies

### System browser profile reuse

System browser-profile reuse is disabled by default. To opt in explicitly, set
`ONTRACK_ENABLE_SYSTEM_BROWSER_PROFILE=1` (and, if needed,
`ONTRACK_BROWSER_USER_DATA_DIR` / `ONTRACK_BROWSER_PROFILE_DIR`). This may open
your selected profile for credential discovery; the CLI never copies that
profile's complete storage state and persists only the exact OnTrack origin.
Do not enable it for a shared or untrusted system profile.

## Manual redirect import (backup only)

If you already have the final redirect URL, you can import it directly:

```bash
ontrack login --redirect-url "https://ontrack.infotech.monash.edu/sign_in?authToken=...&username=..."
```

The expected redirect format looks like this:

```text
https://ontrack.infotech.monash.edu/sign_in?authToken=...&username=...
```

Browser capture automatically falls back to this manual redirect mode when the
browser flow hits captcha, selector mismatch, or timeout. Treat this as a backup
path rather than a daily login path. When the CLI must print the SSO entry URL
for manual use, it preserves the full query only after HTTP(S), credential,
control-character, and length validation. Unsafe server-provided URLs are not
echoed to the terminal.

## Direct token login

If you already have a token and username:

```bash
ontrack login --auth-token <token> --username <username>
```

## Session cache and silent renewal

After login, the CLI stores the access token locally and requests a persistent
session, so the server's refresh cookie (about one week) is kept in a separate
restricted browser-state file. Authenticated commands renew near-expiry tokens
silently over plain HTTP when possible, without launching a browser, so users
do not normally sign in for every run. Monash can still require verification
when its refresh or SSO policy expires.

The API client authenticates with these headers:

- `Auth-Token`
- `Username`

### Session cache location

Default session file location:

- macOS / Linux: `~/.config/ontrack-cli/session.json`
- Windows: `%APPDATA%\ontrack-cli\session.json`

The CLI creates the directory automatically and writes the session file with
stricter permissions where the platform allows it.

### Browser refresh state location

The exact-origin browser state used for silent renewal is stored separately:

- macOS / Linux: `~/.config/ontrack-cli/browser-state.json`
- Windows: `%USERPROFILE%\AppData\Roaming\ontrack-cli\browser-state.json`

The directory is restricted to `0700` and the file to `0600` where supported.
The path is fixed under the operator home and cannot be redirected by
environment variables. The Auth MCP consumes this state internally but never
returns it to its caller.

## Login flow output

`ontrack login` renders sign-in progress with styled terminal panels and event lines:

- pairing sign-in panel with the one-time link and pairing code
- login success panel with account, role, and suggested next commands

## TUI login

The experimental TUI (`bun run tui`) has an in-TUI login wizard with no
credential fields. It runs the pairing-relay flow first on every environment —
the pairing link and code are rendered in the wizard, reusing any existing
OnTrack session in your own browser — and falls back to a controlled browser
window only when pairing is disabled. The TUI is not yet wired into the
`ontrack` entry point.

## Logout

```bash
ontrack logout
```
