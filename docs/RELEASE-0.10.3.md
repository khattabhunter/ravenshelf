# Ravenshelf 0.10.3 — Background mode and browser saves

**Unreleased 0.10.3 release candidate.** A Windows validation package was built and inspected; it has not been published or installed. It has no GitHub release attestation and is not an update distribution. The published download remains [v0.10.2](https://github.com/khattabhunter/ravenshelf/releases/tag/v0.10.2).

## Closing and background mode

Closing the window now asks whether to **Keep running in background**, **Exit Ravenshelf**, or **Cancel**. Tick **Remember my choice** to save a preference, or change **Settings → When I close the window** later. Background mode creates a tray icon before hiding the window. Use that icon to reopen Ravenshelf or exit it fully. If the tray cannot be created or a remembered preference cannot be saved, the window stays open.

Downloads and enabled services continue while the app is hidden and the PC is awake. Background mode does not start Ravenshelf with Windows, keep a sleeping PC awake, or enable services you had turned off. A full exit pauses unfinished work and stops the app's services. Windows shutdown is separate from normal app exit; periodic checkpoints remain important because Windows may not allow asynchronous cleanup to finish.

An update is still downloaded only after **Download and install**, and must pass the existing signed-record and file checks. A verified, approved update installs on a full exit or **Restart now**, never merely because the window was hidden. Restart remains unavailable during active work. The shutdown sequence waits for service cleanup and suppresses installation if an earlier cleanup step fails. Late Defender or reputation results no longer change the queue after its final checkpoint; pending scans run again after reopening.

## Browser saves

With the extension connected and **Send downloads to Ravenshelf** enabled, ordinary Save image, video, audio and file downloads can be handed to the app through either browser download event. Chrome filename callbacks are released once, duplicate events share one decision, and a download intercepted through the creation event must first be paused successfully. The original browser download is cancelled only after the app accepts its review, except for existing security blocks.

- A completed save is kept in the browser instead of being deleted and replaced with a review. Failed pauses, an unavailable or unresponsive app, a refused handoff and a full review list fall back to the browser. User cancellation and manual resume are respected.
- Right-click an image, a direct video file or an audio file to send that selected file. YouTube keeps its separate video-download workflow.
- Automatic captures do not reopen a window hidden in the background. Review notifications follow the existing notification preference; the tray icon opens the app. An explicit right-click handoff can bring the review window forward.
- Acceptance means **waiting for review**, not a finished or proven-safe download. Choose **Download** in Ravenshelf after checking the result. Programs, scripts and disk images retain their confirmation step.

Browser review cards are memory-only, as in earlier versions. Review and queue files you want before exiting fully: pending review cards are discarded on exit, while the actual saved download queue and its partial files remain. Background hiding keeps the session's reviews available until their normal expiry. Shutdown refuses new handoffs once quitting begins.

No additional extension permissions, page-wide scraping, browser cookies, dependencies or telemetry are introduced. Private-window downloads, local addresses and URL credentials are excluded. File-host ad and redirect protections remain enabled according to the existing settings.

This cannot capture every item on a website. Ordinary `blob:` or `data:` media stays in the browser; page-created executable downloads retain their existing block. DRM-protected streams and media requiring browser cookies or sign-in may need the browser. Plain HTTP files remain subject to the existing security policy. A very small download can finish before interception. Reload the extension from the browser's extensions page after a future packaged update to activate these changes.

## Recovery and torrent fixes

- Unfinished queues above 10,000 entries retain every valid unfinished job and can resume existing partial files. New additions remain blocked while the queue is at or above its limit; trimming applies to finished history.
- A missing profile uses one canonical destination, so retargeting a profile junction during recovery cannot silently select another saved library. Reused recovery copies must still match their descriptor and pathname after reading.
- Invalid nested favourites, shelf entries or shelf games no longer discard valid neighbours. Recovery copies preserve the original data and can contain private paths or signed links; keep them local.
- Read-only libraries refuse settings changes, and failed settings writes restore the previous preferences before adjusting bandwidth or scheduling.
- Quit immediately closes native browser intake. Late handoff acknowledgements return control to the browser, while already established malicious verdicts remain blocked. Folder-picker settings and torrent-review continuations cannot mutate the final queue after shutdown begins; a dismissed torrent review cannot add a download later.
- Shared tracker-name lookups give each caller its own cancellation. Abandoned queued work is removed and waiting callers are bounded. Running system lookups retain their slots until they finish. This is not a VPN kill switch; aria2 still performs its own networking and torrent participants can see the connection's IP address.

## Local validation

The final local automated run passed **1,178 tests, with zero failures and zero skips**, including required Electron checks. Isolated tests using Electron 45.2.3 also passed for normal, recovered and newer-version profiles, preserving fixture settings and partial files and exercising background/full-exit behavior. Browser event-order and fallback tests use controlled browser API fixtures; they are not a claim of manual testing in Chrome, Firefox or every website. No real browser profile, installed app, settings or downloads were used for those isolated checks.

The Windows portable package was statically inspected without executing it: all 87 app-source files and 18 bundled extension files matched the working source, both native helpers matched their build records, all 7 configured Electron security fuses passed, and all 1,374 ASAR file integrity records were verified. The executable and ASAR extracted from the portable container matched the unpacked build. Targeted inspection found no unexpected profile files, private-key/token patterns or personal profile-path patterns; this is not a comprehensive malware or privacy verdict.

Dependency audit reported zero known vulnerabilities; 335 registry signatures and 57 available package attestations verified. Supply-chain configuration checks passed. Dependencies, release workflows and updater trust policy were unchanged. With the new source, the genuine public 0.10.2 checksum and build record verified in Node and Electron, using the current and bundled Sigstore roots; wrong digests, workflow identities and altered signed payloads were rejected. This validates the verifier against an existing release, not a future 0.10.3 release.

The final portable executable was not launched or installed. The actual app's update replacement, a native tray interaction in a real desktop session, and real Chrome/Firefox capture remain manual follow-up checks. Publishing still requires signed source, the existing GitHub build/release checks and verification of that newly produced public artifact. Passing these tests cannot guarantee an absence of bugs or malicious content in downloaded files.
