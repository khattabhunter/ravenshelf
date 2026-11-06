# Build Atlas from source

## Requirements

- Windows x64 for the supported desktop build and installed-game scanner.
- Node.js 24 with npm, matching the repository workflow. The currently pinned dependencies require at least Node.js 22.19.0.
- Git if cloning the repository; alternatively, extract a source ZIP.
- Internet access to install dependencies and obtain Electron/build tools. The normal test suite uses offline fixtures.

Node is needed for development and building, not for running the packaged executable. Administrator rights are not normally needed.

## Install, test and run

```powershell
git clone https://github.com/khattabhunter/atlas-library.git
cd atlas-library
npm ci
npm test
npm start
```

`npm ci` installs the versions in `package-lock.json`. Electron's installation may download its runtime. Keep the lockfile with dependency changes; avoid substituting unreviewed packages or bypassing Windows security controls to make a build succeed.

The development app uses the same normal profile name as the packaged app. Close another Atlas instance before running it. For development that must not touch your normal profile, use a dedicated directory:

```powershell
$env:ATLAS_TEST_DIR = Join-Path $PWD '.local-test-profile'
npm start
```

With `ATLAS_TEST_DIR` set, Atlas uses that separate profile and disables actual system completion actions. Clear the variable when finished:

```powershell
Remove-Item Env:ATLAS_TEST_DIR
```

## Create a Windows executable

```powershell
npm run dist
```

The portable executable is written to `dist/Atlas-Library-<version>-Windows.exe`. An unpacked app is also available in `dist/win-unpacked/` for inspection. Close any app running from the output directory before rebuilding it.

The build configuration produces an unsigned Windows x64 portable application. It does not configure a signing certificate, auto-updater service or Linux/macOS release. Electron-builder may download packaging tools on the first build.

The repository's **Build Windows preview** GitHub Actions workflow can also produce a Windows artifact. In the repository's **Actions** tab, select that workflow and choose **Run workflow**. Its `atlas-windows-x64-<run number>` artifact contains the executable and `SHA256SUMS.txt`. The separate **Test** workflow runs the automated suite.

Workflow artifacts are build outputs. For a release download link, a maintainer can publish the reviewed files or use the release workflow below.

## Tests

```powershell
npm test
```

The automated suite covers catalogue parsing/refresh, link checks, network restrictions, filenames, download byte integrity, parallel connections and fallback, pause/resume, renderer state, installed-game metadata and finish-action scheduling. Its host responses and installed-game records are fixtures, so running it does not download games or shut down the laptop.

Passing tests establish the exercised cases, not that every host response, Windows setup or third-party file is safe. Keep live checks separate and bounded; do not make the normal test command depend on file-host availability or personal download links.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/main.cjs` | Electron windows, app lifecycle and renderer messaging. |
| `src/preload.cjs` | Narrow bridge between the isolated renderer and main process. |
| `src/renderer/` | Catalogue, library, settings and download interface. |
| `src/providers.cjs` | Source-page, paste and file-host adapters. |
| `src/fast-session.cjs` | Restricted FuckingFast browser-session requests. |
| `src/net.cjs`, `src/ff-policy.cjs` | Address, redirect and host-file checks. |
| `src/downloads.cjs`, `src/parallel-download.cjs` | Queue, file writes, section checkpoints and fallback. |
| `src/catalog*.cjs` | Catalogue sections and background refresh. |
| `src/installed-games.cjs`, `src/installed-scan.ps1` | Read-only installation and version discovery. |
| `src/completion-action.cjs` | Queue completion and cancellable finish actions. |
| `test/` | Automated tests and synthetic test data. |

## Preparing a release

1. Review application changes and update `CHANGELOG.md`.
2. Keep the version in `package.json` and the lockfile synchronized.
3. Run `npm ci`, `npm test` and `npm run dist` on Windows.
4. Open the packaged application using a separate test profile and check the affected flows. Do not use real shutdown actions for tests.
5. Generate a checksum for the exact executable being published:

   ```powershell
   Get-FileHash -Algorithm SHA256 '.\dist\Atlas-Library-<version>-Windows.exe'
   ```

6. Create a matching release tag and attach the reviewed executable and checksum file. Publish source through Git, not a copy of the app's local profile or build cache.

Alternatively, after reviewing and merging the release changes into `main`, a maintainer can select **Publish Windows prerelease** (`.github/workflows/publish-release.yml`) in the repository's **Actions** tab, then choose **Run workflow** with branch `main`. No other inputs are required. The workflow installs dependencies, runs tests and builds on Windows with Node.js 24, then publishes a prerelease tagged `v<package version>` with the executable and `SHA256SUMS.txt`. It takes release notes from `docs/RELEASE-<version>.md`; GitHub supplies source archives for the tag. An existing tag or release, including a draft, is refused. Check that the workflow succeeds and inspect the release assets before sharing the download link.

Do not commit `node_modules`, build output, downloaded archives, host cookies, queue/history files or machine-specific scan results.
