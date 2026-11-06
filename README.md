# Ravenshelf

[![Tests](https://github.com/khattabhunter/ravenshelf/actions/workflows/test.yml/badge.svg)](https://github.com/khattabhunter/ravenshelf/actions/workflows/test.yml) [![CodeQL](https://github.com/khattabhunter/ravenshelf/actions/workflows/codeql.yml/badge.svg)](https://github.com/khattabhunter/ravenshelf/actions/workflows/codeql.yml)

**A privacy-hardened game catalogue and batch download manager for Windows.** Browse the live FitGirl catalogue, build your own shelves of games, see what is installed on your PC and manage multipart downloads with pause, resume and up to four connections per file. No account, no tracking, and every finished file can be checked by Microsoft Defender.

**[Download for Windows](https://github.com/khattabhunter/ravenshelf/releases/tag/v0.3.0)** · **[Security](#security)** · **[User guide](docs/USER-GUIDE.md)** · **[Privacy](docs/PRIVACY.md)** · **[Changelog](CHANGELOG.md)**

> Ravenshelf was called **Atlas Library** up to version 0.2.5. Updating keeps your library, collections and download queue.

## Get started

1. Open the [v0.3.0 release](https://github.com/khattabhunter/ravenshelf/releases/tag/v0.3.0) and download `Ravenshelf-0.3.0-Windows.exe` from **Assets**.
2. Optional but recommended: [verify the download](#verify-your-download).
3. Open the executable. It is portable: no installer or administrator rights are needed.
4. Browse **Discover**, open a game and choose a file host.
5. Select **Check download links**, review the results and choose **Download all** when the required files are ready.

The preview is not code-signed, so Windows may show a SmartScreen notice the first time. Do not turn off Windows security protections to use Ravenshelf. Only obtain files you have permission to download.

## Security

Ravenshelf is built so that a bad web page, a bad link or a bad file has as little power as possible.

| Protection | What it means for you |
| --- | --- |
| Built in the open by GitHub | Every release is built from the tagged source on GitHub's own Windows machines, after the full test suite passes. Nothing is built on a personal PC. |
| Signed build record | Each release carries a signed provenance record you can check with one command, plus a SHA-256 checksum. |
| No tracking | No account, no analytics and no telemetry. Your library and installed-game scan stay on your PC. |
| Microsoft Defender scan | Finished files are scanned with Microsoft Defender one at a time, and the result is shown on each download card. You can turn this off or scan again at any time. |
| Downloads never run by themselves | Ravenshelf never extracts archives or starts installers. Host windows only hand over archive file types. |
| Home-network protection | Requests to your router or other local devices are blocked, checked again at connection time and after every redirect, so a web page cannot use Ravenshelf to reach your home network. |
| Encrypted cookies | Host cookies saved with your queue, and the host browser's cookie store, are encrypted with your Windows account. |
| Locked-down windows | Pages run sandboxed with a strict content policy and no access to Node.js; pop-ups, off-site navigation, camera, microphone and other permissions are blocked. |
| Hardened executable | Electron's run-as-Node, `NODE_OPTIONS`, debugger flags and extra `file://` privileges are switched off, and app code loads only from its packaged archive, so other programs cannot reuse Ravenshelf to run their own code. |
| Automatic checks | Over 200 automated tests run on Windows for every change and release. CodeQL scans the code and workflows, and Dependabot proposes dependency updates. |

**Limits, honestly stated:** a Defender scan and a working link do not prove a file is safe. Ravenshelf does not hide your IP address from the websites it connects to, and it is not an antivirus. See [PRIVACY.md](docs/PRIVACY.md) and [SECURITY.md](SECURITY.md) for details and how to report a problem privately.

### Verify your download

Check that the file is exactly the one GitHub built, in PowerShell:

```powershell
Get-FileHash .\Ravenshelf-0.3.0-Windows.exe -Algorithm SHA256
```

The result must match `SHA256SUMS.txt` on the release page. With the [GitHub CLI](https://cli.github.com/) you can also confirm it was built by this repository's release workflow:

```powershell
gh attestation verify .\Ravenshelf-0.3.0-Windows.exe --repo khattabhunter/ravenshelf
```

## Features

| Area | What Ravenshelf does |
| --- | --- |
| Discover | Images, descriptions, listed sizes, newest repacks, monthly popular games and genre sections including Action RPG, RPG and real-time strategy. |
| Background catalogue refresh | Checks at startup and every five minutes while Ravenshelf is open, including when minimized. |
| Personal library | Favorites and named collections. |
| Downloads | Batch queues, progress, pause/resume, retry, persistent partial downloads and duplicate-file protection. |
| Multiple connections | Up to four connections per large file, with validated ranges and automatic fallback to one. |
| Defender scans | Automatic Microsoft Defender scan of each finished file, with the result on its card and a **Scan again** button. |
| Link handling | Supported host adapters, encrypted paste expansion, protected host windows, link export and JDownloader handoff. |
| On this PC | Reads supported launcher records and local file metadata to show installed games and reported versions. |
| Gameplay and guides | YouTube gameplay search in a separate viewer, plus clearly labeled guide searches. |
| Finish actions | Optional app close or laptop shutdown after successful queue completion, with a cancellable countdown. |

## Host support

| Source | Status in 0.3.0 |
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
```

The output appears in `dist/`. See [BUILDING.md](docs/BUILDING.md) for requirements, validation and packaging details, and [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## License and independence

Ravenshelf's original source is licensed under the [MIT License](LICENSE). Dependencies and external catalogue content retain their own licenses and rights. See [NOTICE.md](NOTICE.md).

Ravenshelf is an independent project and is not affiliated with FitGirl, Hydra, Sigma, Microsoft or any file host.
