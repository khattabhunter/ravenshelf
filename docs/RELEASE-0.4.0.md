# Ravenshelf 0.4.0 — Library and download controls prerelease

This release adds more control over downloads, clearer game details and portable app updates while retaining the existing transfer and ad protections.

Download **Ravenshelf-0.4.0-Windows.exe** from the release assets. Close an older Ravenshelf or Atlas Library window before opening it; your library, collections and queue are kept. The executable is portable and **unsigned**. Keep Windows security protections enabled.

[User guide](https://github.com/khattabhunter/ravenshelf/blob/v0.4.0/docs/USER-GUIDE.md) · [Privacy](https://github.com/khattabhunter/ravenshelf/blob/v0.4.0/docs/PRIVACY.md) · [Security](https://github.com/khattabhunter/ravenshelf/blob/v0.4.0/SECURITY.md) · [Build from source](https://github.com/khattabhunter/ravenshelf/blob/v0.4.0/docs/BUILDING.md)

## New controls

- **Download speed and hours:** one shared payload-speed limit across active files/connections, local-time weekday and overnight schedules, and host cooldowns after limiting responses. Manually paused files stay paused.
- **Queue cleanup:** select several entries or review completed downloads. **Remove from list** keeps files; **Delete files** requires a fresh explicit confirmation. The preview pauses selected active transfers, and cancelling leaves them paused. Failures are reported per entry. Storage and space-to-recover figures are logical size estimates.
- **Archive preflight:** warnings for recognizable gaps, duplicate part numbers and inconsistent known sizes. Errorful sets need explicit confirmation; an unknown final part does not establish that the selection is complete.
- **Manual checksums:** choose an SFV, MD5 or SHA-256 manifest and folder, then review matches, mismatches, missing files and errors. Verification runs in a worker and can be cancelled. It checks agreement with the manifest, not publisher authenticity or malware safety.
- **Game details:** click covers/screenshots to enlarge them, browse with arrow keys and close with Escape. View available system requirements and real Steam recommendation counts. The stars express the positive-review ratio out of five; missing data is not invented.
- **Local preferences:** genre suggestions from saved/completed games, optional cover-colored accents, desktop notices and an opt-in copied-link tray. Copied links require review and checking; recognition itself makes no network request.

## App updates

The Windows portable build can automatically check and prepare newer published versions, including prereleases, from this repository. Checks run shortly after launch and every six hours while enabled. **Check for updates** also prepares an eligible update. Development and unpacked builds do not replace themselves.

A verified update installs on normal close; **Restart now** is available when work is idle. The updater checks the repository, tag, asset name/size and SHA-256 against both GitHub's asset digest and the release checksum file. It rechecks the staged candidate and backs up critical profile files before a native Windows helper replaces the executable. This does not change PowerShell policy, request elevation or provide a Windows publisher signature. The backup is not a complete copy of browser sessions or downloaded games.

## Boundaries kept explicit

The parallel threshold remains **16 MiB** and regular progress stays batched every **500 ms**. These controls do not promise a measured speed increase on an external host. Downloads are not automatically extracted or executed, and catalogue refresh does not patch installed games.

Proxy/VPN binding and a kill switch, Brave Search API integration, moving all work into workers, and a naive inline hash of parallel game-file chunks are deferred. Interface binding alone would not guarantee leak prevention; a search API would not guarantee anonymity or free access. Current public-network, filename, popup, saved-header, Defender and completion-action checks remain in place.

## Verify the release file

Validation before publication: 409 automated tests passed, dependency auditing reported no known vulnerabilities, and an isolated Electron run exercised the new settings, metadata, image viewer, cleanup choices and checksum worker with no app errors or external test requests. Live public metadata checks returned Steam requirements/review counts and valid GitHub release metadata. Packaged Electron protections and the native helper's build record are checked during the release build.

CodeQL includes the new C# helper. Its informational native-code notes are reviewed in [Security](https://github.com/khattabhunter/ravenshelf/blob/v0.4.0/SECURITY.md); necessary Windows file-handle calls remain visible to scanning rather than being suppressed.

```powershell
Get-FileHash .\Ravenshelf-0.4.0-Windows.exe -Algorithm SHA256
gh attestation verify .\Ravenshelf-0.4.0-Windows.exe --repo khattabhunter/ravenshelf
```

The hash must match **SHA256SUMS.txt**. The attestation records build origin and can be checked separately; the automatic updater does not verify that attestation. Tests, checksums and static analysis do not prove that all bugs are absent or that downloaded games are safe.
