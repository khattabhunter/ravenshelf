# Ravenshelf 0.4.2 — Updates ask first and check the signed build record

This security release changes how Ravenshelf updates itself. Settings, collections, the queue and downloads stay in the same profile and locations.

- **Updates ask first:** automatic checks still look for new versions shortly after start and every six hours, but they only tell you a version is available. Nothing is downloaded or installed until you choose **Download and install** in **Settings → Ravenshelf updates**. **What’s new** opens that version's release page. A verified update installs when you close Ravenshelf, or with **Restart now** when downloads, scans and verification are idle.
- **Signed build record:** before downloading an approved update, Ravenshelf checks GitHub's Sigstore build record for that exact file. It must be signed for this repository's `publish-release.yml` workflow on `main`, on a GitHub-hosted runner, and name the executable's exact SHA-256. If the record is missing or anything does not match, the update stops and your current app is unchanged. To check signatures, Ravenshelf contacts Sigstore's public key service (`tuf-repo-cdn.sigstore.dev`), or uses the copy bundled with the app if that service is unreachable.
- **Leftover cleanup:** after an update, the previous executable stays next to the app as `.ravenshelf-rollback-….exe`, and the downloaded copy stays in the profile's `updates/pending/` folder; each is about 110 MB. Ravenshelf now removes them shortly after it starts, but only when the update's own result shows success and the rollback copy exactly matches the executable that was replaced. After a failed update, the rollback copy is kept. Profile backups are kept.
- **Release record:** each release from this one on includes `Ravenshelf-<version>-Windows.exe.sigstore.json`. Before publishing, a read-only release job checks it with the same verifier the app uses.

**Updating from 0.4.1:** 0.4.1 prepares this update automatically and installs it when you close Ravenshelf, as before. The approval step applies to updates offered by 0.4.2 and later. After this update, Ravenshelf also cleans up the files that earlier in-app updates left behind.

Download **Ravenshelf-0.4.2-Windows.exe** and compare its SHA-256 with **SHA256SUMS.txt**, or verify its build record with the GitHub CLI as described in the README. The portable executable remains unsigned: the build record shows where the file was built, but it is not Windows publisher signing or a malware verdict. Keep Windows protections enabled.

[User guide](https://github.com/khattabhunter/ravenshelf/blob/v0.4.2/docs/USER-GUIDE.md) · [Privacy](https://github.com/khattabhunter/ravenshelf/blob/v0.4.2/docs/PRIVACY.md) · [Security](https://github.com/khattabhunter/ravenshelf/blob/v0.4.2/SECURITY.md)
