# Ravenshelf 0.10.13 — Control characters no longer hide a disguised program

This is a small maintenance update. One safety check for file names is made stricter; everything else works the same as 0.10.12. You don't need to update now; the next update will include this one. To update anyway, open **Settings → Ravenshelf updates** and choose **Download and install**, or download `Ravenshelf-0.10.13-Windows.exe` from this release. The browser extension did not change.

## What changed

- **The disguised-program check also catches control characters and the blank music symbol.** Ravenshelf blocks a program whose name pretends to be another kind of file, such as `invoice.pdf.exe`, and a program whose `.exe` ending is pushed out of sight with a run of spaces. Since 0.10.12 these checks read a name the way it looks on screen, so invisible characters between `.pdf` and `.exe` no longer get around them. Two kinds of characters still did:
  - the **C1 control characters** (U+0080 to U+009F). They are usually not drawn, and Ravenshelf keeps them in a saved name;
  - the **"null notehead" music symbol** (U+1D159), which is drawn as a blank.

  A name with one of them between `.pdf` and `.exe` looked like `invoice.pdf.exe`, but only got the normal "this is a program, run it only if you trust it" warning.

Now control characters are left out, like the other characters that are not drawn, and the blank music symbol counts as a space, like the other blank characters. The file's real ending is still read from the name itself.

This applies everywhere the disguised-name check is used: downloads that come from your browser, and file names inside torrents. Ordinary names get the same result as before, also names with text that was decoded the wrong way (where a dash turns into `â` and two control characters) and names with other music symbols.

## Checks

- **Automated tests:** one new test checks that `invoice.pdf.exe` with a C1 control character or the blank music symbol before `.exe` is blocked, also when the character is inside `.pdf`, and also for the name as Ravenshelf saves it; that an ending pushed away with the blank music symbol is blocked, while control characters don't count as padding; and that wrongly decoded names, music symbols and a name Windows would not run as a program keep their usual result. It failed before the fix and passes after. In total 1,260 tests: on Linux 1,219 passed, 0 failed, and 41 were skipped (Windows-only tests, and 2 that need Electron).
- **Independent review:** one reviewer checked the change and found no problem in the code. Its small suggestions (one more test case, clearer wording in these notes and the README) are done.
- **Code scanning:** no new alerts (the 16 known notes, all reviewed before).
- **Supply chain:** the supply-chain check passed and `npm audit` found 0 vulnerabilities.
- GitHub's Windows test run, code scanning and source-signature checks run before release.

Passing these checks can't guarantee there are no bugs.
