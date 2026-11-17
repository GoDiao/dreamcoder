# Remote serving mode

Part of [RFC #24](https://github.com/GoDiao/dreamcoder/issues/24). This is the server half only: an opt-in mode that lets the sidecar run on a remote host and be reached through an SSH tunnel without trusting the tunnel. It does not add a remote connection to the desktop app, SSH orchestration, or a remote installer. It is not a complete remote backend and is not ready for production use: read "Not mitigated" before relying on it.

## Why a mode is needed

The sidecar treats a request as the local desktop app when it comes from a loopback address with no `Origin`, a loopback `Origin`, or `dreamcoder://localhost` (`classifyH5Request` in `src/server/h5AccessPolicy.ts`). Such requests need no token on `/api`, `/ws` and `/terminal`.

An SSH local forward ends at the remote host's loopback interface, so every tunneled request, and every other process on that host, looks like the desktop app. SSH authenticates whoever opens the tunnel; it does not tell the sidecar which principal is calling. The agent's own shell commands are such a process.

## What the mode does

Start the server with `--remote-serving` or `SERVER_REMOTE_SERVING=1`. Without either, nothing changes.

| Check | Effect |
| --- | --- |
| Startup | Refuses a non-loopback `--host`, and refuses `--auth-required` / `SERVER_AUTH_REQUIRED` together with the mode. `SERVER_REMOTE_SERVING` must be `1` or `0` (or empty); any other value, such as `true`, stops the server instead of leaving the mode off. |
| `Host` header | Must name a loopback host (`127.0.0.1`, `localhost`, `[::1]`). Anything else is refused with 403, before the URL is parsed. |
| Forwarding headers | `Forwarded`, `X-Forwarded-For/Host/Proto`, `X-Real-IP` and `Via` are refused with 403. |
| `/api/*`, `/ws/*` | The H5 access token is required for every request, whatever the address or `Origin`. `OPTIONS` preflights still reach the existing CORS handling. |
| H5 access not enabled | Operator routes answer 503. |
| `/api/h5-access/*` | Refused with 403, except `/api/h5-access/verify`. The token cannot be minted, rotated or read over HTTP. |
| `/terminal`, `/browser-host`, `/browser-mcp`, `/web-clone-browser*` | Refused with 403. A remote sidecar has no desktop browser host, and the terminal is not served in this version. |
| `/sdk/*` | Loopback, no `Origin`, and the per-session token, as before. No operator token. |
| `/proxy/*` | Loopback and no `Origin` (a browser can no longer reach it). No credential, as before. |
| Anything else | `GET`/`HEAD` only (the H5 bundle, `/health`, `/ui-pages/*`). Other methods get 403. |

The H5 token is the only operator credential. The CLI process and the tools it starts never receive it: the server stores only its hash, and the CLI's environment is built from the server's own environment and the provider settings.

## Supported setup and threat assumptions

- One OS user owns the remote host's sidecar. Do not use a shared host.
- The only way in is an SSH local forward from the operator's machine. Do not put a reverse proxy in front.
- The adversary is a permission-gated agent, including one steered by prompt injection, and network peers without the token. The mode stops them approving their own permission prompts, changing a session's permission mode, opening a shell, or editing MCP configuration through the operator routes.

## Mitigated by this change (covered by `src/server/__tests__/remote-serving.test.ts`)

- Tokenless access to `/api` and `/ws` from loopback, from a tunnel, or with a desktop, loopback or foreign `Origin`.
- A wrong, empty, malformed, regenerated or hash-as-token credential.
- A browser page, or a DNS-rebinding page, reaching `/sdk` or `/proxy` or any operator route with a hostile `Host`.
- Operator routes answering while H5 access is off or after it is disabled.
- A non-loopback bind and a combination with `--auth-required`.
- Remote use of the H5 control plane, the terminal socket and the browser-host endpoints.

## Not mitigated (known limits)

These are documented, not fixed by this change.

- **A server that ignores the mode fails open.** A build older than this change does not know `--remote-serving` and trusts the tunnel. The server's argument parser also ignores spellings it does not recognize (`--remote-serve`, `--remote-serving=true`), so a typo leaves the mode off without an error. Nothing enforces the check below automatically: you must run it yourself, every time, before using the server.
- **The `/sdk` session token is in the CLI's command line** (`--sdk-url …?token=…`). Any process of the same OS user can read it and send control requests (`session_start`, `session_send`, kanban) as that session. The approval for `StartSession` is checked in the CLI tool, not on the server. `session_start` has no permission-mode field and the new session inherits its parent's mode, so this does not raise a permission mode.
- **`/proxy` has no credential.** The CLI sends a placeholder key, so the route is protected only by loopback and the absence of `Origin`. A process on the host, or a reverse proxy that adds no forwarding header, can use the configured provider through it.
- **A valid token is full authority over the host account.** It reaches every session, any working directory, MCP `command` entries, and `bypassPermissions`. There is no per-client or per-session scope.
- **`GET /api/sessions/repository-context?workDir=…` adds any directory to the `/api/filesystem` allowlist.** The allowlist therefore limits nothing for a token holder; it exposes directory and file names and image files.
- **`/ui-pages/*` needs no credential.** The page address is the capability. Pages are served with `sandbox allow-scripts` and `connect-src 'none'`, so a page cannot reach the API.
- **Rejecting forwarding headers is a heuristic.** A proxy that adds none and rewrites `Host` to a loopback name is not detected.
- **No TLS and no rate limiting.** Traffic is plain HTTP inside the tunnel.
- **The agent can edit the sidecar's own settings files** if you approve a write there.

## Setup

On the remote host, enable H5 access once, then restart the server with the mode on.

```bash
# terminal 1: start the server normally, on loopback only
bun run src/server/index.ts --host 127.0.0.1 --port 3456

# terminal 2: enable H5 access; the token is printed once and only its hash is stored
curl -s -X POST http://127.0.0.1:3456/api/h5-access/enable

# stop the server in terminal 1 (Ctrl-C), then start it again in remote-serving mode
bun run src/server/index.ts --host 127.0.0.1 --port 3456 --remote-serving
```

Do this before any session is running: until the restart, the first server still trusts loopback. Provider keys and settings live on the remote host.

On your machine, forward a local port to the remote loopback port. `-L` is the right direction; `-R` forwards the other way.

```bash
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:3456:127.0.0.1:3456 user@remote-host
```

## Verify before you send the token

A server that ignores `--remote-serving` (an older build) treats the tunnel as trusted. Check before you use it:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3456/api/status
```

It must print `401`. `200` means the server is not enforcing the mode (an older build, or a flag that was not recognized): stop and fix it before you use the server. With the token, the same request must return `200`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3456/api/status
```

## Rollback

Restart without `--remote-serving` and without `SERVER_REMOTE_SERVING`. The mode stores nothing and changes no settings schema.

## Not covered here

The desktop app connecting to a remote sidecar, the SSH tunnel manager, reconnect and version negotiation, a remote terminal, and moving the `/sdk` token and the `StartSession` approval to the server are separate follow-ups.
