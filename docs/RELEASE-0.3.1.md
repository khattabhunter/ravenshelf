# Ravenshelf 0.3.1 — Maintenance prerelease

This release fixes four safety issues in completion actions, Defender results, saved request headers and packaged-archive enforcement.

Download **Ravenshelf-0.3.1-Windows.exe** from the release assets, close the older Ravenshelf or Atlas Library window, then open it. Your library, collections, queue and partial downloads are kept. The executable is portable and remains **unsigned**; keep Windows security protections enabled.

[User guide](https://github.com/khattabhunter/ravenshelf/blob/v0.3.1/docs/USER-GUIDE.md) · [Privacy](https://github.com/khattabhunter/ravenshelf/blob/v0.3.1/docs/PRIVACY.md) · [Security](https://github.com/khattabhunter/ravenshelf/blob/v0.3.1/SECURITY.md) · [Build from source](https://github.com/khattabhunter/ravenshelf/blob/v0.3.1/docs/BUILDING.md)

## Fixed

- **Close/shutdown waits for scans.** Queued and running Defender scans delay the finish action. Threats, unclear results and scans that could not finish successfully block it. Readiness is checked again before the final action, including a scan started during the countdown.
- **Unclear Defender output stays unclear.** A successful exit code alone no longer produces a clean label. Ravenshelf requires recognized explicit clean output and shows **needs review** for ambiguous or unsupported output. Threat/remediation evidence takes precedence; check Windows Security's Protection history when prompted.
- **Saved headers never fall back to plaintext.** If Windows encryption fails or is unavailable, headers remain in memory and are omitted from saved queue data. A warning explains this. After restart, affected links are refreshed before a resumed file request and may need another browser step. Legacy plaintext is removed from the current saved queue; older backups are not rewritten.
- **Embedded archive integrity is enforced.** The package enables embedded ASAR-integrity validation alongside archive-only application loading. `npm run verify:build` inspects the actual packaged executable's fuse values.

## Verify the download

```powershell
Get-FileHash .\Ravenshelf-0.3.1-Windows.exe -Algorithm SHA256
gh attestation verify .\Ravenshelf-0.3.1-Windows.exe --repo khattabhunter/ravenshelf
```

The hash must match **SHA256SUMS.txt** on the release page. The attestation records the build's origin. Neither is a malware-free guarantee or a Windows publisher signature.

## Limits

This release does not tune download speed, and no live filehost speed improvement is claimed. Host limits and network conditions still apply. A clean Defender result does not prove a file safe; Ravenshelf does not automatically extract archives or run downloaded installers. Internet services still see the IP used to connect.
