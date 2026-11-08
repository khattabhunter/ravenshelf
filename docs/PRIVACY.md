# Privacy and network access

Publishing Ravenshelf's source does not grant repository visitors access to your laptop. Ravenshelf does not provide a remote-control server, and it does not upload your installed-game inventory to a Ravenshelf service. Using online features still sends requests to the sites involved, which can see the IP address used for those connections.

## What is public on GitHub

The publication review on 6 November 2026 checked the published 0.2.3 source, both commits, release metadata and public build logs. It found no personal laptop paths, personal email addresses, saved download history, browser profiles, real session cookies or known private download identifiers in those materials. The repository owner name and GitHub no-reply commit identity are public by design.

The public Windows release is built on GitHub-hosted Windows machines from the tagged source. Paths in those build logs belong to the hosted runner. Network addresses and credentials in tests are fixtures, not a record of the developer's network or accounts. This is a scoped review, not proof that every future change or dependency is free of privacy defects.

## What leaves your computer during normal use

| Feature | Destination and information involved |
| --- | --- |
| Catalogue and images | The catalogue source and image hosts receive page or image requests. Automatic refresh continues while Ravenshelf is open, including when minimized. |
| Link checking and downloads | Paste services, selected file hosts and their download servers receive the relevant URLs and normal request information. Host-session cookies or request headers may be needed to access a file. |
| Gameplay | YouTube and the services it uses receive the chosen game's search terms and playback requests. The separate viewer can keep its own site session data. |
| Guides and source pages | These open in your ordinary browser. The destination receives the requested page or search; that browser's cookies and privacy settings apply. |
| Game requirements and recommendations | Opening game details can request the linked app's public metadata from Steam. Steam receives that app ID and normal connection information; Ravenshelf does not upload your installed-game inventory or local preference profile. |
| App update checks | With automatic checks enabled in the Windows portable release, GitHub's API receives a request for this repository's release list when Ravenshelf starts and every six hours. Manual Check for updates does the same. A check downloads nothing else. |
| App update downloads (0.4.2 and later) | Only after you choose **Download and install**: GitHub's release download hosts receive requests for the checksum file, the signed build record and the executable. Sigstore's TUF service (`tuf-repo-cdn.sigstore.dev`) receives requests for its public signing-key metadata, used to check the record. If that service cannot be reached, Ravenshelf uses the copy bundled with the app. |
| Send to JDownloader | An explicit handoff sends the selected links to JDownloader's local Click'n'Load interface on the same computer. JDownloader then handles its own network requests. |

Those Internet services can see the connection's public IP and normal HTTP information. Depending on the request, they may also receive a user-agent, referrer, cookies or a game search term. Ravenshelf's own application code has no analytics endpoint or automatic upload of the installed-games scan. That does not make external websites anonymous or prevent their own logging.

Ravenshelf does not configure, verify or enforce a VPN or proxy. Browser traffic and Node-based file requests can follow different proxy settings. A proxy enabled only in your browser should not be assumed to cover Ravenshelf's downloads. Popup blocking and download checks do not hide your IP address.

Proxy/VPN binding and a kill switch are deferred. Binding a connection to an interface alone would not establish leak prevention across DNS, IPv4/IPv6, redirects and the separate browser/network stacks. Brave Search API integration is also deferred; using a search API would not make requests anonymous or establish a permanently free service.

## Data kept locally

Ravenshelf's Windows profile stores settings, saved collections, download queue/history, installed-game metadata and separate host-browser session data. Download records can include local paths and signed URLs. Request headers (host cookies, referrers) are saved only when Windows-account encryption succeeds in 0.3.1 (see below). Other browser state also remains in that profile. Downloaded files and partial-transfer support files live in the selected download folder.

Treat these files and backups as private. They are not a secure vault: another local account or program with sufficient file access may be able to read them. Do not publish the profile, `library.json`, `installed-games.json`, cookies, signed links, `.atlas-part` files or `.atlas-segments-*` folders. The repository's ignore rules help avoid accidental commits, but cannot prevent someone deliberately uploading a file.

The updater stages its candidate, job information and result beneath `updates/pending/` in the profile and copies critical profile files to `updates/backups/` before applying an update. These copies can contain the same sensitive paths and URLs as the original profile. They are not cloud backups and are not a complete copy of every browser partition or downloaded file. Sigstore's public key metadata is cached in `updates/sigstore/`; it contains no personal data.

From 0.4.2, Ravenshelf removes what a finished update leaves behind: the staged copy and helper in `updates/pending/`, and the previous executable that the update helper keeps next to the app as `.ravenshelf-rollback-….exe`. A rollback copy is removed only when the update's own record shows it succeeded and the copy matches, byte for byte, the executable that update replaced. After a failed update, the rollback copy and its record stay. Profile backups in `updates/backups/` are kept.

Local game suggestions use existing saved/completed-game genre information. Adaptive accents sample an already loaded cover locally. Neither feature sends a preference model or image pixels to an additional service. Normal catalogue and cover requests still occur.

### Optional clipboard recognition

Clipboard recognition is off by default. While enabled, Ravenshelf reads text periodically, recognizes only supported HTTPS host/paste links, and keeps at most 100 recent link entries in memory for up to 30 minutes. It does not save a clipboard history or log the clipboard text. Turning it off or closing the app clears its entries. Other clipboard text is inspected transiently to recognize supported links; do not treat the feature as reading only preselected text.

Recognition and **Inspect link** make no network requests on their own. Inspect fills the import form; **Check links** is a separate user action that sends the selected URLs to their destinations. Encrypted-paste fragments and temporary file links can still be sensitive even while held locally.

### Verification and notifications

Manual checksum verification reads only the selected manifest and files beneath the selected folder, subject to path and size checks. It does not upload them or their results. Desktop notices are local Windows notifications with generic completion/problem/update messages; they omit game names, filenames and paths. Disable **Desktop notifications** or adjust Windows notification settings if preferred.

See [the user guide](USER-GUIDE.md#local-data-and-troubleshooting) for the profile location and [SECURITY.md](../SECURITY.md) for safe reporting. Redact usernames, personal paths and private links from screenshots or logs before sharing them.

## Microsoft Defender scans

Ravenshelf asks the Microsoft Defender already installed in Windows to scan each finished download. The scan runs on your PC through Windows; Ravenshelf sends nothing to Microsoft itself. Depending on your Windows Security settings (cloud-delivered protection and automatic sample submission), Defender may send file information or samples to Microsoft, as it does for any file on your PC. You can turn automatic scans off in **Settings → Scan finished downloads**.

## Saved-header encryption and 0.3.1 fallback behavior

Request-header encryption was introduced in 0.2.5. It uses Electron `safeStorage`, which on Windows uses DPAPI keys tied to your signed-in Windows account. Headers that cannot be decrypted are discarded; Ravenshelf refreshes the affected source link before making a resumed file request.

Version 0.3.1 removes the older plaintext fallback. If encryption is unavailable or fails, headers remain in memory for the current session, while the saved queue contains empty headers and a marker requiring refresh. The app shows a warning. Queue records and partial files are kept, but after restart an affected download must resolve its source link again; it can need another browser step or fail if fresh access cannot be obtained. Ravenshelf does not send the resumed file request with silently missing credentials.

Opening an older queue removes its plaintext headers from the current saved `library.json`, sealing them when possible or omitting them when encryption fails. This does not erase older backups or other copies. Signed URLs and local paths are not covered by header encryption, so the rest of the profile remains sensitive.

The protected host browser's own Chromium cookie database is also encrypted on disk from 0.2.5 onward. This change is one-way: if you later run 0.2.4 or older with the same profile, the host windows will not be able to read those sessions and may ask you to complete host checks again.

Encryption at rest reduces exposure from copied header data and other Windows accounts. It does not protect against malware or another program already running as your Windows user, which can ask Windows to decrypt the same data.

## Image-request hardening in 0.2.4

Version 0.2.4 routes catalogue images through Ravenshelf's checked HTTPS transport, rejects private/local IP destinations at connection time and after redirects, and does not attach browser-session cookies or referrers to image requests. Responses are limited to 12 MiB and 15 seconds and must have a matching PNG, JPEG, GIF or WebP type and file signature; SVG and HTML are rejected. The renderer's content policy blocks direct remote images. Automated checks cover these boundaries, including private DNS answers, redirects and stalled or oversized responses.

These checks concern where images can connect; they do not conceal the connecting IP or certify an image host as trustworthy. The older 0.2.3 executable does not have this guard; download 0.2.4 or newer for this protection.

## Limits

Ravenshelf's transfer validation and protected host windows are not an antivirus scan. A valid link or successfully downloaded archive can still contain harmful software. Ravenshelf does not automatically extract archives or run downloaded installers. The installed-game scan reads local metadata without launching the programs it finds.

No source review can guarantee that a laptop is inaccessible or free of malware. Windows account permissions, other installed software, browser extensions and services outside Ravenshelf are separate from this project's protections.
