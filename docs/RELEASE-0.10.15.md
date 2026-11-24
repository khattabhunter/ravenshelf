# Ravenshelf 0.10.15 — Long program endings can't be disguised

This is a small maintenance update. One safety check is made stricter; everything else works the same as 0.10.14. You don't need to update now; the next update will include this one. To update anyway, open **Settings → Ravenshelf updates** and choose **Download and install**, or download `Ravenshelf-0.10.15-Windows.exe` from this release. The browser extension did not change.

## What changed

- **A disguised program is blocked also when its ending is long.** Ravenshelf blocks a program whose name pretends to be another kind of file, such as `invoice.pdf.exe`, and a program whose ending is pushed out of sight with a run of spaces. These names can't be downloaded from the review. But both checks only read file endings of up to five letters. Six program and script types that Ravenshelf knows have longer endings:
  - ClickOnce apps (`.application`);
  - app installer files (`.appinstaller`);
  - app bundles (`.msixbundle`, `.appxbundle`);
  - Windows gadgets (`.gadget`);
  - Windows settings shortcuts (`.settingcontent-ms`).

  A name such as `invoice.pdf.application` looked like a PDF, but only got the normal "this is a program, run it only if you trust it" warning. Now these checks read the whole ending, the same way Ravenshelf reads a file's type everywhere else, so these names are blocked like `invoice.pdf.exe`. This applies to browser downloads and to file names inside torrents.

- **In Arabic, the warnings for these types are shown in Arabic.** Before, the warnings for five of them (all except `.gadget`) were shown in English, because the app's translation only recognised file endings of up to eight letters without a hyphen.

Other names, and files that are not programs, get the same result as before.

## Checks

- **Automated tests:** one new test checks that every program and script type Ravenshelf knows is blocked when it is disguised as a PDF (also in capital letters and with an invisible character before the ending) or pushed away with spaces, that the message names the full ending, and that names which are not programs keep their result. Another test checks that the warnings for every program, script and disk-image type are shown in Arabic. Both failed before the fix and pass after. In total 1,262 tests: on Linux 1,221 passed, 0 failed, and 41 were skipped (Windows-only tests, and 2 that need Electron).
- **Independent review:** one reviewer checked the change, also by comparing the old and the new check on 400,000 random names, and found no problem: only names with one of the six long endings changed, from a warning to a block. Its suggestions (one shared pattern for file endings, a written-out invisible character in a test, and a check of every type's Arabic warning) are done.
- **Code scanning:** no new alerts (the 16 known notes, all reviewed before).
- **Supply chain:** the supply-chain check passed and `npm audit` found 0 vulnerabilities.
- GitHub's Windows test run, code scanning and source-signature checks run before release.

Passing these checks can't guarantee there are no bugs.
