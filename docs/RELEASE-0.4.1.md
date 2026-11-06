# Ravenshelf 0.4.1 — Download checks, storage and update reliability

This maintenance release fixes missing-size checks, misleading storage totals and several settings/update lifecycle bugs. Existing settings, queue records and downloads use the same profile and locations.

- **Link sizes:** a successful HEAD response without a usable size now triggers one bounded range request. The check cancels the body after receiving headers and uses the complete Content-Range size, not the probe's one-byte length. HTML, verification failures, off-site FuckingFast redirects and substituted filenames remain blocked. Hosts that genuinely omit size stay clearly labeled; no size is invented.
- **Download retry:** if a stream fails after writing its last byte, Retry now rechecks that byte with the existing file validator and waits for a clean ending. It no longer loops on a range beyond the file's end, and never treats HTTP 416 alone as proof of completion.
- **Download storage:** Check space now separates queue-managed files from other archives in the configured download folder, explains missing queue files and shows checking/completion feedback. Other archives are read-only; queue cleanup cannot delete them. Scans have count, depth and time bounds and label incomplete results.
- **Cleanup:** a damaged or unexpected checkpoint entry no longer hides an independently checked archive's size. Deletion rechecks queue ownership after asynchronous filesystem checks.
- **Settings:** background state refreshes preserve unsaved speed/schedule edits. Failed preference saves restore the saved value, and fractional speed limits work with the form's native validation.
- **Dialogs:** a delayed close event cannot invalidate a newly opened cleanup preview or image viewer.
- **Updates:** shutdown waits for unfinished staging cleanup, disposed updaters cannot start new requests, and failed/concurrent preparation can be retried without a leftover helper blocking the verified update.

The 12 existing CodeQL notes were reviewed individually. They flag required Windows file-handle APIs and intentional resource ownership transfers. No query or alert was suppressed; those protections remain. See the [bug review](https://github.com/khattabhunter/ravenshelf/blob/v0.4.1/docs/BUG-REVIEW-0.4.1.md) for test coverage and limits.

Validation includes **460 passing automated tests**, an isolated Electron run exercising real UI controls, and sampled live Steam metadata checks. A read-only storage check found archives outside an empty queue without changing profile data. Windows release checks additionally validate the packaged security settings and native helper build record.

Download **Ravenshelf-0.4.1-Windows.exe** and compare its SHA-256 with **SHA256SUMS.txt**, or let the existing app prepare the update. A prepared update installs on normal close; Restart now requires idle work. The portable executable remains unsigned. Keep Windows protections enabled.

[User guide](https://github.com/khattabhunter/ravenshelf/blob/v0.4.1/docs/USER-GUIDE.md) · [Privacy](https://github.com/khattabhunter/ravenshelf/blob/v0.4.1/docs/PRIVACY.md) · [Security](https://github.com/khattabhunter/ravenshelf/blob/v0.4.1/SECURITY.md)
