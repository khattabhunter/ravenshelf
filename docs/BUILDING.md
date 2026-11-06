# Build Ravenshelf from source

## Requirements

- Windows x64 for the supported desktop build and installed-game scanner.
- Node.js 24 with npm, matching the repository workflow. The currently pinned dependencies require at least Node.js 22.19.0.
- Git if cloning the repository; alternatively, extract a source ZIP.
- The Windows .NET Framework C# compiler (`csc.exe`) for building the native portable-update helper. The build checks the system Framework64/Framework v4.0.30319 locations; no NuGet restore or downloaded helper binary is used.
- Internet access to install dependencies and obtain Electron/build tools. The normal test suite uses offline fixtures.

Node is needed for development and building, not for running the packaged executable. Administrator rights are not normally needed.

## Install, test and run

```powershell
git clone https://github.com/khattabhunter/ravenshelf.git
cd ravenshelf
npm ci
npm test
npm start
```

`npm ci` installs the versions in `package-lock.json`. Electron's installation may download its runtime. Keep the lockfile with dependency changes; avoid substituting unreviewed packages or bypassing Windows security controls to make a build succeed.

The development app uses the same normal profile name as the packaged app. Close another Ravenshelf instance before running it. For development that must not touch your normal profile, use a dedicated directory:

```powershell
$env:ATLAS_TEST_DIR = Join-Path $PWD '.local-test-profile'
npm start
```

With `ATLAS_TEST_DIR` set, Ravenshelf uses that separate profile and disables actual system completion actions, automatic app updates, clipboard monitoring and desktop notices. Catalogue or other explicit online operations are not automatically replaced with fixtures; an offline smoke harness must provide its own fixtures. Clear the variable when finished:

```powershell
Remove-Item Env:ATLAS_TEST_DIR
```

## Create a Windows executable

```powershell
npm run dist
npm run verify:build
```

The portable executable is written to `dist/Ravenshelf-<version>-Windows.exe`. An unpacked app is also available in `dist/win-unpacked/` for inspection. Close any app running from the output directory before rebuilding it.

The `pretest` and `predist` hooks run `scripts/build-updater.cjs`. On Windows it compiles `src/updater-helper.cs` with the system .NET Framework compiler into `src/ravenshelf-updater.exe`, which is packaged with the app. On other platforms the helper build is skipped; that does not produce a supported Windows release. To diagnose the helper build separately, run `node scripts/build-updater.cjs`. See Microsoft's [C# compiler options for .NET Framework](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/#net-framework-projects).

The helper is a compiled Windows program with no PowerShell update dependency. Do not weaken execution policy or Windows security settings to build or run it. The generated executable is a build output, not source to commit.

`verify:build` runs `scripts/verify-package.cjs`: it reads the packaged Electron fuse settings and checks the native helper against its source, build script and generated build-manifest hashes. It requires embedded ASAR-integrity validation and archive-only loading alongside the other hardening values, and rejects a stale or mismatched helper. A configuration entry alone is not sufficient verification. This check does not certify the code as malware-free or provide a publisher signature.

The build configuration produces an unsigned Windows x64 portable application. It does not configure a signing certificate, background Windows service or Linux/macOS release. App-update checks run only while the portable app is open and use this repository's GitHub releases. Electron-builder may download packaging tools on the first build.

The repository's **Build Windows preview** GitHub Actions workflow can also produce a Windows artifact. In the repository's **Actions** tab, select that workflow and choose **Run workflow**. Its `ravenshelf-windows-x64-<run number>` artifact contains the executable and `SHA256SUMS.txt`. The separate **Test** workflow runs the automated suite.

Workflow artifacts are build outputs. For a release download link, a maintainer can publish the reviewed files or use the release workflow below.

## Tests

```powershell
npm test
```

The automated suite covers catalogue parsing/refresh, link checks, network restrictions, filenames, download byte integrity, parallel connections and fallback, pause/resume, renderer state, installed-game metadata, Defender-result interpretation, completion/scan ordering and header-encryption failures. Its host responses, scan processes and installed-game records are fixtures, so running it does not download games or shut down the laptop.

Version 0.4.0 adds fixture coverage for shared bandwidth, schedule boundaries, host cooldowns, archive-set checks, guarded cleanup, checksum workers, update assets and the native helper, metadata, clipboard recognition, notices and the new renderer controls. Use a separate test profile and synthetic files for deletion or checksum smoke tests. Test update replacement only with a disposable fixture executable and profile; a passing unit suite does not establish that a packaged update has been installed successfully.

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
| `src/defender-scan.cjs`, `src/header-vault.cjs` | Scan interpretation and saved request-header encryption. |
| `src/catalog*.cjs` | Catalogue sections and background refresh. |
| `src/installed-games.cjs`, `src/installed-scan.ps1` | Read-only installation and version discovery. |
| `src/completion-action.cjs`, `src/completion-policy.cjs` | Queue/scan completion checks and cancellable finish actions. |
| `src/feature-services.cjs` | Validated integration for update, cleanup, metadata, clipboard, notifications and verification operations. |
| `src/app-updater.cjs`, `src/updater-helper.cs` | GitHub release verification/staging and native portable replacement after app exit. |
| `src/bandwidth-limiter.cjs`, `src/download-schedule.cjs`, `src/host-backoff.cjs` | Shared transfer budget, local-time windows and host cooldowns. |
| `src/download-cleanup.cjs`, `src/archive-set-validation.cjs` | Reviewed managed-file cleanup and multipart filename/size checks. |
| `src/integrity-verifier.cjs`, `src/integrity-worker.cjs` | Cancellable local manifest verification in a separate worker. |
| `scripts/build-updater.cjs` | Compiles the native helper using the Windows .NET Framework compiler. |
| `scripts/verify-package.cjs`, `scripts/verify-fuses.cjs` | Packaged helper/source/build-record checks and Electron fuse verification. |
| `test/` | Automated tests and synthetic test data. |

## Preparing a release

1. Review application changes and update `CHANGELOG.md`.
2. Keep the version in `package.json` and the lockfile synchronized.
3. Run `npm ci`, `npm test`, `npm run dist` and `npm run verify:build` on Windows. Review the fuse-check result for the freshly packaged executable.
4. Open the packaged application using a separate test profile and check the affected flows. Do not use real shutdown actions for tests.
5. Generate a checksum for the exact executable being published:

   ```powershell
   Get-FileHash -Algorithm SHA256 '.\dist\Ravenshelf-<version>-Windows.exe'
   ```

6. Create a matching release tag and attach the reviewed executable and checksum file. Publish source through Git, not a copy of the app's local profile or build cache.

Alternatively, after reviewing and merging the release changes into `main`, a maintainer can select **Publish Windows prerelease** (`.github/workflows/publish-release.yml`) in the repository's **Actions** tab, then choose **Run workflow** with branch `main`. No other inputs are required. The workflow installs dependencies, runs tests and builds on Windows with Node.js 24, then publishes a prerelease tagged `v<package version>` with the executable and `SHA256SUMS.txt`. It takes release notes from `docs/RELEASE-<version>.md`; GitHub supplies source archives for the tag. An existing tag or release, including a draft, is refused. Check that the workflow, including packaged fuse verification, succeeds and inspect the release assets before sharing the download link.

Published builds include a GitHub build-provenance attestation. Verify it with `gh attestation verify <executable> --repo khattabhunter/ravenshelf`. The attestation identifies the build origin; it is not Windows code signing or a malware verdict. Version 0.4.0 remains unsigned, and its network controls do not establish a measured file-host speed improvement.

CodeQL also analyzes the C# helper using an explicit native-helper compilation job, alongside JavaScript and workflow analysis. Review the alert lists as well as workflow completion; a finished scan is not itself a finding-free result.

Do not commit `node_modules`, build output, downloaded archives, host cookies, queue/history files or machine-specific scan results.
