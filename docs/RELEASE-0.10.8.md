# Ravenshelf 0.10.8 — Long names cleaned twice

This is a small maintenance update. One rare file-name case is fixed; everything else works the same as 0.10.7. You don't need to update now; the next update will include this one. To update anyway, open **Settings → Ravenshelf updates** and choose **Download and install**, or download `Ravenshelf-0.10.8-Windows.exe` from this release. The browser extension did not change.

## What changed

- **A very long file name that starts with a Windows device name is saved exactly as it was checked.** Windows reads names like `CON`, `NUL` or `COM1` as devices, not files, so Ravenshelf puts `_` in front of them (`con.txt` is saved as `_con.txt`). Names are cut at 180 characters. For a name that was already 180 characters long, the `_` made it 181. A file from a protected host window (FuckingFast, DataNodes or FileKeeper) has its name cleaned twice: once when it is checked, and again when it is queued. The second time cut the last letter, so a name checked as `….rar` could be saved as `….ra`. Now cleaning a name again never changes it: the `_` in front of a device name is the one character allowed past 180.
- **A rare invisible blank at the very end of a name is removed the first time.** A few blank characters (such as U+2028, a line separator) could stay at the end of a name after a dot or a cut, and were only removed when the name was cleaned again. Now they are removed at once.

Ordinary names don't change. Downloads already in your list keep their names.

## Checks

- **Automated tests:** a new test checks that cleaning a cleaned name changes nothing for long device names, blank characters and about 1,000 edge-case names, and that the queue saves a protected host's file under the name that was checked. It failed before the fix and passes after. One older test now expects a long device name to stay whole when it is cleaned again. In total 1,253 tests: on Linux 1,212 passed, 0 failed, and 41 were skipped (Windows-only tests, and 2 that need Electron).
- **Code scanning:** no new alerts (the 16 known notes, all reviewed before).
- **Supply chain:** the supply-chain check passed and `npm audit` found 0 vulnerabilities.
- **Independent review:** one independent review of the change found no problem. Its suggestions (write invisible characters in the test as escape codes, mention the 181 exception in the code's first comment) were applied.
- GitHub's Windows test run, code scanning and source-signature checks run before release.

Passing these checks can't guarantee there are no bugs.
