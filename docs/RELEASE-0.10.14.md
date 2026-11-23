# Ravenshelf 0.10.14 — Page-built Excel add-ins and scripts are blocked

This is a small maintenance update. One safety check in the browser extension is made stricter; everything else works the same as 0.10.13. You don't need to update now; the next update will include this one. To update anyway, open **Settings → Ravenshelf updates** and choose **Download and install**, or download `Ravenshelf-0.10.14-Windows.exe` from this release. **The browser extension changed:** after updating, open your browser's extensions page and choose **Reload** on Ravenshelf.

## What changed

- **Every program, script and disk-image type that Ravenshelf knows is blocked when a web page builds the file itself.** Most downloads are links, and Ravenshelf downloads and checks them itself. But a page can also build a file inside the browser (a `blob:` or `data:` link). Ravenshelf cannot download such a file again to check it, so the extension decides on the spot: risky types are blocked, everything else stays in the browser. Building a file this way is a common trick to slip malware past web filters.

  The extension's list of risky types was shorter than Ravenshelf's own list. These six types got through:
  - Excel add-ins (`.xll`), which can run code when Excel opens them;
  - Excel web queries (`.iqy`) and SYLK sheets (`.slk`);
  - ClickOnce apps (`.application`);
  - Windows gadgets (`.gadget`);
  - Windows settings shortcuts (`.settingcontent-ms`).

  A page-built file of one of these types went to the browser without a word from Ravenshelf. Now it is blocked like a page-built `.exe`, with the same message. A new test makes sure the extension blocks every type that Ravenshelf treats as a program, script or disk image, so a type added to Ravenshelf's list can't be missed by the extension again.

Page-built pictures, videos, documents and archives stay in the browser as before. Downloads from ordinary links are checked by Ravenshelf as before.

## Checks

- **Automated tests:** one new test checks that a page-built file of every program, script and disk-image type is blocked, for `blob:` and `data:` links, that the message names the file without its folder, and that page-built spreadsheets, documents, pictures, music, web pages and archives are not blocked. It failed before the fix (for the six types above) and passes after. In total 1,261 tests: on Linux 1,220 passed, 0 failed, and 41 were skipped (Windows-only tests, and 2 that need Electron).
- **Independent review:** one reviewer checked the change and found no problem in the code. Its suggestions (one more test case, clearer test messages, and more exact wording in these notes and the changelog) are done.
- **Code scanning:** no new alerts (the 16 known notes, all reviewed before).
- **Supply chain:** the supply-chain check passed and `npm audit` found 0 vulnerabilities.
- GitHub's Windows test run, code scanning and source-signature checks run before release.

Passing these checks can't guarantee there are no bugs.
