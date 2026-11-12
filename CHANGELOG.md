# Changelog

## 0.8.0 — Arabic, and a Mods page

- **Arabic:** **Settings → Language** offers **Same as Windows**, **English** and **العربية**. In Arabic the window reads right to left, and **Numbers** offers 0 1 2 3 or ٠ ١ ٢ ٣. Changing the language reloads the window; downloads keep running. Messages from the app, notifications, file dialogs, window titles and the **Alt** menu are translated; file names, paths and web addresses keep their own direction. The **Alt** menu no longer has Electron's Help menu, which linked to Electron's website.
- The browser extension uses the app's language: Ravenshelf tells it which when they talk, and sends the reasons for blocked downloads in that language. Until then it uses the browser's language. Its description in the browser now reads "Checks downloads in Ravenshelf first, blocks dangerous sites and pop-ups, adds a YouTube button, sorts Nexus Mods files by game.", in English or Arabic after the browser's language.
- New **Mods** page: the mod files you downloaded on Nexus Mods, by game and newest first, with search, **Mod page** (opens the mod's page in your own browser, at an address made only from the saved game and mod number), **Show file**, **See in Downloads** and **Open Mods folder**. Ravenshelf itself never contacts Nexus Mods. **Settings → Browser extension** now says what the extension reads on Nexus Mods and where to turn it off.
- A file counts as a mod file only when its download began on Nexus Mods (the site or its file servers) and comes from the file servers (nexus-cdn.com). A mod file's download that is sent on to another site while it downloads is stopped.
- A mod file already in your list is recognised by its path on the file servers and its name, because every click brings a new link. Mod files of one game stay in one folder, whichever name the game arrives with.
- A cancelled mod download drops its link, and the page address it sent; start the download again from the mod's page to continue it. When 0.8.0 starts, finished and cancelled mod downloads lose what 0.7.0 still kept of these. Mod downloads no longer cause the header-storage warning.
- Mod and game names from Nexus Mods are shown in quotes, with any quote marks in them made plain.
- The extension's Nexus Mods notes are steadier: a page kept open sends its note again after 20 minutes, a note that got no answer is sent again, and only downloads from the file servers wait (at most 1.5 seconds) for the notes.
- **PC specs:** a second graphics adapter on Windows' basic display driver is now mentioned instead of left out silently; **Check again** after an incomplete check always reads again; DirectX levels newer than 12.2 still count as DirectX 12; a drive whose own details Windows does not give shows only its connection.
- In Arabic, text from websites stays as the site wrote it: a source page's installation notes, game descriptions and system requirements, mod names, and file names, even a file named like one of Ravenshelf's own messages. Folders keep their English names on disk, and the review window names the real `Mods` folder.
- A failed check of installed games now shows a plain sentence instead of a Windows error message, which could name a folder on your PC.

See [the release notes](docs/RELEASE-0.8.0.md).

## 0.7.0 — PC specs, and Nexus Mods downloads filed by game

- New **PC specs** page: the processor (cores, threads, clock speed), each graphics adapter (which one games use, its real graphics memory even above 4 GB, DirectX support, driver version), memory installed and usable, drives with their type and free space, the display and the Windows version. Ravenshelf asks Windows the first time you open the page after starting it and when you choose **Check again** (usually a few seconds; it gives up after 20 seconds), keeps the answer in memory and sends it nowhere.
- The hardware check is a fixed, read-only script. It asks Windows for model and maker names, sizes, versions, drive letters, how parts are connected, capability levels, whether a graphics device is working, the name of its driver's setup file and when DirectX last saw an adapter: never serial numbers, the computer's name, user names, volume labels or network addresses. A test holds the script to lists of everything it may contain. The answer is never part of the app's saved state, its logs or anything the browser extension can reach.
- The page leaves out what it cannot be sure of. An adapter is called a graphics card or built-in graphics only when Windows says which (on PCs that have both), or for NVIDIA and Intel when its memory makes it clear. Graphics memory is shown only from a source that means memory of the card's own. An adapter that Windows reports a problem with is listed with a warning and without DirectX support. When no graphics driver works at all, the page says Windows is using its basic display driver; a second adapter on that driver is not listed while another one works.
- **Nexus Mods downloads filed by game** (browser extension): a file you download on Nexus Mods is recognised. The review shows the mod, the game and the folder the file will go to, **Download** saves the file in `Mods\<game>` in your download folder, and the Downloads page shows the mod's and the game's names.
- Mod files download over one connection, whatever **Connections per file** says, and Ravenshelf does not try to get around the site's limits. The site's waiting time and sign-in are untouched, and no Nexus Mods account, API key or browser cookie is used.
- Nexus Mods' download links expire. When one is no longer accepted, the download says so instead of showing a bare error number. Start it again from the mod's page and the failed entry tries again with the new link, keeping what it has when the server allows it. A paused entry, also after a restart, does not take a new link: choose **Resume** first. Ravenshelf does not look an old link up again by itself: for a mod file it only ever asks for the file, at the link your click produced. A mod file is not added twice: a recognised mod file with the same address (without the part after "?") in the same game's folder counts as the same file.
- The extension's new page script on www.nexusmods.com only reads the page (game, mod, file name and number): it adds nothing, presses nothing and makes no requests. It also notices that you clicked or pressed Enter or Space (not what), and whether the tab is visible. What it reads stays in the browser's memory unless you download a file from Nexus Mods, and pages in private windows are never read. The toolbar button has a new **Sort Nexus Mods files by game** switch.
- A label is attached only to a file that comes from Nexus Mods' file servers (nexus-cdn.com), never to a file a page merely links to, and Ravenshelf checks every part of it again before it names a folder or appears on screen. When it is not clear which mod a file belongs to, the file is treated as an ordinary browser download.
- A finished file that was recognised as a mod file keeps only the plain address of its link. The signed part, which can include your Nexus Mods account number, is dropped. A Nexus Mods file that was not recognised is an ordinary browser download and keeps its link until its entry is removed.
- A file's name is now judged in exactly the form it is saved under, so a name written with look-alike characters, or one that turns into a program's name only when it is shortened, cannot pass a check under one name and be saved under another.
- The folder for a new game with a very long title no longer ends in a space or a dot, which Windows Explorer cannot open. A game that already has a folder from an earlier version keeps it, so its files stay together.

See [the release notes](docs/RELEASE-0.7.0.md).

## 0.6.1 — Much faster YouTube setup and downloads

- The one-time YouTube setup downloads the helper programs (about 168 MB) in 2 MB parts over up to eight connections, and replaces a connection that is far slower than the others. On a connection where GitHub's download servers had slowed setup to more than an hour, it took about a minute. Each part must be exactly the part requested, and the finished files must still match the sizes and SHA-256 values recorded in Ravenshelf before anything is installed.
- YouTube audio now comes from YouTube's HLS stream, which downloads in parts like the video. YouTube sometimes slowed the single-file audio to about 150 KB/s, so the audio could take longer than the video: in a trial, a 6-minute 1080p video took 16 seconds instead of 54. **Audio (M4A)** and **Audio (MP3)** use the same stream.
- HLS parts download eight at a time instead of four (still one at a time under a speed limit).
- Videos are always saved as MP4, including 4K videos in VP9, which 0.6.0 saved as MKV.
- File downloads use HTTP/1.1. Over HTTP/2, a site could carry all of a file's connections on a single one, so a download with several connections per file could be no faster than one.

See [the release notes](docs/RELEASE-0.6.1.md).

## 0.6.0 — YouTube downloads

- New **Ravenshelf button in YouTube's player**, next to subtitles and settings. It follows the player's own size in normal, theater and full-screen views and opens a menu: **Best quality** (up to 4K), **1080p**, **720p**, **480p**, or audio only as **M4A** or **MP3**. A message in the player confirms the choice. The toolbar button can hide it.
- **Download with Ravenshelf** on the right-click menu of YouTube video links, thumbnails and video pages (including Shorts), using the quality chosen in **Settings → YouTube downloads** (1080p by default).
- YouTube videos join the download queue straight away, in a **YouTube** folder, named after the video's title, with progress, pause and resume, cancel, removal with **Delete files**, the internet-zone mark and Microsoft Defender scans. Video is saved as MP4, or MKV when the best version doesn't fit MP4. YouTube's HLS streams are used when they offer the same quality, four parts at a time (one at a time under a speed limit), because YouTube slows its single-file video streams to a few hundred KB/s.
- One-time setup of three helper programs, started by you: yt-dlp 2026.10.26, Deno 2.9.8 and FFmpeg 8.1.2 (about 168 MB to download, 310 MB on disk, in `%LOCALAPPDATA%\Ravenshelf\media-tools`). Each comes from its publisher's GitHub release at a fixed version; the downloads and every extracted program must match sizes and SHA-256 values recorded in Ravenshelf, and the programs are checked again before their first use in each session. A video sent before setup waits and starts when setup finishes. **Remove helper programs** deletes them.
- yt-dlp receives only the canonical address of one video, after `--`, with configuration files, plugins, browser cookies and remote components switched off and the checked Deno as its only JavaScript runtime. It runs without a shell, with a minimal environment, a private temporary folder per download and a private working folder next to the file. Its own messages never reach the screen: age-restricted, members-only, private, region-locked, live and copy-protected videos, YouTube's limits and connection problems get plain messages.
- The extension's only page script runs in YouTube's top frame, builds its controls without HTML injection and acts only on real clicks. The extension accepts the player's request only from that script, and sends only the video's ID and quality to Ravenshelf.
- Only download videos you own, that use a Creative Commons licence, or that you have permission to save: YouTube's terms allow downloading only where YouTube offers it or with permission. Settings and the setup say so.

See [the release notes](docs/RELEASE-0.6.0.md).

## 0.5.1 — Delete finished browser downloads, retry dropped connections

- **Delete files** now works for finished browser downloads of any file type, such as a program or a picture. In 0.5.0, cleanup accepted only archive names and refused these with "These files changed or could not be checked safely". The exception applies only to downloads taken over from a browser and saved in Ravenshelf's own **Browser downloads** folder; in game folders, cleanup still deletes only the downloaded archives.
- **Check space** now counts browser downloads instead of reporting them as files that could not be checked safely.
- A dropped or timed-out connection is retried automatically, up to twice in a row (after 15 and then 30 seconds); a retry that received more data resets the count. Network failures now name the problem (timed out, interrupted, host unreachable or refused) instead of a general message.
- Choosing **Download** for a browser download that is already in the queue (finished, failed or paused) now says **Already in Downloads**. In 0.5.0 it reported **Added** although nothing was queued.
- Removing downloads no longer shows "Queue cleanup cancelled the completion action" when no finish action was set.
- After an update, if the browser-extension folder can't be replaced (for example, because another program has it open), the connection still starts with the previous extension files, and **Settings → Browser extension** says so. It is retried on the next start.

See [the release notes](docs/RELEASE-0.5.1.md).

## 0.5.0 — Browser extension: downloads checked first, dangerous sites blocked

- New Ravenshelf extension for Chrome, Edge, Brave and Firefox, set up from **Settings → Browser extension** and off until you connect it. Downloads you start in the browser go to Ravenshelf, which checks each one before anything is saved and then waits for your choice. If Ravenshelf is closed, the browser downloads as usual. Private windows are never captured. Includes a right-click **Download with Ravenshelf** option and a toolbar button.
- Checks before downloading, without opening the page or sending browser cookies: redirects are followed one hop at a time, only the first 4 KB is read, and the file name is compared with the file's real type. Disguised programs (such as `invoice.pdf.exe`), programs over unencrypted HTTP and links through listed sites are blocked; other programs, scripts and disk images need an explicit confirmation. FuckingFast, FileKeeper and DataNodes links use Ravenshelf's own host support.
- Site blocking in the browser: four public lists (URLhaus and phishing-filter via malware-filter, HaGeZi Threat Intelligence Feeds mini and HaGeZi Pop-Up Ads, about 261,000 entries) are downloaded whole by Ravenshelf, checked on this PC and turned into the browser's own blocking rules, refreshed every 12 hours. A blocked page explains why, with **Go back** and **Close tab**. Blocking keeps working while Ravenshelf is closed.
- File-host guard: FuckingFast and FileKeeper pages can no longer send the tab to another site or open pop-ups elsewhere. A redirect puts the download page back, pop-ups (including blank ones the page fills with ads) are closed, and an ad frame that takes over the tab is undone. Each block is announced once.
- Optional VirusTotal checks with your own free API key: up to three sites behind each browser download, and the SHA-256 fingerprint of each finished browser download. Only site names and fingerprints are sent; the key is sealed with Windows protected storage. Results appear in the review and on the download's card.
- Files taken over from a browser keep Windows' internet-zone mark (Mark of the Web), as a browser download would.
- The browser reaches Ravenshelf through a small compiled connector, checked against its build record before use and registered for the current Windows user only. It relays one message per request over a local pipe protected by a random per-session token, and Ravenshelf accepts only its own extension.

See [the release notes](docs/RELEASE-0.5.0.md).

## 0.4.2 — Updates ask first and check the signed build record

- Automatic update checks only find and announce a new version. Nothing is downloaded or installed until you choose **Download and install**; **What’s new** opens the exact release page. An install on close or with **Restart now** requires that approval.
- Before downloading an approved update, verify the release's Sigstore build record: certificate chain and transparency proofs, the DSSE-signed SLSA provenance naming the exact executable and SHA-256, and a signer pinned to `publish-release.yml` on `main` in this repository (issuer, GitHub-hosted runner, repository and owner IDs). Sigstore's trusted root is refreshed through TUF with a bundled fallback. Any failure stops the update. Verification works with the BoringSSL library in Electron, not only with Node's OpenSSL.
- Remove leftovers of finished updates: the staged copy, helper and job files, and the previous executable kept next to the app. A rollback copy is removed only after a recorded successful update and only when it matches the replaced executable byte for byte. Failed updates, links, unexpected files and profile backups are kept.
- Releases now publish `Ravenshelf-<version>-Windows.exe.sigstore.json`. A read-only release job checks it with the in-app verifier against Sigstore's current and bundled trusted roots, in Node and in the shipped Electron runtime; a record installed copies would refuse stops publication.

See [the release notes](docs/RELEASE-0.4.2.md).

## 0.4.1 — Download checks, storage and update reliability

- Recover file sizes with one bounded probe when successful HEAD responses omit them; preserve ad, filename, response-type and redirect checks.
- Recover a fully received partial after interrupted EOF with a single validated last-byte request instead of repeatedly requesting beyond the file's end. A 416 response alone never marks a file complete.
- Explain missing queue files and show separately counted archives outside the queue. Storage checks are bounded and coalesced; untracked files remain read-only.
- Preserve valid storage totals when checkpoint entries are unsafe and recheck cleanup ownership after filesystem waits.
- Keep unsaved settings across state refreshes, restore failed toggles, accept fractional speed limits and guard delayed dialog close events.
- Await partial update cleanup at exit and safely retry/coalesce update preparation. Keep native updater safety checks after reviewing all 12 informational CodeQL notes.

See [the release notes](docs/RELEASE-0.4.1.md) and [bug review](docs/BUG-REVIEW-0.4.1.md).

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
