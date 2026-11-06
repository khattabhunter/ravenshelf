# Ravenshelf 0.3.3 — Security maintenance prerelease

This release addresses the four original CodeQL findings and related file-handling, error-reporting and download-validation problems found during review.

Download **Ravenshelf-0.3.3-Windows.exe** from the release assets, close the older Ravenshelf or Atlas Library window, then open it. Your library, collections and queue are kept. The executable is portable and remains **unsigned**; keep Windows security protections enabled.

[User guide](https://github.com/khattabhunter/ravenshelf/blob/v0.3.3/docs/USER-GUIDE.md) · [Privacy](https://github.com/khattabhunter/ravenshelf/blob/v0.3.3/docs/PRIVACY.md) · [Security](https://github.com/khattabhunter/ravenshelf/blob/v0.3.3/SECURITY.md) · [Build from source](https://github.com/khattabhunter/ravenshelf/blob/v0.3.3/docs/BUILDING.md)

## Fixed

- **Internal errors:** protocol errors and startup failures no longer return raw exception details. Unexpected IPC, link-check, catalogue, completion and transfer exceptions use safe messages while known validation guidance remains useful.
- **Download file checks:** retained file descriptors replace check-then-reopen behavior. New partials are created exclusively. Existing files and ancestors are checked for replacement/linking, and writes use validated offsets. The same handling covers split data and fallback-prefix copying.
- **Installed-game manifests:** reads validate the opened file and stop at a hard byte limit, even if a file grows. File and ancestor replacements are rejected.
- **Test-only finding:** archive size and digest assertions use the same buffer, without a separate pathname size check. Test files are not packaged into the app.

## Additional review fixes

- Exclusive random temporary files prevent predictable queue/checkpoint filenames from following a planted link.
- Split mode permits at most 65,536 sections (512 GiB per file); larger remote files use one stream. Saved split manifests are capped at 4 MiB to limit memory use.
- Single streams reject HTML, JSON, XML and script responses. Recently modified files without a strong ETag are not resumed using a weak timestamp alone.
- A failed or paused reset cannot associate old partial bytes with a new file validator. Unconsumed response streams are cancelled after local file failures.
- CodeQL now runs the broader **security-and-quality** suite. Test and release workflows also audit locked dependencies.
- The expanded scan also identified an unused catalogue callback argument and downloader assignment; both were removed. The new manifest-replacement test creates its replacement exclusively.

## Validation

296 automated tests cover downloads, byte integrity, resume/fallback, hostile file replacement, bounded metadata, error privacy, renderer progress and the existing security safeguards. Dependency auditing includes runtime and build dependencies. Review the repository's code-scanning alert list as well as the workflow status: a completed scan is not itself a finding-free result.

## Upgrade behavior and limits

Strong-ETag downloads, including the tested FuckingFast archive, keep resume support. Older partial downloads that only have an unverified Last-Modified timestamp restart from the beginning to avoid combining different versions. Existing split checkpoints remain supported within the documented metadata bounds.

Use an ordinary private download folder. Linked/junction-based paths and hard-linked partial files can be refused because their identity cannot be safely established by these checks. The app does not provide isolation from malicious programs already running under the same Windows account; portable Node filesystem checks cannot make every Windows path operation kernel-atomic.

Four connections, automatic single-connection fallback, compact progress updates, ad protections, encrypted saved headers, scan-aware completion actions and packaged integrity enforcement remain in place. Static analysis and passing tests do not prove that all bugs are absent or that downloaded games are safe.

## Verify the download

```powershell
Get-FileHash .\Ravenshelf-0.3.3-Windows.exe -Algorithm SHA256
gh attestation verify .\Ravenshelf-0.3.3-Windows.exe --repo khattabhunter/ravenshelf
```

The hash must match **SHA256SUMS.txt** on the release page. The attestation records the build's origin; it is not a Windows publisher signature.
