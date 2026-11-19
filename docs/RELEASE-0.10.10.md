# Ravenshelf 0.10.10 — Link checks stay checks

This is a small maintenance update. Two rare link-check cases are fixed; everything else works the same as 0.10.9. You don't need to update now; the next update will include this one. To update anyway, open **Settings → Ravenshelf updates** and choose **Download and install**, or download `Ravenshelf-0.10.10-Windows.exe` from this release. The browser extension did not change.

## What changed

- **A link check no longer turns into a download when a file host sends it on with "see other".** Before a file is queued (for example after **Check links**), Ravenshelf asks the file host for the file's size and type, without the file itself (an HTTP `HEAD` request). A host can answer "see other" (HTTP 303) and name another address. Ravenshelf then asked that address for the whole file instead of only its size. It stopped as soon as the answer started, so little was transferred, but the host saw a real download start, which can count against a host's download limit. Now the check stays a check, as in web browsers. Other requests that get "see other" still continue the way they did before.
- **A link that refuses the check after being sent on is asked again for just one byte.** Some download links only allow downloads and refuse a size check ("forbidden", HTTP 403). When the host sent the check on to such a link (with any kind of redirect), Ravenshelf now asks again for just one byte, as it already did for hosts that don't answer size checks, instead of saying **open it in your browser** right away. A link that refuses the check at its own address is reported as before.

Downloads don't change, and neither do the checks every address gets: only public HTTPS addresses, and closed hosts are never contacted. FuckingFast links still can't be sent on to other sites.

## Checks

- **Automated tests:** two new tests check that a size check sent on with "see other" stays a size check (also when the request name is written in small letters, `head`), that other requests sent on with "see other" still become ordinary requests without their form data, and that a link that refuses the check after being sent on is asked for one byte, while a refusal at the address that was asked, or "not found", is reported as before. Both failed before the fix and pass after. In total 1,257 tests: on Linux 1,216 passed, 0 failed, and 41 were skipped (Windows-only tests, and 2 that need Electron).
- **Code scanning:** no new alerts (the 16 known notes, all reviewed before).
- **Supply chain:** the supply-chain check passed and `npm audit` found 0 vulnerabilities.
- **Independent review:** one independent review found no mistake in the change, pointed out one risk (a link that refuses size checks after being sent on would newly say **open it in your browser**), and confirmed the new tests fail before the fix. Its main notes were applied: that risk is fixed (the second change above), and these notes are more exact. Two older details it noticed are left for later.
- GitHub's Windows test run, code scanning and source-signature checks run before release.

Passing these checks can't guarantee there are no bugs.
