# Atlas Library 0.2.3 — Windows preview

## Download and start

Download **Atlas-Library-0.2.3-Windows.exe** from the release assets. This is a portable Windows x64 preview; Node.js is not needed to run it. The application is unsigned. Keep Windows security protections enabled.

[User guide](https://github.com/khattabhunter/atlas-library/blob/main/docs/USER-GUIDE.md) · [Build from source](https://github.com/khattabhunter/atlas-library/blob/main/docs/BUILDING.md) · [Troubleshooting](https://github.com/khattabhunter/atlas-library/blob/main/docs/USER-GUIDE.md#local-data-and-troubleshooting)

## Included

- Visual catalogue with newest, popular and genre views, favourites and custom collections.
- Automatic catalogue refresh every five minutes while Atlas remains open.
- Batch downloads with pause/resume and 1, 2 or 4 connections per file, with single-connection fallback.
- Protected file-host browsing and FuckingFast link checks using the browser session without running page scripts.
- Installed-game detection, gameplay searches, guide links and optional close/shutdown after successful queue completion.

## Important limits

Atlas does not automatically extract, install or update installed games. File-host limits still apply; extra connections cannot guarantee faster downloads. Link checks and popup restrictions do not certify downloaded files as malware-free.

## Validation

The source includes 179 automated tests. The release workflow runs these tests on Windows before building and publishing. Live host checks are separate from this offline suite; these checks do not cover every host, Windows setup or downloaded archive.

**SHA256SUMS.txt** records the executable checksum. GitHub generates the source ZIP and tar.gz from the release tag. This public build is produced from the tagged source by GitHub Actions.
