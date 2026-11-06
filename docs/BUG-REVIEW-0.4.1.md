# 0.4.1 bug review

The review started from the published 0.4.0 source and the reports that every link check lacked size information and Check space appeared ineffective. Work used synthetic archives and separate Electron profiles; destructive tests did not use the user's downloads.

## CodeQL triage

The current main-branch findings were fetched from GitHub before changes: 12 open entries, all severity **note**, with no assigned security severity.

| Alerts | Rule | Review and disposition |
| --- | --- | --- |
| 9–14 | `cs/call-to-unmanaged-code` | Six calls inspect/open Windows handles. Managed path-only checks cannot replace their file identity, hard-link, reparse-point and held-handle checks. Retained. |
| 21, 23, 29 | `cs/unmanaged-code` | Three declarations use fixed `kernel32.dll` imports restricted to System32 and `SafeFileHandle`. Signatures, ownership and failures reviewed. Retained. |
| 30–32 | `cs/missed-using-statement` | These resources transfer ownership to a long-lived directory-lock collection or to the returned FileStream. A method-local using block would prematurely close the resource. Conditional failure cleanup and final-owner disposal are intentional; comments clarify this. Retained. |

No query, finding or scanning language was disabled. These notes do not establish an exploitable flaw, and their absence would not establish that all bugs are absent.

The surrounding updater audit found real JavaScript lifecycle bugs that those notes did not identify: shutdown did not await staging cleanup, and a failed job write could leave an exclusively-created helper blocking the next attempt. These have regression coverage and are fixed.

The transfer audit also reproduced a single-connection retry loop after all bytes had arrived but the stream failed before clean EOF. A matching HTTP 416 size now permits exactly one last-byte request with If-Range; existing validator, file identity, response-length and clean-EOF checks still apply. Unknown or mismatched 416 sizes do not trigger this recovery.

## Coverage

The complete automated suite passes **460 tests**, including 51 added regressions. A real Electron smoke run completed without main-process/renderer errors or external fixture requests. Tests overlap across areas; focused test counts are not added together.

- Link checks: successful HEAD without size, unsupported HEAD, known/unknown Content-Range totals, ignored range requests, body cancellation, HTML/challenges, HTTP errors, filename substitution and off-site redirects. The same probe serves FuckingFast, FileKeeper download servers and explicitly imported direct links.
- Transfers: byte equality, partial writes, one/four connections, fallback, pause/resume, restart, changed validators, truncated/oversized responses, rate limits, congestion cooldown and schedule/manual-pause separation.
- Storage/cleanup: missing parents/files, other archives outside the queue, duplicate paths/inodes, links/junctions, unexpected checkpoint entries, file/directory replacement, restarted ownership, incomplete scans and configured-folder boundaries. Untracked files never become deletion targets.
- Updater: fake release failures, truncated payloads, cancellation, five critical profile-backup files, helper preparation retry/concurrency, real Windows short aliases and locks, compiled benign restart fixture and rollback checks. No game installer was executed.
- Renderer: actual Electron main/preload/UI integration in an isolated profile, actual Check space and settings buttons, dirty forms during state refresh, fractional limits, cleanup choices, stale dialog events, metadata, image viewing and checksum-worker results.

Passing fixture tests does not guarantee that every remote host is available or that a game archive is authentic. If a host omits size even from a range response, Ravenshelf reports unknown size rather than treating the probe length as the full file. Browser verification remains a user step.

Live public Steam checks sampled four app IDs and verified two full requirements/review integrations. The reviewed trailer path used the correct Steam app ID; legacy movie IDs were not used. No metadata fix was needed. Read-only validation of configured-folder discovery also passed without modifying the profile. A separate Node-only FuckingFast check required browser verification, so no claim of universal live-host success is made. Personal inventories, paths and host tokens are not included in this report.

## External references used

- [HTTP Semantics, RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html): HEAD metadata can omit fields; Content-Range describes the complete representation separately from a partial response's length.
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security): renderer isolation, navigation/pop-up restrictions, IPC sender checks and dependency/framework review remain part of the regression coverage.

New unrelated features were not added during this maintenance review.
