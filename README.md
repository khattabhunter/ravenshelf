# Atlas Library

A visual game catalogue and direct-download manager for Windows. Browse the live FitGirl catalogue, organize a personal library, inspect installed-game metadata and manage multipart downloads in one place.

**[Download the Windows preview](https://github.com/khattabhunter/atlas-library/releases/tag/v0.2.3)** · **[User guide](docs/USER-GUIDE.md)** · **[Build from source](docs/BUILDING.md)** · **[Changelog](CHANGELOG.md)**

## Get started

1. Open the [v0.2.3 release](https://github.com/khattabhunter/atlas-library/releases/tag/v0.2.3) and download `Atlas-Library-0.2.3-Windows.exe` from **Assets**.
2. Open the executable. This portable preview does not require an installer or administrator rights.
3. Browse **Discover**, open a game and choose a file host.
4. Select **Check download links**, review the results and choose **Download all** when the required files are ready.

The preview is unsigned. Check that you are using this repository's release; you can compare its SHA-256 checksum with the release checksum file. Do not disable Windows security protections to use Atlas. Only obtain files you have permission to download.

## Features

| Area | What Atlas does |
| --- | --- |
| Discover | Images, descriptions, listed sizes, newest repacks, monthly popular games and genre sections including Action RPG, RPG and real-time strategy. |
| Background catalogue refresh | Checks at startup and every five minutes while Atlas is open, including when minimized. |
| Personal library | Favorites and named collections. |
| Downloads | Batch queues, progress, pause/resume, retry, persistent partial downloads and duplicate-file protection. |
| Multiple connections | Up to four connections per large file, with validated ranges and automatic fallback to one. |
| Link handling | Supported host adapters, encrypted paste expansion, protected host windows, link export and JDownloader handoff. |
| On this PC | Reads supported launcher records and local file metadata to show installed games and reported versions. |
| Gameplay and guides | YouTube gameplay search in a separate viewer, plus clearly labeled guide searches. |
| Finish actions | Optional app close or laptop shutdown after successful queue completion, with a cancellable countdown. |

## Host support

| Source | Status in 0.2.3 |
| --- | --- |
| FuckingFast | Normal host pages and download responses are checked through an isolated browser session without executing page scripts or clicking ads. Real verification challenges may still require a browser step. |
| FileKeeper | Normal free-download form and countdown supported. Passwords and CAPTCHAs remain manual. |
| DataNodes | Browser steps required; import a final direct HTTPS link or hand the set to JDownloader. |
| Direct HTTPS files | Supported, with resume and parallel connections when the server provides reliable range information. |

## Updating

Close the older Atlas window, download the new executable from [Releases](https://github.com/khattabhunter/atlas-library/releases), then open it. Your library and queue are stored separately in your Windows profile. Keep partial files and their accompanying `.atlas-segments-*` folders in place so unfinished downloads can resume.

## Important limits

- Catalogue refresh updates listings. It does not install games or apply game patches.
- Atlas handles direct HTTPS downloads; it does not include a torrent client.
- A ready link means the host returned a file response. It is not a malware scan or proof that a multipart set is complete.
- Host changes, CAPTCHA checks, expired links and network conditions can affect availability and speed. Multiple connections do not guarantee a speed increase.
- Atlas does not automatically extract archives or run downloaded installers. The installed-game scan does not launch the games it finds.

See the [user guide](docs/USER-GUIDE.md) for downloading, resume behavior, installed versions, troubleshooting and local data storage.

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

Atlas's original source is licensed under the [MIT License](LICENSE). Dependencies and external catalogue content retain their own licenses and rights. See [NOTICE.md](NOTICE.md).

Atlas is an independent project and is not affiliated with FitGirl, Hydra, Sigma or any file host.
