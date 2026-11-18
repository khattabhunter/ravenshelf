# Ravenshelf 0.10.9 — Broken characters inside names

This is a small maintenance update. One rare file-name case is fixed; everything else works the same as 0.10.8. You don't need to update now; the next update will include this one. To update anyway, open **Settings → Ravenshelf updates** and choose **Download and install**, or download `Ravenshelf-0.10.9-Windows.exe` from this release. The browser extension did not change.

## What changed

- **Half of an emoji inside a file name is saved as `_`.** An emoji counts as two characters, and a name that a website sends (for example in a reply a file host gives) can have only one half of one, anywhere in the name. Half an emoji can't be passed to Windows, so the file got a broken character (�) instead. Its name on disk was then not the name Ravenshelf had checked and listed. Worse, two names that differed only in such a half, like `Game` + half A + `.rar` and `Game` + half B + `.rar`, became the same file on disk, and Ravenshelf couldn't see that they clash. 0.10.6 already dropped such a half at the end of a name. Now a half inside a name becomes `_`, like the other characters Windows can't store. This also applies to game folder names.

Ordinary names, and names with whole emoji, don't change. Downloads already in your list keep their names.

## Checks

- **Automated tests:** two new tests check that half an emoji inside a name becomes `_`, that a half at the end is still dropped as before, that whole emoji stay, that cleaning the name again changes nothing, that the file on disk has exactly the cleaned name, and that the queue gives two such names two different files. Both failed before the fix and pass after. In total 1,255 tests: on Linux 1,214 passed, 0 failed, and 41 were skipped (Windows-only tests, and 2 that need Electron).
- **Code scanning:** no new alerts (the 16 known notes, all reviewed before).
- **Supply chain:** the supply-chain check passed and `npm audit` found 0 vulnerabilities.
- **Independent review:** one independent review of the change found no problem in the code. Its notes were applied: these notes now say exactly which halves become `_`, and the test checks a half at the end too.
- GitHub's Windows test run, code scanning and source-signature checks run before release.

Passing these checks can't guarantee there are no bugs.
