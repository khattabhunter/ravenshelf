# Ravenshelf 0.10.6 — Long names with emoji

This is a small maintenance update. One rare file-name case is fixed; everything else works the same as 0.10.5. You don't need to update now; the next update will include this one. To update anyway, open **Settings → Ravenshelf updates** and choose **Download and install**, or download `Ravenshelf-0.10.6-Windows.exe` from this release. The browser extension did not change.

## What changed

- **A long file name is no longer cut through an emoji.** Ravenshelf cuts file names to 180 characters. An emoji counts as two characters. When the cut fell between those two, half an emoji stayed at the end of the name. Half an emoji can't be passed to Windows, so the file got a broken character (�) in its place. The file on disk then did not have the name that Ravenshelf had checked and shown. Now the half emoji is dropped as well, and a space or dot that it leaves at the end is removed, as for any name.

Only names longer than 180 characters with an emoji (or another character that counts as two, such as some rare Chinese characters) right at the cut are affected. Downloads already in your list keep their names.

## Checks

- **Automated tests:** a new test checks long names with emoji at the cut (for one file and in the download queue). It failed before the fix and passes after. In total 1,250 tests: on Linux 1,209 passed, 0 failed, and 41 were skipped (Windows-only tests, and 2 that need Electron).
- **Code scanning:** no new alerts (the 16 known notes, all reviewed before).
- **Supply chain:** the supply-chain check passed and `npm audit` found 0 vulnerabilities.
- **Independent review:** one independent review of the change found no serious problem. Its suggestions (also drop half an emoji that comes before a trailing dot, two more test cases, more exact wording) were applied.
- GitHub's Windows test run, code scanning and source-signature checks run before release.

Passing these checks can't guarantee there are no bugs.
