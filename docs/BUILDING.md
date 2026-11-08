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
npm run verify:supply-chain
npm start
```

`npm ci` installs the versions in `package-lock.json`. Electron's installation may download its runtime. Keep the lockfile with dependency changes; avoid substituting unreviewed packages or bypassing Windows security controls to make a build succeed.

`npm run verify:supply-chain` checks the dependency, Dependabot and workflow configuration for consistency. It does not contact a registry or verify signatures. Hosted test/build jobs separately run `npm audit signatures` to verify registry signatures and available provenance, alongside `npm audit --audit-level=high`. You can run those audits locally when online. See [source and release verification](SUPPLY-CHAIN.md).

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

The `pretest` and `predist` hooks run `scripts/build-updater.cjs` and `scripts/build-browser-host.cjs`. The second compiles `src/browser-host.cs` the same way into `src/ravenshelf-browser-host.exe`, the browser extension's connector, with its own build record. On Windows it compiles `src/updater-helper.cs` with the system .NET Framework compiler into `src/ravenshelf-updater.exe`, which is packaged with the app. On other platforms the helper build is skipped; that does not produce a supported Windows release. To diagnose the helper build separately, run `node scripts/build-updater.cjs`. See Microsoft's [C# compiler options for .NET Framework](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/#net-framework-projects).

The helper is a compiled Windows program with no PowerShell update dependency. Do not weaken execution policy or Windows security settings to build or run it. The generated executable is a build output, not source to commit.

`verify:build` runs `scripts/verify-package.cjs`: it reads the packaged Electron fuse settings and checks the native helper against its source, build script and generated build-manifest hashes. It requires embedded ASAR-integrity validation and archive-only loading alongside the other hardening values, and rejects a stale or mismatched helper. A configuration entry alone is not sufficient verification. This check does not certify the code as malware-free or provide a publisher signature.

The build configuration produces an unsigned Windows x64 portable application. It does not configure a signing certificate, background Windows service or Linux/macOS release. App-update checks run only while the portable app is open and use this repository's GitHub releases. Electron-builder may download packaging tools on the first build.

The repository's **Build Windows preview** GitHub Actions workflow can also produce a Windows artifact. In the repository's **Actions** tab, select that workflow and choose **Run workflow** on `main`; other branches do not build. Its `ravenshelf-windows-x64-<run ID>-<run attempt>` artifact contains the executable and `SHA256SUMS.txt`. The separate **Test** workflow runs the automated suite.

Hosted preview and release builds require the exact source commit to pass [source-integrity.yml](../.github/workflows/source-integrity.yml) before building. A separate job attests the tested artifact without checking out source or installing dependencies; the builder has read-only repository permission. Preview runs then verify the artifact's exact source/workflow provenance, allowing end-to-end checks without a new public release. This prospective policy preserves existing unsigned history; local source builds remain available for development. See [source and release verification](SUPPLY-CHAIN.md) for accepted signing routes, Dependabot handling and optional repository-only GPG setup. Private signing keys are never required in CI.

From 0.4.2, release runs also check the exported build record with the in-app updater's verifier before publishing it beside the executable; see [the in-app update record](SUPPLY-CHAIN.md#the-in-app-update-record).

Workflow artifacts are build outputs. For a release download link, a maintainer can publish the reviewed files or use the release workflow below.

## Tests

```powershell
npm test
```

The automated suite covers catalogue parsing/refresh, link checks, network restrictions, filenames, download byte integrity, parallel connections and fallback, pause/resume, renderer state, installed-game metadata, Defender-result interpretation, completion/scan ordering and header-encryption failures. Its host responses, scan processes and installed-game records are fixtures, so running it does not download games or shut down the laptop.

Version 0.4.0 adds fixture coverage for shared bandwidth, schedule boundaries, host cooldowns, archive-set checks, guarded cleanup, checksum workers, update assets and the native helper, metadata, clipboard recognition, notices and the new renderer controls. Use a separate test profile and synthetic files for deletion or checksum smoke tests. Test update replacement only with a disposable fixture executable and profile; a passing unit suite does not establish that a packaged update has been installed successfully.

Version 0.4.1 extends checks for missing file sizes, bounded storage discovery, missing queue files, fractional speed limits and unsaved form edits during background updates. See the [0.4.1 bug review](BUG-REVIEW-0.4.1.md) for the maintenance review and isolated runtime coverage.

Version 0.4.2 adds tests for approval-gated updates, the build-record verifier (including GitHub's real 0.4.1 record checked offline, plus tampered and mismatched variants), the release gate scripts and leftover cleanup with real temporary folders, links and read-only files. The verifier is also tested inside Electron's runtime, whose BoringSSL differs from Node's OpenSSL. Those tests are skipped until the development Electron binary is installed with `node node_modules/electron/install.js` (it checks the download against the checksums in the locked `electron` package); the **Test** workflow installs it and requires them.

Version 0.5.0 adds tests for the extension's decisions and its background script (run against simulated Chrome and Firefox APIs), the protocol and bridge, the connector on Windows, protection lists, download checks, VirusTotal, the internet-zone mark and the new settings and review screens.

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
| `src/app-updater.cjs`, `src/updater-helper.cs` | GitHub release checks, approval-gated staging, leftover cleanup and native portable replacement after app exit. |
| `src/release-attestation.cjs` | Sigstore build-record verification for updates, pinned to the release workflow identity. |
| `src/bandwidth-limiter.cjs`, `src/download-schedule.cjs`, `src/host-backoff.cjs` | Shared transfer budget, local-time windows and host cooldowns. |
| `src/download-cleanup.cjs`, `src/archive-set-validation.cjs` | Reviewed managed-file cleanup and multipart filename/size checks. |
| `src/integrity-verifier.cjs`, `src/integrity-worker.cjs` | Cancellable local manifest verification in a separate worker. |
| `src/browser-extension/` | Browser extension sources; Ravenshelf writes them, with a manifest for each browser, into the profile when the user connects the extension. |
| `src/browser-*.cjs`, `src/browser-host.cs` | Extension protocol, bridge, setup and connector. |
| `src/threat-lists.cjs`, `src/link-safety.cjs`, `src/virustotal.cjs`, `src/motw.cjs` | Protection lists, download checks, optional VirusTotal lookups and the internet-zone mark. |
| `scripts/build-updater.cjs`, `scripts/build-browser-host.cjs` | Compile the native update helper and browser connector using the Windows .NET Framework compiler. |
| `scripts/verify-package.cjs`, `scripts/verify-fuses.cjs` | Packaged helper/source/build-record checks and Electron fuse verification. |
| `scripts/verify-attestation.cjs`, `scripts/verify-update-record.cjs` | Release attestation verification and export, and the release gate that checks the exported record with the in-app verifier. |
| `test/` | Automated tests and synthetic test data. |

## Preparing a release

1. Review application changes and update `CHANGELOG.md`.
2. Keep the version in `package.json` and the lockfile synchronized.
3. Run `npm ci`, `npm test`, `npm run verify:supply-chain`, `npm audit --audit-level=high`, `npm audit signatures`, `npm run dist` and `npm run verify:build` on Windows. Review the audit and fuse-check results for the freshly packaged executable.
4. Open the packaged application using a separate test profile and check the affected flows. Do not use real shutdown actions for tests.
5. Generate a checksum for the exact executable being published:

   ```powershell
   Get-FileHash -Algorithm SHA256 '.\dist\Ravenshelf-<version>-Windows.exe'
   ```

6. Confirm that the exact source commit is signed and verified on GitHub, then create a matching release tag and attach the reviewed executable and checksum file. Publish source through Git, not a copy of the app's local profile or build cache. Keep existing unsigned history and published tags unchanged.

Alternatively, after reviewing and merging the release changes into `main`, wait for the latest main-branch push runs of **Test**, **CodeQL** and **Source integrity** to succeed on that exact commit. A maintainer can then select **Publish Windows prerelease** (`.github/workflows/publish-release.yml`) in the repository's **Actions** tab and choose **Run workflow** with branch `main`. No other inputs are required. The workflow checks source signatures and those completed runs before installing dependencies, testing and building on Windows with Node.js 24. After a separate job attests the tested artifact, a read-only job exports the verified build record and checks it with the in-app updater's verifier. The publication job then verifies the attestation against the repository, expected workflow and exact source/workflow commits before publishing. It uses release notes from `docs/RELEASE-<version>.md` and creates a prerelease tagged `v<package version>` with the executable, `SHA256SUMS.txt` and `Ravenshelf-<version>-Windows.exe.sigstore.json`; GitHub supplies source archives for the tag. An existing tag or release, including a draft, is refused. Check that the entire workflow succeeds and inspect the release assets before sharing the download link.

Published builds include a GitHub build-provenance attestation. Follow the [restricted verification command](SUPPLY-CHAIN.md#verify-the-published-executables-build-origin) to check the repository, expected release workflow, exact reviewed source commit and GitHub-hosted runner. The attestation identifies the build origin; it is not Windows code signing or a malware verdict. Version 0.4.2 remains unsigned, and its network controls do not establish a measured file-host speed improvement.

CodeQL also analyzes the C# helper using an explicit native-helper compilation job, alongside JavaScript and workflow analysis. Review the alert lists as well as workflow completion; a finished scan is not itself a finding-free result.

Do not commit `node_modules`, build output, downloaded archives, host cookies, queue/history files or machine-specific scan results.
