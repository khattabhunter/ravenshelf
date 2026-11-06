# Security

Ravenshelf is a preview application. Its link checks, popup restrictions and transfer validation do not certify a website, archive or installer as safe. Downloaded files never run automatically.

## Reporting a vulnerability

Please avoid publishing exploitable vulnerability details in a public issue. Use **Security → Report a vulnerability** in this repository to send a private report to the maintainer. If that option is unavailable, open a brief issue asking for a private reporting channel, without the exploit, private links or sensitive data. No dedicated security email or response-time guarantee is currently published.

Include the Ravenshelf version, affected component, impact, and a minimal reproduction using fictional data once a private channel is available. Do not send credentials, cookies, payment information, game archives or your complete application profile. Focus reports on the latest published version.

## Data to keep private

Ravenshelf's local profile can contain download URLs, request headers, cookies, installed-game paths and saved collections. Saved download headers and the host browser's cookie store use Windows-account encryption. From 0.3.1, unavailable or failed header encryption never falls back to plaintext: headers stay in memory, are omitted from the saved queue, and require link refresh after restart. Older plaintext queue headers are removed from the current saved file; existing backups are not rewritten. The profile should still be treated as private. Do not upload profile folders, `library.json`, `installed-games.json`, browser storage, `.atlas-part` files or `.atlas-segments-*` folders to GitHub.

Redact usernames and personal paths from logs or screenshots. Signed direct-download URLs can grant temporary access and should be treated as private.

## Project boundaries

- Releases are built on GitHub-hosted Windows machines from tagged source after the test suite passes, and carry a SHA-256 checksum and a signed build-provenance attestation (`gh attestation verify <file> --repo khattabhunter/ravenshelf`).
- The executable disables Electron's run-as-Node mode, `NODE_OPTIONS`, debugger flags and extra `file://` privileges. From 0.3.1, archive-only application loading is paired with embedded ASAR-integrity validation. `npm run verify:build` inspects the actual packaged fuse values. The executable remains unsigned; these settings are not a publisher-authenticity guarantee.
- Finished downloads can be scanned with Microsoft Defender. A successful process exit alone is not labeled clean: recognized explicit clean output is required, and ambiguous output needs review. Threat or remediation evidence takes precedence. Ravenshelf does not change antivirus settings; no scan result certifies a file as harmless.
- CodeQL security-and-quality analysis, locked-dependency audits and Dependabot dependency updates run on the repository. A successful scan workflow does not mean its alert list is empty.

- The main application page uses an isolated preload bridge with a limited set of operations. Remote host and gameplay windows do not receive that bridge.
- File and cover-image requests enforce HTTPS and public-network checks. Cover images use a bounded raster-only loader without browser-session credentials. Supported-host windows restrict navigation, popups and requests, but they are not an antivirus or a universal ad blocker.
- Byte ranges and file-version validators help prevent incorrect resumptions and mixed file sections. This is separate from scanning archive contents or checking publisher-provided hashes.
- Installed-game detection reads local metadata; it does not launch discovered executables.
- Automatic app updates accept the expected portable executable only from this repository's published version tags, check its size and SHA-256 against both GitHub's asset digest and the release checksum file, and recheck the staged candidate before installation. Update requests restrict redirect destinations. These checks establish agreement with the repository's published asset, not an independent publisher signature; compromise of the repository or release infrastructure remains a trust risk.
- A native Windows helper waits for app exit before replacing the portable executable, checks file identity/digests and uses a backup for replacement recovery. Critical profile files are backed up first. It does not change PowerShell policy, request elevation, disable protections or terminate another application. This is not protection against all malicious software running as the same Windows user.
- The helper intentionally uses three Windows APIs (`CreateFile`, `GetFileInformationByHandle`, `GetFileType`) through `SafeFileHandle`. They allow file-identity/hard-link checks, rejection of reparse points and locks against replacement while verifying bytes. DLL lookup is restricted to Windows System32. CodeQL's general native-code declarations/calls notes apply to this necessary boundary; they are not suppressed, and do not by themselves identify an exploitable flaw. The signatures, ownership/disposal and failure paths are reviewed and exercised with disposable updater fixtures, including real Windows short paths, hard links, junctions, changed bytes and locked files.
- Queue cleanup defaults to removing entries while keeping files. File deletion requires a fresh preview and explicit confirmation, validates managed file identities, and reports partial failures. Its byte totals are logical estimates, not a guarantee of freed disk space.
- Archive-set checks inspect recognized filename numbering and known sizes. They cannot infer an unknown final part or establish archive completeness. Manually selected SFV/MD5/SHA-256 checks run in a bounded worker and compare local files to that manifest; a match is not evidence of authenticity or harmlessness.
- Copied-link recognition is opt-in and local. It never queues downloads or contacts a host until the user continues through link checking. Game requirements and recommendation counts are rendered as text; review stars are a conversion of Steam's positive-review ratio, not generated opinions.
- Close/shutdown completion actions are opt-in for the current session and use a cancellable countdown. Requested scans must finish cleanly; queued/running scans delay the action, while adverse or uncertain results block it. Readiness is checked again immediately before executing the action. Turning off future automatic scans does not waive an already recorded scan result.

A release checksum checks agreement with the published file. A valid build attestation records build provenance, not the safety of the code or downloaded games. Neither substitutes for an executable publisher signature.

The automatic updater does not itself verify a GitHub build-provenance attestation. Users can verify it separately with the command above. GitHub documents the asset `digest` field in its [release asset API](https://docs.github.com/en/rest/releases/assets?apiVersion=2022-11-28).

Ravenshelf has no built-in proxy/VPN enforcement or kill switch. Interface binding alone would not make both browser and download traffic leakproof. Search API integration, including Brave, is deferred and is not an anonymity or free-service guarantee.

Dependency updates and regression tests are part of maintenance, not a guarantee that all vulnerabilities have been found. See [the architecture notes](docs/ARCHITECTURE.md) for implementation boundaries and [the privacy guide](docs/PRIVACY.md) for local data and network visibility.
