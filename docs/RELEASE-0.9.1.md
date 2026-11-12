# Ravenshelf 0.9.1 — Safer file names

A small fix to how Ravenshelf names the files and folders it saves. Settings, collections, the queue and downloads stay where they are.

- **Device names with spaces:** a name like `con .txt` or `NUL .zip` now gets a `_` in front (`_con .txt`), as `con.txt` already did. Windows ignores the spaces before the dot, so such a name meant a Windows device (here the console), not a file. All other names are saved exactly as before.

**Updating from 0.9.0:** open **Settings → Ravenshelf updates** and choose **Download and install**, or download the portable executable below. The browser extension did not change.

Download **Ravenshelf-0.9.1-Windows.exe** and compare its SHA-256 with **SHA256SUMS.txt**, or verify its build record with the GitHub CLI as described in the README. The portable executable remains unsigned: the build record shows where the file was built, but it is not Windows publisher signing or a malware verdict. Keep Windows protections enabled.

[User guide](https://github.com/khattabhunter/ravenshelf/blob/v0.9.1/docs/USER-GUIDE.md) · [Privacy](https://github.com/khattabhunter/ravenshelf/blob/v0.9.1/docs/PRIVACY.md) · [Security](https://github.com/khattabhunter/ravenshelf/blob/v0.9.1/SECURITY.md)
