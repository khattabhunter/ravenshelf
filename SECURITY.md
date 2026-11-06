# Security

Atlas is a preview application. Its link checks, popup restrictions and transfer validation do not certify a website, archive or installer as safe. Downloaded files never run automatically.

## Reporting a vulnerability

Please avoid publishing exploitable vulnerability details in a public issue. If this repository's **Security** tab offers **Report a vulnerability**, use that private reporting option. If it is unavailable, open a brief issue asking the maintainer for a private reporting channel, without the exploit, private links or sensitive data. No dedicated security email or response-time guarantee is currently published.

Include the Atlas version, affected component, impact, and a minimal reproduction using fictional data once a private channel is available. Do not send credentials, cookies, payment information, game archives or your complete application profile. Focus reports on the latest published version.

## Data to keep private

Atlas's local profile can contain download URLs, request headers, cookies, installed-game paths and saved collections. From 0.2.5, saved download headers and the host browser's cookie store are encrypted with the Windows account, but the profile should still be treated as private. The protected host browser keeps its own session data. Do not upload profile folders, `library.json`, `installed-games.json`, browser storage, `.atlas-part` files or `.atlas-segments-*` folders to GitHub.

Redact usernames and personal paths from logs or screenshots. Signed direct-download URLs can grant temporary access and should be treated as private.

## Project boundaries

- The main application page uses an isolated preload bridge with a limited set of operations. Remote host and gameplay windows do not receive that bridge.
- File and cover-image requests enforce HTTPS and public-network checks. Cover images use a bounded raster-only loader without browser-session credentials. Supported-host windows restrict navigation, popups and requests, but they are not an antivirus or a universal ad blocker.
- Byte ranges and file-version validators help prevent incorrect resumptions and mixed file sections. This is separate from scanning archive contents or checking publisher-provided hashes.
- Installed-game detection reads local metadata; it does not launch discovered executables.
- Close/shutdown completion actions are opt-in for the current session and use a cancellable countdown.

Dependency updates and regression tests are part of maintenance, not a guarantee that all vulnerabilities have been found. See [the architecture notes](docs/ARCHITECTURE.md) for implementation boundaries and [the privacy guide](docs/PRIVACY.md) for local data and network visibility.
