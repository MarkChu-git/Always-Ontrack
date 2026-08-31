# Authentication and session management

← [README](../README.md)

`ontrack login` supports five credential paths: pairing-relay sign-in,
controlled-browser capture, terminal username/password (hidden-browser guided
Okta), manual redirect URL import, and direct token login.
Interactive `ontrack login` (and the TUI sign-in wizard) asks which of the first
three to use. Only the terminal path types a password into the CLI or TUI.

## Recommended login: `ontrack login`

This is the default recommended path on all environments:

```bash
ontrack login
```

This flow:

1. first probes the CLI's previously saved, OnTrack-only browser state and reuses it when valid
2. in an interactive terminal, recommends a browser window on this machine and still offers pairing or terminal username/password (`--pair` / `--auto` / `--sso` skip the prompt; non-interactive login still defaults to pairing when a relay is configured)
3. pairing prints a one-time link — you sign in in your own browser on any device, reusing an existing OnTrack session if you have one, and the credential arrives end-to-end encrypted (see the pairing section below)
4. this-machine / `--auto` opens a visible browser window on machines with a display and passively captures the resulting credentials, including a refresh cookie
5. terminal / `--sso` asks for Monash username and password in the terminal and fills Okta in a hidden browser; MFA stays in the CLI or TUI
6. captures the resulting credentials, exchanging them through `/api/auth` only when they are not already API credentials
7. stores a local session cache
8. tells you how to install a browser runtime manually if one is missing

## Pairing sign-in

Interactive `ontrack login` recommends this-machine capture as option 1
(a renewable session on this computer). Pairing is option 2. Terminal
username/password is option 3. `--auto` / `--pair` / `--sso` skip the prompt.
Non-interactive login (scripts, CI, e2e) still defaults to pairing when a
relay is configured:

```text
$ ontrack login
[SIGN IN]
- 1. This machine (recommended) — Open a browser here. Renews silently for about a week.
- 2. Pairing — Use any already signed-in browser. Short session.
- 3. Terminal — Type username and password here. Hidden browser fills Okta.
How do you want to sign in? [1/2/3] (1 recommended): 2
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
already active token. One authenticated read confirms the credential before
anything is stored, so a dead one is reported by `login` itself instead of
failing every later command. A credential the server rejects is only offered to
the exchange when the bookmarklet did not say what it captured — an older
bookmarklet may have caught a pending one-time login token from the landing URL.
Either way, if OnTrack refuses it, `login` asks you to pair again instead of
leaving a dead session behind.

### How long a paired session lasts, and why it cannot last longer

A paired session lives exactly as long as the access token it was handed —
OnTrack has been observed issuing ten minutes — and `login` says so. This is a
property of the OnTrack API, not a gap in the pairing implementation, and it is
worth spelling out because the obvious fixes all fail on inspection of
[doubtfire-api](https://github.com/doubtfire-lms/doubtfire-api) and
[doubtfire-web](https://github.com/doubtfire-lms/doubtfire-web):

- Only `POST /api/auth` returns a refresh cookie, and it only accepts a pending
  one-time login token. Those tokens come from `generate_temporary_authentication_token!`,
  which expires them after **30 seconds**, and the web app spends the one in the
  `sign_in` landing URL as soon as `/api/auth/method` answers — the server then
  destroys it. So there is no window, human or automated, in which a page's
  JavaScript can hand a spendable login token to the CLI.
- The refresh cookie itself is `HttpOnly` with `path=/api/auth`, so no
  bookmarklet, pairing page, or relay can ever read it.
- Renewal (`POST /api/auth/access-token`) requires that cookie, and no endpoint
  renews an access token from the access token alone. A paired session therefore
  cannot keep itself alive either.

So pair again when the session expires, or choose this-machine / `--auto` on a
machine with a display: that flow does the real SSO sign-in in a browser the CLI
controls, which is what puts a renewable refresh cookie (about one week) on disk.

- `--pair` / `--auto` / `--sso` / `--no-pair`: skip the interactive method prompt
  (`--no-pair` means the --auto browser-capture/manual flows).
- `--relay-url URL` or `ONTRACK_RELAY_URL`: point at another relay (self-hosters);
  set it empty to disable pairing entirely.
- `--pair-timeout-sec N`: pairing wait budget (default 300, minimum 60).
- If pairing times out or the relay is unreachable, the CLI falls back to the
  manual redirect URL flow automatically.

See [PAIRING_RELAY_LOGIN_PLAN.md](PAIRING_RELAY_LOGIN_PLAN.md) for the protocol
and trust model, and the `ontrack-pair-relay` repository for the relay worker
and pairing page.

## Terminal username/password: `--sso`, `--sso-username`, `--sso-timeout-sec`

This is the previous default login: type a Monash username and password in the
terminal (or the TUI wizard). A hidden browser fills Okta; MFA (method pick,
TOTP, Okta Verify number/push) stays in the CLI or TUI. The password must be
entered interactively — `--password` and `--sso-password` are rejected so they
cannot leak through shell history or the process list.

```bash
ontrack login --sso
ontrack login --sso --sso-username you@student.monash.edu
```

`--sso-timeout-sec` defaults to 420 (minimum 60). `--show-browser` makes the
guided browser visible for debugging; the product default for this path is
hidden. If guided SSO fails, login falls back to visible browser-assisted
capture, then to the manual redirect paste.

This path can persist a refresh cookie the same way this-machine capture does,
because the CLI controls the browser. Prefer this-machine / `--auto` when a
display is available and you want to sign in through the real pages yourself.

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

That token expires 30 seconds after OnTrack issues it, and the web app spends it
on load, so copying one out of a browser that opened the page is a race you lose:
expect `login` to report a rejected credential and ask you to sign in again. This
path is for a redirect URL you can feed straight to the CLI without letting a
browser load it — the same reason the pairing page's paste box is a last resort
rather than a substitute for the bookmarklet.

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

- sign-in method panel (this machine, pairing, or terminal) in an interactive terminal
- pairing sign-in panel with the one-time link and pairing code
- guided Monash SSO panels when terminal username/password is chosen
- login success panel with account, role, and suggested next commands

## TUI login

The TUI (`ontrack` with no arguments, or `bun run tui`) has an in-TUI login
wizard. It recommends a browser on this machine and still offers pairing or
terminal username/password. Pairing renders the link and code in the wizard and
reuses any existing OnTrack session in your own browser; this-machine capture
opens a controlled browser window; terminal uses self-drawn username/password
fields and keeps MFA in the wizard (hidden browser fills Okta). Pairing is
omitted when the relay URL is empty; this-machine and terminal remain.

## Logout

```bash
ontrack logout
```
