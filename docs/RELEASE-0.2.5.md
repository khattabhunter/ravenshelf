# Atlas Library 0.2.5 — Saved-cookie encryption preview

Download **Atlas-Library-0.2.5-Windows.exe** from the assets below. Close the older Atlas instance, then open this portable Windows x64 build. Your existing local library and queue are retained and converted automatically. The executable is unsigned; keep Windows security protections enabled.

[User guide](https://github.com/khattabhunter/atlas-library/blob/main/docs/USER-GUIDE.md) · [Privacy and data handling](https://github.com/khattabhunter/atlas-library/blob/main/docs/PRIVACY.md) · [Build from source](https://github.com/khattabhunter/atlas-library/blob/main/docs/BUILDING.md)

## Changes

- Host cookies and other request headers saved with your download queue are now encrypted in `library.json` using your Windows account (Electron `safeStorage` / DPAPI).
- Queues saved by older versions are converted to the encrypted format the first time 0.2.5 opens.
- Headers that cannot be decrypted (a profile copied from another PC or account) are discarded, and the affected download refreshes its link when resumed.
- The protected host browser's Chromium cookie store is now encrypted on disk.
- Includes the 0.2.4 image-request protections.

## Limits

Encryption at rest protects copied profile files and other Windows accounts. It does not protect against malware already running as your Windows user. After running 0.2.5, older versions cannot read the encrypted host-browser sessions and may ask you to repeat host checks.

This update does not hide your IP address from the websites Atlas connects to, and Atlas is not an antivirus.

## Verification

The release workflow runs the offline test suite on Windows before packaging. The executable is built from the tagged source on GitHub's hosted build machines. **SHA256SUMS.txt** provides the exact executable checksum; GitHub generates the source archives from this tag.
