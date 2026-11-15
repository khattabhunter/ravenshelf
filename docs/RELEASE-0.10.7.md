# Ravenshelf 0.10.7 — Names with the DEL character

This is a small maintenance update. One rare file-name case is fixed; everything else works the same as 0.10.6. You don't need to update now; the next update will include this one. To update anyway, open **Settings → Ravenshelf updates** and choose **Download and install**, or download `Ravenshelf-0.10.7-Windows.exe` from this release. The browser extension did not change.

## What changed

- **A file name with the DEL character is saved with `_` in its place.** DEL is an invisible control character. Ravenshelf already replaced the other control characters in a file name with `_`, but it kept DEL. **Check space** and **Delete files** refuse any name with DEL, so a file saved with one was missed by Check space and could not be deleted from Ravenshelf. Now DEL becomes `_` like the other control characters. This applies to file names and to game folder names.

Only names that really contain DEL are affected, which is rare. Downloads already in your list keep their names, so a file saved with DEL before this update is still missed by Check space; delete it in File Explorer if you need to. If a game whose title has DEL already has a folder from an older version, new downloads for that game go to a new folder with `_` instead.

## Checks

- **Automated tests:** two new tests check names with DEL (one file name, Check space, Delete files, and the download queue with a file name and a game title). They failed before the fix and pass after. In total 1,252 tests: on Linux 1,211 passed, 0 failed, and 41 were skipped (Windows-only tests, and 2 that need Electron).
- **Code scanning:** no new alerts (the 16 known notes, all reviewed before).
- **Supply chain:** the supply-chain check passed and `npm audit` found 0 vulnerabilities.
- **Independent review:** one independent review of the change found no serious problem. Its suggestions (explain what happens to files and folders saved before this update, one more test case) were applied.
- GitHub's Windows test run, code scanning and source-signature checks run before release.

Passing these checks can't guarantee there are no bugs.
