# Ravenshelf 0.10.11 — Forms are not sent twice

This is a small maintenance update. One safety rule for website forms is made stricter; everything else works the same as 0.10.10. You don't need to update now; the next update will include this one. To update anyway, open **Settings → Ravenshelf updates** and choose **Download and install**, or download `Ravenshelf-0.10.11-Windows.exe` from this release. The browser extension did not change.

## What changed

- **A form that a website answers with "moved" is never posted again to the new address.** Some download pages work with a form (an HTTP `POST` request). A site can answer such a form with "moved" (HTTP 301 or 302) and name another address. Ravenshelf's network layer then goes on to that address with an ordinary request, without the form's data, as web browsers do. This rule only worked when the request's name was written in capital letters (`POST`). The network library sends `post` as `POST` too, so a request written in small letters would have sent the form's data again to the new address, which can be another site. Now the rule is the same however the name is written.

Ravenshelf's own form requests are written in capital letters and handle "moved" answers themselves, so downloads work exactly as before. The change makes sure a later change can't send form data on by mistake. "Moved, keep the method" (HTTP 307 and 308) still keeps the form, as in browsers, and the checks every address gets don't change: only public HTTPS addresses, sign-in details are dropped when the request goes to another site, and closed hosts are never contacted.

## Checks

- **Automated tests:** one new test checks that a form sent on with 301 or 302 becomes an ordinary request without its data, whether its name is written `POST`, `post` or `Post`; that 307 and 308 keep the form; and that 301 leaves other requests (`GET`, `HEAD`, `head`) as they are. It failed before the fix and passes after. In total 1,258 tests: on Linux 1,217 passed, 0 failed, and 41 were skipped (Windows-only tests, and 2 that need Electron).
- **Code scanning:** no new alerts (the 16 known notes, all reviewed before).
- **Supply chain:** the supply-chain check passed and `npm audit` found 0 vulnerabilities.
- GitHub's Windows test run, code scanning and source-signature checks run before release.

Passing these checks can't guarantee there are no bugs.
