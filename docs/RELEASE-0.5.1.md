# Ravenshelf 0.5.1 — Delete finished browser downloads, retry dropped connections

This bug-fix release corrects problems found after 0.5.0. Settings, collections, the queue and downloads stay where they are.

- **Delete files works for browser downloads:** in 0.5.0, choosing **Delete files** for a finished browser download, such as a program or a picture, failed with "These files changed or could not be checked safely", because cleanup accepted only archive files. Ravenshelf now deletes browser downloads of any file type, but only from its own **Browser downloads** folder. In game folders, **Delete files** still removes only the downloaded archives, so files of an installed game are never touched. **Check space** now counts browser downloads too.
- **Dropped connections are retried:** if a connection drops or times out, Ravenshelf tries again by itself, up to twice in a row (after 15 and then 30 seconds). A retry that gets more of the file resets the count, so a long download survives occasional drops. When a download does fail, the message now says why: the connection timed out, was interrupted, or the host couldn't be reached or refused the connection.
- **No false "Added":** choosing **Download** for a browser download that is already in your queue (finished, failed or paused) now shows **Already in Downloads**. Use **Retry** on the existing entry, or remove it and download again. In 0.5.0 the review said **Added** although nothing was queued.
- **Clearer queue messages:** removing downloads no longer claims it cancelled a finish action when none was set.
- **Safer extension updates:** if the extension folder can't be replaced when Ravenshelf updates (for example, because another program has it open), the browser connection still starts with the previous extension files, and **Settings → Browser extension** tells you. Ravenshelf tries again the next time it starts.

**Updating from 0.5.0:** open **Settings → Ravenshelf updates** and choose **Download and install**. If you use the browser extension, choose **Reload** for Ravenshelf on your browser's extensions page afterwards; **Settings → Browser extension** reminds you while it is out of date. Open Ravenshelf normally: if it runs as administrator, Windows stops your browser from reaching it.

Download **Ravenshelf-0.5.1-Windows.exe** and compare its SHA-256 with **SHA256SUMS.txt**, or verify its build record with the GitHub CLI as described in the README. The portable executable remains unsigned: the build record shows where the file was built, but it is not Windows publisher signing or a malware verdict. Keep Windows protections enabled.

[User guide](https://github.com/khattabhunter/ravenshelf/blob/v0.5.1/docs/USER-GUIDE.md) · [Privacy](https://github.com/khattabhunter/ravenshelf/blob/v0.5.1/docs/PRIVACY.md) · [Security](https://github.com/khattabhunter/ravenshelf/blob/v0.5.1/SECURITY.md)
