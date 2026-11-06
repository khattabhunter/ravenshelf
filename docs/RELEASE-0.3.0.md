# Ravenshelf 0.3.0 — Preview

**Atlas Library is now Ravenshelf.** Download **Ravenshelf-0.3.0-Windows.exe** from the assets below, close the older Atlas Library window, then open it. Your library, collections, download queue and download folder are kept. The executable is portable and not code-signed; keep Windows security protections enabled.

[Security](https://github.com/khattabhunter/ravenshelf#security) · [User guide](https://github.com/khattabhunter/ravenshelf/blob/main/docs/USER-GUIDE.md) · [Privacy](https://github.com/khattabhunter/ravenshelf/blob/main/docs/PRIVACY.md) · [Build from source](https://github.com/khattabhunter/ravenshelf/blob/main/docs/BUILDING.md)

## New

- **Microsoft Defender scans:** every finished file is scanned with Microsoft Defender, one at a time, and the result appears on its download card. Turn this off in Settings, or scan any finished file again with its shield button.
- **Hardened executable:** other programs can no longer reuse Ravenshelf's Electron runtime to run their own code (run-as-Node, `NODE_OPTIONS` and debugger flags are disabled), and app code loads only from its packaged archive.
- **Signed build record:** this release has a signed provenance attestation proving it was built by this repository's release workflow on GitHub.
- **Automatic checks:** CodeQL code scanning and Dependabot updates now run on the repository.
- Includes the encrypted saved cookies from 0.2.5 and the image-request protection from 0.2.4.

## Verify this download

```powershell
Get-FileHash .\Ravenshelf-0.3.0-Windows.exe -Algorithm SHA256
gh attestation verify .\Ravenshelf-0.3.0-Windows.exe --repo khattabhunter/ravenshelf
```

The hash must match **SHA256SUMS.txt** below.

## Limits

A clean Defender result and a working link do not prove a file is safe. Ravenshelf does not hide your IP address from the websites it connects to and is not an antivirus.
