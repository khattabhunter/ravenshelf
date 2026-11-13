# Ravenshelf

[![Tests](https://github.com/khattabhunter/ravenshelf/actions/workflows/test.yml/badge.svg)](https://github.com/khattabhunter/ravenshelf/actions/workflows/test.yml) [![CodeQL](https://github.com/khattabhunter/ravenshelf/actions/workflows/codeql.yml/badge.svg)](https://github.com/khattabhunter/ravenshelf/actions/workflows/codeql.yml)

**A privacy-hardened game catalogue and batch download manager for Windows.** Browse the live FitGirl catalogue, build your own shelves of games, see what is installed on your PC and manage multipart downloads with pause, resume and up to four connections per file. No account or app telemetry, and every finished file can be checked by Microsoft Defender.

**[Download for Windows](https://github.com/khattabhunter/ravenshelf/releases/tag/v0.10.3)** · **[Security](#security)** · **[User guide](docs/USER-GUIDE.md)** · **[Privacy](docs/PRIVACY.md)** · **[Changelog](CHANGELOG.md)**

> Ravenshelf was called **Atlas Library** up to version 0.2.5. Updating keeps your library, collections and download queue.

## Get started

1. Open the [v0.10.3 prerelease](https://github.com/khattabhunter/ravenshelf/releases/tag/v0.10.3) and download `Ravenshelf-0.10.3-Windows.exe` from **Assets**.
2. Optional but recommended: [verify the download](#verify-your-download).
3. Open the executable. It is portable: no installer or administrator rights are needed.
4. Browse **Discover**, open a game and choose a file host.
5. Select **Check download links**, review the results and choose **Download all** when the required files are ready.

The preview is not code-signed, so Windows may show a SmartScreen notice the first time. Do not turn off Windows security protections to use Ravenshelf. Only obtain files you have permission to download.

Version **0.10.3** adds a choice to keep Ravenshelf running in the background with a tray icon, sends browser Save image, video, audio and file downloads to Ravenshelf for review, and includes fixes from independent reviews: for example, Chrome now waits for a file's real name before deciding, and a full exit can no longer hang ([release notes](docs/RELEASE-0.10.3.md)). Version 0.10.2 fixed saved lists reached through a junction and hardened the torrent tracker check ([release notes](docs/RELEASE-0.10.2.md)). Existing settings and downloads stay in place. Reload the browser extension after updating to activate its changes.

Version 0.10.0 adds more ways to download: **torrents** from magnet links (off until you agree to what torrents share, with aria2 fetched once and checked), **PixelDrain** and **MultiUpload** links, and FitGirl's new paste address; ZippyShare, BayFiles and LetsUpload are named as closed instead of tried ([release notes](docs/RELEASE-0.10.0.md), [guide](docs/USER-GUIDE.md#torrent-downloads)). Version 0.9.0 added **Can you run it?**: a game's details compare its Steam requirement lists with this PC, line by line, and Ravenshelf warns before you queue files that won't fit on the download drive ([release notes](docs/RELEASE-0.9.0.md), [guide](docs/USER-GUIDE.md#can-you-run-it)). Version 0.8.0 added Arabic, chosen in **Settings → Language**, and a **Mods** page that lists the mod files you downloaded on Nexus Mods, by game ([release notes](docs/RELEASE-0.8.0.md), [Language](docs/USER-GUIDE.md#language), [Mods](docs/USER-GUIDE.md#the-mods-page)). Version 0.7.0 added a **PC specs** page that shows what is inside this PC without sending it anywhere, and files the mods you download on Nexus Mods by game ([release notes](docs/RELEASE-0.7.0.md)). Version 0.6.1 makes YouTube's one-time setup take about a minute and YouTube downloads faster ([release notes](docs/RELEASE-0.6.1.md)). Version 0.6.0 added YouTube downloads: a Ravenshelf button in YouTube's player with a choice of quality, and **Download with Ravenshelf** when you right-click a video. A one-time setup fetches the helper programs it needs from their official releases and checks every file ([release notes](docs/RELEASE-0.6.0.md), [guide](docs/USER-GUIDE.md#youtube-downloads)). Version 0.5.0 added a browser extension for Chrome, Edge, Brave and Firefox: downloads you start in the browser go to Ravenshelf to be checked before anything is saved, dangerous sites are blocked, and FuckingFast and FileKeeper pages can no longer redirect you or open pop-ups elsewhere. It is off until you connect it in **Settings → Browser extension**. See the [0.5.0 release notes](docs/RELEASE-0.5.0.md) and [the extension guide](docs/USER-GUIDE.md#browser-extension).

## Security

Ravenshelf is built so that a bad web page, a bad link or a bad file has as little power as possible.

| Protection | What it means for you |
| --- | --- |
| Public release workflow | Published Windows releases are built on GitHub-hosted Windows machines after tests pass, with a matching source tag. |
| Signed build record | Each release carries a signed provenance record you can check with one command, plus a SHA-256 checksum. From 0.4.2 the app checks that record itself before downloading an update. |
| Updates ask first | Automatic checks only tell you a new version exists. Nothing is downloaded or installed until you choose **Download and install**. |
| No app telemetry | No account, analytics endpoint or automatic inventory upload. External sites still receive normal network requests. |
| Browser downloads checked first | With the optional extension, a browser download goes to Ravenshelf, which follows its redirects without your cookies and compares the file name with its real type before you decide. Disguised programs and links through listed sites are blocked. |
| Dangerous sites blocked | The extension blocks about 261,000 malware, phishing, scam and pop-up ad sites using public lists checked on your PC, and stops file-host pages from redirecting you or opening pop-ups. |
| Checked YouTube helpers | YouTube downloads use yt-dlp, Deno and FFmpeg, fetched once at fixed versions from their publishers' GitHub releases. Every file must match the SHA-256 recorded in Ravenshelf and is checked again before use. yt-dlp gets only the video's address, without your cookies, configuration files or plugins. |
| Torrents only if you agree | Torrent downloads are off until you read what torrents share (your IP address, uploading while downloading) and agree. aria2 is fetched once at a fixed version and must match its recorded SHA-256; it runs with a fixed set of options, answers only Ravenshelf on this PC with a new random secret, and stops uploading when a download finishes unless you choose to share for a while. You choose which files of a torrent to download; names Windows can't store safely, and names made to disguise a file, are refused. |
| Microsoft Defender scan | Finished files are scanned one at a time. Only an explicitly recognized clean result is labeled as no threats found; unclear results need review. You can turn automatic scans off or scan again. |
| Downloads never run by themselves | Ravenshelf never extracts archives or starts installers. Host windows only hand over archive file types. |
| Home-network protection | File and cover-image requests check public addresses at connection time and after redirects. Protected host windows have separate domain restrictions; these controls are not a universal browser-security guarantee. |
| Protected saved headers | Queue cookies and other request headers are encrypted with your Windows account. If encryption fails, they stay in memory and are omitted from saved queue data; affected links are refreshed after restart. The host browser's cookie store is also encrypted. |
| Locked-down windows | Pages run sandboxed with a strict content policy and no access to Node.js; pop-ups, off-site navigation, camera, microphone and other permissions are blocked. |
| Hardened executable | Electron's run-as-Node, `NODE_OPTIONS`, debugger flags and extra `file://` privileges are switched off. App code loads only from its packaged archive, with embedded archive-integrity validation enabled. This is hardening, not a digital publisher signature. |
| Automatic checks | Automated tests and dependency audits run on Windows for changes and releases. CodeQL's security-and-quality suite scans the code and workflows; Dependabot proposes dependency updates. A successful scan run does not mean there are no alerts. |

**Limits, honestly stated:** a Defender scan and a working link do not prove a file is safe. Ravenshelf does not hide your IP address from the websites it connects to, and with torrents everyone sharing the same torrent sees it. It is not an antivirus. See [PRIVACY.md](docs/PRIVACY.md) and [SECURITY.md](SECURITY.md) for details and how to report a problem privately.

### Verify your download

Calculate the downloaded file's checksum in PowerShell:

```powershell
Get-FileHash .\Ravenshelf-0.10.3-Windows.exe -Algorithm SHA256
```

The result must match `SHA256SUMS.txt` on the release page. With the [GitHub CLI](https://cli.github.com/) you can also verify its build-provenance attestation against this repository:

```powershell
gh attestation verify .\Ravenshelf-0.10.3-Windows.exe --repo khattabhunter/ravenshelf
```

A matching checksum detects a mismatch with the published file; provenance records its build origin. From 0.4.2, the release's `.sigstore.json` file is the same signed record; you can pass it to the command with `--bundle .\Ravenshelf-0.10.3-Windows.exe.sigstore.json` instead of fetching it from GitHub. Neither certifies that software is malware-free, and the executable remains unsigned.

## Features

| Area | What Ravenshelf does |
| --- | --- |
| Discover | Images, descriptions, listed sizes, newest repacks, monthly popular games and genre sections including Action RPG, RPG and real-time strategy. |
| Background catalogue refresh | Checks at startup and every five minutes while Ravenshelf is open, including when minimized. |
| Personal library | Favorites and named collections. |
| Game details | Click-to-enlarge covers/screenshots, system requirements and real Steam recommendation counts when available. Stars express the positive-review ratio on a five-star scale. |
| Can you run it? | Sets each line it recognises in a game's Steam requirement lists beside this PC's specs: **Meets**, **Below** or **Can’t tell**. Only figures are compared (Windows version, 64-bit, memory, graphics memory, DirectX, free space); processor and graphics card models are not. Worked out on this PC; nothing is sent or saved. |
| Personal touches | Local genre suggestions from saved/completed games and optional artwork-colored accents with a readable fallback. |
| Downloads | Batch queues, lightweight progress updates, pause/resume, retry, persistent partial downloads and duplicate-file protection. A warning, and a tick to confirm, when checked files need more room than the download drive has free. |
| Multiple connections | Up to four connections per large file, with validated ranges and automatic fallback to one. |
| Network controls | A shared speed limit, local-time download hours and host cooldowns after limiting responses. |
| Queue cleanup | Select several entries or review completed downloads; keep files when removing entries, or explicitly confirm permanent file deletion. Storage checking separates queue-managed files, missing entries and other archives in the chosen folder; other archives are shown for reference only. Figures are estimates. |
| Archive and checksum checks | Warn about recognizable missing/duplicate parts and inconsistent sizes; manually verify local SFV, MD5 or SHA-256 manifests. These checks do not certify file safety. |
| Defender scans | Automatic Microsoft Defender scan of each finished file, with the result on its card and a **Scan again** button. |
| Link handling | Supported host adapters (including PixelDrain and MultiUpload), encrypted paste expansion, protected host windows, link export and JDownloader handoff. Hosts that have shut down are named instead of tried. |
| Torrents | Optional, off by default. Magnet links from game pages, from fitgirl-repacks.site in your browser (with the extension) or pasted: Ravenshelf shows the torrent's files, you choose which to download, and they join your queue with pause, resume and a Defender scan. A chosen upload limit, and uploading stops at the end unless you choose to share for up to 15 minutes or an hour. |
| Browser extension | Optional extension for Chrome, Edge, Brave and Firefox: browser downloads are paused for Ravenshelf review (Firefox may write initial temporary bytes before its download-created event), a right-click **Download with Ravenshelf** option, site blocking with public lists, a file-host pop-up and redirect guard, and optional VirusTotal checks with your own key. |
| YouTube downloads | A Ravenshelf button in YouTube's player (it follows the player's size in normal, theater and full-screen views) with Best, 1080p, 720p, 480p, M4A or MP3, and right-click **Download with Ravenshelf** on videos and video links. Videos join your queue with pause, resume and Defender scans, in a **YouTube** folder. |
| Nexus Mods downloads | With the browser extension, files you download on Nexus Mods are recognised, checked like any browser download, saved in `Mods\<game>` and downloaded over one connection. No Nexus Mods account, API key or browser cookies are used. |
| Mods | Lists the mod files you downloaded on Nexus Mods, by game and newest first, with search, a link to each mod's page in your own browser and the file's folder. Ravenshelf itself never contacts Nexus Mods. |
| Languages | English or Arabic (right to left, with 0 1 2 3 or ٠ ١ ٢ ٣ digits). The browser extension follows the app. |
| On this PC | Reads supported launcher records and local file metadata to show installed games and reported versions. |
| PC specs | Shows this PC's processor, graphics adapters (with their real graphics memory), memory, drives, display and Windows version. Read on this PC the first time you open the page (or compare a game with this PC) after starting Ravenshelf, and again with **Check again**; never saved or sent anywhere. |
| Gameplay and guides | YouTube gameplay search in a separate viewer, plus clearly labeled guide searches. |
| Finish actions | Optional app close or laptop shutdown after transfers and requested scans finish successfully, with a cancellable countdown and a final safety check. Unclear or adverse scan results block the action. |
| Convenience | Optional desktop notices and an opt-in copied-link tray. Copied links require review and checking before downloading. |
| App updates | The Windows portable release tells you when a new GitHub release is available. After you choose **Download and install**, it verifies the release's signed build record and checksum, downloads it and applies it on normal close or with an idle restart. It then cleans up leftover update files. |

## Host support

| Source | Status in 0.10.0 |
| --- | --- |
| FuckingFast | Normal host pages and download responses are checked through an isolated browser session without executing page scripts or clicking ads. Real verification challenges may still require a browser step. |
| FileKeeper | Normal free-download form and countdown supported. Passwords and CAPTCHAs remain manual. |
| DataNodes | Browser steps required; import a final direct HTTPS link or hand the set to JDownloader. |
| PixelDrain | File links are checked through PixelDrain's public file information and downloaded over one connection; lists are expanded into their files. A browser check or a used-up free daily limit needs your browser or another mirror. |
| MultiUpload | Mirror pages are read, and each file uses its copy on a supported host (FuckingFast, FileKeeper, PixelDrain or DataNodes). |
| FitGirl pastes | Encrypted pastes at `paste.fitgirl-repacks.site` and the newer `pastefg.hermietkreeft.site` are decrypted on your PC. |
| ZippyShare, BayFiles, LetsUpload | Closed (ZippyShare in March 2023, BayFiles in August 2023; LetsUpload has shut down too). Ravenshelf names them as shut down and never contacts them, not even through a redirect. |
| Torrents (magnet links) | Optional, with aria2 1.37.0 (see [Torrent downloads](docs/USER-GUIDE.md#torrent-downloads)). Version 2 torrents are not supported yet. |
| Direct HTTPS files | Supported, with resume and parallel connections when the server provides reliable range information. |

## Updating

**Settings → Ravenshelf updates** checks this repository for newer published versions, including prereleases. Automatic checks are on by default while the packaged Windows portable app is running; you can turn them off and still check manually. From 0.4.2, a check only tells you that a version is available, with **What’s new** linking to its release page. Nothing is downloaded until you choose **Download and install**. The verified update installs when you exit Ravenshelf fully; **Restart now** is available when work is idle. From 0.10.3, hiding the window in the background keeps checks running and does not install an update.

Before downloading, the updater verifies the release's signed build record: it must come from this repository's release workflow on `main`, on a GitHub-hosted runner, and name the exact executable and SHA-256. The executable must also match GitHub's asset digest and the release checksum file. Critical profile files are backed up before the portable executable is replaced, and leftovers from finished updates are removed afterwards. These checks do not provide Windows publisher signing or prove the code is harmless. Updating from 0.4.1 to 0.4.2 still uses 0.4.1's automatic preparation. See [the update guide](docs/USER-GUIDE.md#start-and-update-ravenshelf).

For an older Atlas/Ravenshelf version or a manual update, exit the older app fully, download the new executable from [Releases](https://github.com/khattabhunter/ravenshelf/releases), then open it. From 0.10.3, use **Exit Ravenshelf** rather than hiding its window. Your library and queue are stored separately and are kept. Keep partial files and their accompanying `.atlas-segments-*` folders in place so unfinished downloads can resume.

## Important limits

- Catalogue refresh updates listings. It does not install games or apply game patches.
- Ravenshelf handles direct HTTPS downloads and, when you turn them on, torrents. Torrents share pieces with other people while they download, and everyone sharing the same torrent can see your IP address; only a VPN hides it, and Ravenshelf neither sets one up nor checks for one. A torrent nobody shares can't start.
- A ready link means the host returned a file response. It is not proof that a multipart set is complete.
- If the first file check omits its size, Ravenshelf tries a small range request. Some hosts still do not report a reliable total; the link can be ready while its size remains unknown.
- Checksum matches show agreement with the manifest you chose; they do not establish its publisher or detect every malicious file.
- Host changes, CAPTCHA checks, expired links and network conditions can affect availability and speed. Multiple connections do not guarantee a speed increase.
- Ravenshelf does not automatically extract archives or run downloaded installers. The installed-game scan does not launch the games it finds.
- Mod files from Nexus Mods are downloaded, not installed or checked against your games. They use one connection, the site's waiting time is not skipped, and **Mod manager download** buttons are not handled.
- **PC specs** shows what Windows reports, and leaves a detail out when Windows gives no trustworthy figure. **Can you run it?** compares only figures; it does not rank processors or graphics cards, and **Meets** is not a promise of how well a game runs.
- The browser extension handles files the browser downloads and single YouTube videos; it does not save videos from other sites. It is loaded in Developer mode (Chrome, Edge, Brave) or as a temporary add-on (Firefox) because it isn't in the browser stores, and the Chrome Web Store does not allow YouTube downloaders.
- Only download YouTube videos you own, that use a Creative Commons licence, or that you have permission to save: YouTube's terms allow downloading only where YouTube offers it or with permission. Ravenshelf doesn't use your YouTube sign-in, so age-restricted, members-only and private videos can't be downloaded, nor live streams before they end. When YouTube changes, downloads can fail until a Ravenshelf update brings a newer yt-dlp.
- There is no built-in proxy/VPN kill switch or Brave Search API integration. Normal site requests still expose the connection IP; network-interface binding alone would not guarantee leak prevention.

See the [user guide](docs/USER-GUIDE.md) for downloading, resume behavior, Defender scans, installed versions, troubleshooting and local data storage.

## Development

Use Node.js 24 with npm, matching the repository's build workflow. From a source checkout:

```powershell
npm ci
npm test
npm start
```

To build the Windows portable executable:

```powershell
npm run dist
npm run verify:build
```

The output appears in `dist/`. The verification command inspects the packaged executable's Electron fuse settings and the native updater's source/build-record/output hashes. Building the helper requires the system .NET Framework C# compiler. See [BUILDING.md](docs/BUILDING.md) for requirements, validation and packaging details, and [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## License and independence

Ravenshelf's original source is licensed under the [MIT License](LICENSE). Dependencies and external catalogue content retain their own licenses and rights. See [NOTICE.md](NOTICE.md).

Ravenshelf is an independent project and is not affiliated with FitGirl, Hydra, Sigma, Microsoft or any file host.
