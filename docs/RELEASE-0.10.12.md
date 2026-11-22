# Ravenshelf 0.10.12 — Invisible characters no longer hide a disguised program

This is a small maintenance update. One safety check for file names is made stricter; everything else works the same as 0.10.11. You don't need to update now; the next update will include this one. To update anyway, open **Settings → Ravenshelf updates** and choose **Download and install**, or download `Ravenshelf-0.10.12-Windows.exe` from this release. The browser extension did not change.

## What changed

- **A disguised program is blocked also when invisible characters are hidden in its name.** Ravenshelf blocks a program whose name pretends to be another kind of file, such as `invoice.pdf.exe`, and a program whose `.exe` ending is pushed out of sight with a run of spaces. These names can't be downloaded from the review. But a name could get around both checks with characters that are not drawn on screen, such as a zero-width space between `.pdf` and `.exe`. It looked exactly like `invoice.pdf.exe`, yet it only got the normal "this is a program, run it only if you trust it" warning. Blank characters that are not ordinary spaces could push the ending away in the same way.

Now Ravenshelf judges a name by how it reads. Characters that are not drawn (most of the characters Unicode calls "default ignorable": zero-width marks, soft hyphens, variation selectors, tags) are left out. Characters that are drawn as a blank (the Hangul fillers and the blank Braille character) count as spaces. The file's real ending is still read from the name itself, so a name that Windows would not run as a program is not called one.

This applies everywhere the disguised-name check is used: downloads that come from your browser, and file names inside torrents. Ordinary names get the same result as before, also Persian and Arabic names that use a zero-width non-joiner, and names with emoji, such as flags.

## Checks

- **Automated tests:** one new test checks that `invoice.pdf.exe` with any of 13 kinds of invisible or blank characters (or two of them together) before `.exe` is blocked, also when the character is inside `.pdf`, and also for the name as Ravenshelf saves it; that the warning still names the right file type; that an ending pushed away with blank characters is blocked, while characters that are not drawn don't count as padding; and that a Persian word with a zero-width non-joiner, emoji names (a heart, a flag) and a name Windows would not run as a program keep their usual result. It failed before the fix and passes after. In total 1,259 tests: on Linux 1,218 passed, 0 failed, and 41 were skipped (Windows-only tests, and 2 that need Electron).
- **Independent review:** one reviewer checked the change. It found that zero-width characters were first counted as padding, which would have blocked some emoji names (flags); that is fixed, with tests.
- **Code scanning:** no new alerts (the 16 known notes, all reviewed before).
- **Supply chain:** the supply-chain check passed and `npm audit` found 0 vulnerabilities.
- GitHub's Windows test run, code scanning and source-signature checks run before release.

Passing these checks can't guarantee there are no bugs.
