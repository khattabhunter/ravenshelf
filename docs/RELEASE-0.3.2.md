# Ravenshelf 0.3.2 — Progress update maintenance prerelease

This release reduces the work needed to display download progress, especially with several active files and a long download history.

Download **Ravenshelf-0.3.2-Windows.exe** from the release assets, close the older Ravenshelf or Atlas Library window, then open it. Your library, collections, queue and partial downloads are kept. The executable is portable and remains **unsigned**; keep Windows security protections enabled.

[User guide](https://github.com/khattabhunter/ravenshelf/blob/v0.3.2/docs/USER-GUIDE.md) · [Privacy](https://github.com/khattabhunter/ravenshelf/blob/v0.3.2/docs/PRIVACY.md) · [Security](https://github.com/khattabhunter/ravenshelf/blob/v0.3.2/SECURITY.md) · [Build from source](https://github.com/khattabhunter/ravenshelf/blob/v0.3.2/docs/BUILDING.md)

## Changed

- **Smaller progress updates.** Active transfers report together about twice per second. Regular progress messages contain file IDs and numeric counters rather than the full download history and settings.
- **Less card work.** The interface refreshes active counters and total speed without rebuilding completed cards, scan badges or action controls. Hidden views catch up when opened.
- **Outdated messages are ignored.** Ordered updates prevent a late progress message or state reply from undoing a newer pause, completion or scan result. Progress cannot change those states.
- **Important events remain immediate.** Pause, error, completion, scan and privacy-warning changes use the full-state path. Changes to header-storage warnings during periodic saves are explicitly reported.

The four 0.3.1 fixes remain in place: scan-aware close/shutdown, cautious Defender-result interpretation, no plaintext fallback for saved headers, and embedded app-archive integrity enforcement. Transfer validation, partial-file persistence and one-connection fallback remain unchanged.

## Validation and scope

Offline regression coverage checks progress-message ordering, data fields, renderer updates, download integrity and preservation of scan/completion and credential protections. Controlled responsiveness checks use fixture queues; they do not measure Internet or filehost throughput. The optimization reduces interface work and does not promise faster network downloads.

All **254 offline tests passed**. In 18 controlled Electron trials, the large-history default scenario (500 completed files and four active transfers) reduced progress messages from 8 to 2 per second and the median trial p95 timer lateness from 21.5 ms to 1.4 ms. Small queues were already responsive. An armed completion action retains its full safety snapshot every second; total work decreased, while its slowest individual updates did not improve. See the [measurement method and results](https://github.com/khattabhunter/ravenshelf/blob/v0.3.2/docs/PERFORMANCE-0.3.2.md) for limits.

## Verify the download

```powershell
Get-FileHash .\Ravenshelf-0.3.2-Windows.exe -Algorithm SHA256
gh attestation verify .\Ravenshelf-0.3.2-Windows.exe --repo khattabhunter/ravenshelf
```

The hash must match **SHA256SUMS.txt** on the release page. The attestation records the build's origin. Neither is a malware-free guarantee or a Windows publisher signature.
