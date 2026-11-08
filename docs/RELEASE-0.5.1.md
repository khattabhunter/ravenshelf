# Ravenshelf 0.5.1 — Delete finished browser downloads

This bug-fix release makes finished browser downloads removable from disk. Settings, collections, the queue and downloads stay where they are.

- **Delete files works for browser downloads:** in 0.5.0, choosing **Delete files** for a finished browser download, such as a program or a picture, failed with "These files changed or could not be checked safely", because cleanup accepted only archive files. Ravenshelf now deletes browser downloads of any file type, but only from its own **Browser downloads** folder. In game folders, **Delete files** still removes only the downloaded archives, so files of an installed game are never touched.
- **Check space counts browser downloads:** the storage summary now includes them instead of reporting that some tracked files could not be checked safely.

**Updating from 0.5.0:** open **Settings → Ravenshelf updates** and choose **Download and install**. If you use the browser extension, choose **Reload** for Ravenshelf on your browser's extensions page afterwards; **Settings → Browser extension** reminds you while it is out of date.

Download **Ravenshelf-0.5.1-Windows.exe** and compare its SHA-256 with **SHA256SUMS.txt**, or verify its build record with the GitHub CLI as described in the README. The portable executable remains unsigned: the build record shows where the file was built, but it is not Windows publisher signing or a malware verdict. Keep Windows protections enabled.

[User guide](https://github.com/khattabhunter/ravenshelf/blob/v0.5.1/docs/USER-GUIDE.md) · [Privacy](https://github.com/khattabhunter/ravenshelf/blob/v0.5.1/docs/PRIVACY.md) · [Security](https://github.com/khattabhunter/ravenshelf/blob/v0.5.1/SECURITY.md)
