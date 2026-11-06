# Ravenshelf

[![Tests](https://github.com/khattabhunter/ravenshelf/actions/workflows/test.yml/badge.svg)](https://github.com/khattabhunter/ravenshelf/actions/workflows/test.yml) [![CodeQL](https://github.com/khattabhunter/ravenshelf/actions/workflows/codeql.yml/badge.svg)](https://github.com/khattabhunter/ravenshelf/actions/workflows/codeql.yml)

**A privacy-hardened game catalogue and batch download manager for Windows.** Browse the live FitGirl catalogue, build your own shelves of games, see what is installed on your PC and manage multipart downloads with pause, resume and up to four connections per file. No account or app telemetry, and every finished file can be checked by Microsoft Defender.

**[Download for Windows](https://github.com/khattabhunter/ravenshelf/releases/tag/v0.3.2)** · **[Security](#security)** · **[User guide](docs/USER-GUIDE.md)** · **[Privacy](docs/PRIVACY.md)** · **[Changelog](CHANGELOG.md)**

> Ravenshelf was called **Atlas Library** up to version 0.2.5. Updating keeps your library, collections and download queue.

## Get started

1. Open the [v0.3.2 maintenance prerelease](https://github.com/khattabhunter/ravenshelf/releases/tag/v0.3.2) and download `Ravenshelf-0.3.2-Windows.exe` from **Assets**.
2. Optional but recommended: [verify the download](#verify-your-download).
3. Open the executable. It is portable: no installer or administrator rights are needed.
4. Browse **Discover**, open a game and choose a file host.
5. Select **Check download links**, review the results and choose **Download all** when the required files are ready.

The preview is not code-signed, so Windows may show a SmartScreen notice the first time. Do not turn off Windows security protections to use Ravenshelf. Only obtain files you have permission to download.

## Security

Ravenshelf is built so that a bad web page, a bad link or a bad file has as little power as possible.

| Protection | What it means for you |
| --- | --- |
| Public release workflow | Published Windows releases are built on GitHub-hosted Windows machines after tests pass, with a matching source tag. |
| Signed build record | Each release carries a signed provenance record you can check with one command, plus a SHA-256 checksum. |
| No app telemetry | No account, analytics endpoint or automatic inventory upload. External sites still receive normal network requests. |
| Microsoft Defender scan | Finished files are scanned one at a time. Only an explicitly recognized clean result is labeled as no threats found; unclear results need review. You can turn automatic scans off or scan again. |
| Downloads never run by themselves | Ravenshelf never extracts archives or starts installers. Host windows only hand over archive file types. |
| Home-network protection | File and cover-image requests check public addresses at connection time and after redirects. Protected host windows have separate domain restrictions; these controls are not a universal browser-security guarantee. |
| Protected saved headers | Queue cookies and other request headers are encrypted with your Windows account. If encryption fails, they stay in memory and are omitted from saved queue data; affected links are refreshed after restart. The host browser's cookie store is also encrypted. |
| Locked-down windows | Pages run sandboxed with a strict content policy and no access to Node.js; pop-ups, off-site navigation, camera, microphone and other permissions are blocked. |
| Hardened executable | Electron's run-as-Node, `NODE_OPTIONS`, debugger flags and extra `file://` privileges are switched off. App code loads only from its packaged archive, with embedded archive-integrity validation enabled. This is hardening, not a digital publisher signature. |
| Automatic checks | Over 200 automated tests run on Windows for every change and release. CodeQL scans the code and workflows, and Dependabot proposes dependency updates. |

**Limits, honestly stated:** a Defender scan and a working link do not prove a file is safe. Ravenshelf does not hide your IP address from the websites it connects to, and it is not an antivirus. See [PRIVACY.md](docs/PRIVACY.md) and [SECURITY.md](SECURITY.md) for details and how to report a problem privately.

### Verify your download

Calculate the downloaded file's checksum in PowerShell:

```powershell
Get-FileHash .\Ravenshelf-0.3.2-Windows.exe -Algorithm SHA256
```

The result must match `SHA256SUMS.txt` on the release page. With the [GitHub CLI](https://cli.github.com/) you can also verify its build-provenance attestation against this repository:

```powershell
gh attestation verify .\Ravenshelf-0.3.2-Windows.exe --repo khattabhunter/ravenshelf
```

A matching checksum detects a mismatch with the published file; provenance records its build origin. Neither certifies that software is malware-free, and the executable remains unsigned.

## Features

| Area | What Ravenshelf does |
| --- | --- |
| Discover | Images, descriptions, listed sizes, newest repacks, monthly popular games and genre sections including Action RPG, RPG and real-time strategy. |
| Background catalogue refresh | Checks at startup and every five minutes while Ravenshelf is open, including when minimized. |
| Personal library | Favorites and named collections. |
| Downloads | Batch queues, lightweight progress updates, pause/resume, retry, persistent partial downloads and duplicate-file protection. |
| Multiple connections | Up to four connections per large file, with validated ranges and automatic fallback to one. |
| Defender scans | Automatic Microsoft Defender scan of each finished file, with the result on its card and a **Scan again** button. |
| Link handling | Supported host adapters, encrypted paste expansion, protected host windows, link export and JDownloader handoff. |
| On this PC | Reads supported launcher records and local file metadata to show installed games and reported versions. |
| Gameplay and guides | YouTube gameplay search in a separate viewer, plus clearly labeled guide searches. |
| Finish actions | Optional app close or laptop shutdown after transfers and requested scans finish successfully, with a cancellable countdown and a final safety check. Unclear or adverse scan results block the action. |

## Host support

| Source | Status in 0.3.2 |
| --- | --- |
| FuckingFast | Normal host pages and download responses are checked through an isolated browser session without executing page scripts or clicking ads. Real verification challenges may still require a browser step. |
| FileKeeper | Normal free-download form and countdown supported. Passwords and CAPTCHAs remain manual. |
| DataNodes | Browser steps required; import a final direct HTTPS link or hand the set to JDownloader. |
| Direct HTTPS files | Supported, with resume and parallel connections when the server provides reliable range information. |

## Updating

Close the older window (Ravenshelf or Atlas Library), download the new executable from [Releases](https://github.com/khattabhunter/ravenshelf/releases), then open it. Your library and queue are stored separately in your Windows profile and are kept. Keep partial files and their accompanying `.atlas-segments-*` folders in place so unfinished downloads can resume.

## Important limits

- Catalogue refresh updates listings. It does not install games or apply game patches.
- Ravenshelf handles direct HTTPS downloads; it does not include a torrent client.
- A ready link means the host returned a file response. It is not proof that a multipart set is complete.
- Host changes, CAPTCHA checks, expired links and network conditions can affect availability and speed. Multiple connections do not guarantee a speed increase.
- Ravenshelf does not automatically extract archives or run downloaded installers. The installed-game scan does not launch the games it finds.

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

The output appears in `dist/`. The verification command inspects the packaged executable's actual Electron fuse settings. See [BUILDING.md](docs/BUILDING.md) for requirements, validation and packaging details, and [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## License and independence

Ravenshelf's original source is licensed under the [MIT License](LICENSE). Dependencies and external catalogue content retain their own licenses and rights. See [NOTICE.md](NOTICE.md).

Ravenshelf is an independent project and is not affiliated with FitGirl, Hydra, Sigma, Microsoft or any file host.
