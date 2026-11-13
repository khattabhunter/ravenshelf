# Ravenshelf 0.10.5 — More reliable tests

This is a small maintenance update. **The app works the same as 0.10.4**: no feature, setting, text or safety check changed. Only the version number in the app is new. You don't need to update now; the next update will include this one. To update anyway, open **Settings → Ravenshelf updates** and choose **Download and install**, or download `Ravenshelf-0.10.5-Windows.exe` from this release. The browser extension did not change.

## What changed

- **A test no longer fails by chance on a slow PC.** The test for cancelling YouTube helper setup while parts of a file are downloading waited a fixed 50 milliseconds before checking. On GitHub's busy Windows test machine that was once too short, so the test failed even though the app was fine (it passed when run again). It now waits until setup has really got that far, for at most 5 seconds, and then checks the same things as before. A similar test (cancelling setup) now also waits until the download has really started before it cancels.

This makes the automatic checks that run before every release more reliable.

## Checks

- **Automated tests:** 1,249 tests. On Linux 1,208 passed, 0 failed, and 41 were skipped (39 Windows-only tests, and 2 that need Electron, which was not installed on that machine). With a slow machine simulated (each answer delayed by 80 milliseconds), the old test failed and the new one passed. The two tests also passed in 12 runs at the same time on a busy machine.
- **Code scanning:** no new alerts (the 16 known notes, all reviewed before).
- **Supply chain:** the supply-chain check passed and `npm audit` found 0 vulnerabilities.
- **Independent review:** one independent review of the change found no problems; its suggestions (clean up if a wait runs out, clearer wording) were applied.
- GitHub's Windows test run, code scanning and source-signature checks run before release.

Passing these checks can't guarantee there are no bugs.
