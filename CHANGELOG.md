# Changelog

## 0.4.0 — Library and download controls prerelease

- Added portable Windows app updates from this repository's published GitHub versions, including prereleases. Candidate size and SHA-256 must agree with both release-asset metadata and `SHA256SUMS.txt`; critical profile files are backed up before replacement. A native C# helper applies a ready update on normal close or an explicit idle restart without changing Windows security settings. The executable remains unsigned.
- Added shared transfer-speed limits, local-time weekday/overnight download schedules and host cooldowns after limiting responses. Manual pauses remain separate from schedule pauses.
- Added download multi-select, completed-download cleanup, logical storage-size estimates and a reviewed choice between keeping files or explicitly deleting managed files. Partial failures remain visible and destructive choices are never remembered.
- Added multipart filename/size preflight with explicit override for known gaps or inconsistencies. Unknown final parts remain warnings, not claims of completeness.
- Added cancellable manual SFV/MD5/SHA-256 verification in a bounded worker. Results distinguish matches, mismatches, missing files and errors; checksum agreement does not certify authenticity or safety.
- Added clickable image viewing with keyboard navigation/focus restoration, system requirements, real Steam recommendation counts expressed on a five-star scale, local genre suggestions and optional artwork-derived accents.
- Added optional desktop notices and an opt-in in-memory copied-link tray. Recognized links require review and checking before any download; clipboard recognition itself makes no network requests.
- Kept the 16 MiB parallel threshold, 500 ms progress batches, checked host/image transport, encrypted saved headers and conservative Defender/finish-action behavior. Proxy/VPN kill-switch enforcement, Brave Search API integration, a wholesale worker rewrite and naive inline game-file hashing remain deferred.

See [the release notes](docs/RELEASE-0.4.0.md) and [user guide](docs/USER-GUIDE.md) for controls, update behavior and limits.

## 0.3.3 — Security maintenance prerelease

- Replaced internal protocol, startup and unexpected operation errors with safe messages that do not expose raw paths, signed URLs or exception stacks.
- File transfers retain validated file handles across network waits. New partials are created exclusively; replaced files, hard links and directory links are rejected. Parallel data and fallback-prefix copying use the same checks.
- Installed-game manifests are read through one validated descriptor with a strict byte ceiling, preventing filename replacement and file growth from bypassing the checks.
- Queue and split-download checkpoints use unique, exclusively created temporary files. The test-only size/hash check now reads the output once.
- Bounded split-download metadata to 65,536 sections (512 GiB per file), with single-stream fallback for larger remote files; saved manifests have a 4 MiB read ceiling.
- Single streams reject script/XML responses and require a strong validator for resuming. New validators are saved only after resetting an old prefix succeeds. Older unverified Last-Modified-only partials restart safely; strong-ETag partials retain resume support.
- Expanded CodeQL to its security-and-quality suite and added dependency audits to tests and release builds.

See [the release notes](docs/RELEASE-0.3.3.md) for upgrade behavior and security boundaries.

## 0.3.2 — Progress update maintenance prerelease

### Changed

- Combined regular progress reports into one batch every 500 ms for active transfers. These updates contain file IDs and numeric counters, without repeatedly sending queue history, settings, URLs or credentials.
- Progress updates refresh cached active cards and aggregate speed without redrawing completed history or rebuilding action controls. Full snapshots remain available on startup and reload.
- Full snapshots and progress messages share a sequence so late messages cannot overwrite newer progress or lifecycle state. Progress cannot change transfer status, scan results or settings.
- Pause, error, completion, scan and privacy-warning changes continue to publish immediately. Changes to the header-storage warning during periodic saving are now explicitly published instead of relying on a later progress snapshot.

Offline regressions cover the progress bridge, ordering, card updates and security-state preservation. Controlled responsiveness checks use fixtures and do not measure external filehost speed. The 0.3.1 security fixes and existing transfer checks remain in place. See [the release notes](docs/RELEASE-0.3.2.md).

## 0.3.1 — Maintenance prerelease

### Fixed

- Automatic close and shutdown wait for queued/running Defender scans. Unclear, failed, unavailable, missing-file and threat results block the action; readiness is checked again before the final action.
- Defender's successful exit code alone no longer means no threats were found. A clean result requires recognized explicit clean output; ambiguous or unsupported output is shown as needing review. Threat/remediation evidence takes precedence.
- Queue request headers never fall back to plaintext when Windows encryption is unavailable or fails. Headers remain in memory, saved headers are empty, and affected links are refreshed before a resumed request after restart. Legacy plaintext is removed from the current saved queue, and the app shows a storage warning when headers cannot be saved securely.
- Enabled embedded ASAR-integrity validation alongside archive-only application loading. Added `npm run verify:build` to inspect the actual packaged executable's fuse settings.

The executable remains unsigned. This maintenance release does not change download tuning or claim a measured speed increase. See [the release notes](docs/RELEASE-0.3.1.md).

## 0.3.0 — Ravenshelf

Atlas Library is now **Ravenshelf**. Your library, collections, download queue, saved cookies and default download folder are kept.

### Protection

- Finished downloads are scanned with Microsoft Defender, one at a time, with the result shown on each download card. Automatic scans can be turned off in Settings, and any finished file can be scanned again.
- Hardened executable: Electron's run-as-Node mode, `NODE_OPTIONS`, debugger flags and extra `file://` privileges are disabled, and application code loads only from the packaged archive.
- Releases now include a signed build-provenance attestation that can be checked with `gh attestation verify`.
- Added CodeQL code scanning and Dependabot updates for dependencies and workflows.

### Changed

- New name, logo letter and executable name (`Ravenshelf-<version>-Windows.exe`). The README has a new Security section and download-verification steps.

## 0.2.5

### Protection

- Saved download request headers, including host cookies, are now encrypted in `library.json` with Electron `safeStorage` (Windows DPAPI, tied to your Windows account). Existing queues from older versions are converted the first time 0.2.5 opens.
- Headers that cannot be decrypted, for example in a profile copied from another PC or account, are discarded; affected downloads refresh their link from the source page when resumed.
- The protected host browser's Chromium cookie store is now encrypted on disk (Electron cookie-encryption fuse).

### Fixed

- The user guide and startup version label now match the current release.

## 0.2.4

### Protection

- Cover images now use a restricted app loader with public-address validation at the socket and on redirects. The renderer can no longer load arbitrary remote images directly.
- Image responses have byte/time limits and must contain a supported raster format; HTML and SVG responses are rejected.
- Cover requests do not forward browser-session cookies, credentials or referrers.
- Added a privacy guide describing public source, local profile storage and the IP visibility of normal network connections.

## 0.2.3

### Fixed

- FuckingFast link checks now use an isolated Chromium session for supported host pages and form responses. File checks and transfers retain the existing guarded network path.
- Passive Cloudflare scripts no longer cause valid download pages to be mistaken for active verification challenges.
- Download controls are matched to the selected file rather than taking the first unrelated form control.
- Filename parsing handles extended encodings and rejects malformed explicit names. Hosts that reject HEAD checks can receive a limited GET check.
- Link results distinguish browser steps, missing files and other failures. Added **Check links again** and protection against stale check results replacing newer results.

### Protection

- Browser-session requests are restricted to supported host paths and validated redirects.
- Session cookies stay in the main process rather than being returned to the renderer in link-check results.
- Availability checks do not click advertisements or execute the host page's scripts.

## 0.2.2

### Added

- Select 1, up to 2 or up to 4 connections per file; up to 4 is the default.
- Validated parallel downloads for large files, durable section checkpoints and automatic fallback to one connection.
- Download-card connection counts and fallback explanations.
- Support for hosts with valid open-ended ranges even when their bounded-range headers are inconsistent.

### Protection

- Workers settle before fallback or publication, and completed destinations are not overwritten.
- Older partial files retain their existing single-connection resume path.
- FuckingFast captures check archive filenames and download endpoints, and reject unrelated redirects and unexpected file types.

## 0.2.1

### Added

- Automatic newest-catalogue refresh at startup and every five minutes while the app is open, including when minimized.
- Overdue checks when returning to the app or waking the laptop.
- Last-check status and preservation of catalogue results when a request fails.

### Improved

- Background updates preserve the selected search, genre, page, scroll and focus, and wait while another view or dialog is open.
- Manual refresh bypasses the catalogue cache; overlapping requests are coalesced.

## Earlier preview foundation

The initial previews introduced the visual catalogue, source-based genre sections, Favorites and collections, batch downloads, protected host windows, installed-game metadata scanning, gameplay/guide links and optional completion actions.
