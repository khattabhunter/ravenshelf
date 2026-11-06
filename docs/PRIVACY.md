# Privacy and network access

Publishing Atlas's source does not grant repository visitors access to your laptop. Atlas does not provide a remote-control server, and it does not upload your installed-game inventory to an Atlas service. Using online features still sends requests to the sites involved, which can see the IP address used for those connections.

## What is public on GitHub

The publication review on 6 November 2026 checked the published 0.2.3 source, both commits, release metadata and public build logs. It found no personal laptop paths, personal email addresses, saved download history, browser profiles, real session cookies or known private download identifiers in those materials. The repository owner name and GitHub no-reply commit identity are public by design.

The public Windows release is built on GitHub-hosted Windows machines from the tagged source. Paths in those build logs belong to the hosted runner. Network addresses and credentials in tests are fixtures, not a record of the developer's network or accounts. This is a scoped review, not proof that every future change or dependency is free of privacy defects.

## What leaves your computer during normal use

| Feature | Destination and information involved |
| --- | --- |
| Catalogue and images | The catalogue source and image hosts receive page or image requests. Automatic refresh continues while Atlas is open, including when minimized. |
| Link checking and downloads | Paste services, selected file hosts and their download servers receive the relevant URLs and normal request information. Host-session cookies or request headers may be needed to access a file. |
| Gameplay | YouTube and the services it uses receive the chosen game's search terms and playback requests. The separate viewer can keep its own site session data. |
| Guides and source pages | These open in your ordinary browser. The destination receives the requested page or search; that browser's cookies and privacy settings apply. |
| Send to JDownloader | An explicit handoff sends the selected links to JDownloader's local Click'n'Load interface on the same computer. JDownloader then handles its own network requests. |

Those Internet services can see the connection's public IP and normal HTTP information. Depending on the request, they may also receive a user-agent, referrer, cookies or a game search term. Atlas's own application code has no analytics endpoint or automatic upload of the installed-games scan. That does not make external websites anonymous or prevent their own logging.

Atlas does not configure, verify or enforce a VPN or proxy. Browser traffic and Node-based file requests can follow different proxy settings. A proxy enabled only in your browser should not be assumed to cover Atlas's downloads. Popup blocking and download checks do not hide your IP address.

## Data kept locally

Atlas's Windows profile stores settings, saved collections, download queue/history, installed-game metadata and separate host-browser session data. Download records can include local paths, signed URLs and request headers. Cookie storage and other browser state also remain in that profile. Downloaded files and partial-transfer support files live in the selected download folder.

Treat these files and backups as private. They are not a secure vault: another local account or program with sufficient file access may be able to read them. Do not publish the profile, `library.json`, `installed-games.json`, cookies, signed links, `.atlas-part` files or `.atlas-segments-*` folders. The repository's ignore rules help avoid accidental commits, but cannot prevent someone deliberately uploading a file.

See [the user guide](USER-GUIDE.md#local-data-and-troubleshooting) for the profile location and [SECURITY.md](../SECURITY.md) for safe reporting. Redact usernames, personal paths and private links from screenshots or logs before sharing them.

## Image-request hardening in 0.2.4

Version 0.2.4 routes catalogue images through Atlas's checked HTTPS transport, rejects private/local IP destinations at connection time and after redirects, and does not attach browser-session cookies or referrers to image requests. Responses are limited to 12 MiB and 15 seconds and must have a matching PNG, JPEG, GIF or WebP type and file signature; SVG and HTML are rejected. The renderer's content policy blocks direct remote images. Automated checks cover these boundaries, including private DNS answers, redirects and stalled or oversized responses.

These checks concern where images can connect; they do not conceal the connecting IP or certify an image host as trustworthy. The older 0.2.3 executable does not have this guard; download 0.2.4 or newer for this protection.

## Limits

Atlas's transfer validation and protected host windows are not an antivirus scan. A valid link or successfully downloaded archive can still contain harmful software. Atlas does not automatically extract archives or run downloaded installers. The installed-game scan reads local metadata without launching the programs it finds.

No source review can guarantee that a laptop is inaccessible or free of malware. Windows account permissions, other installed software, browser extensions and services outside Atlas are separate from this project's protections.
