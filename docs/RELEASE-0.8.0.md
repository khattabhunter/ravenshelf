# Ravenshelf 0.8.0 — Arabic, and a Mods page

Ravenshelf can now be used in Arabic, and a new **Mods** page lists the mod files you downloaded on Nexus Mods. Settings, collections, the queue and downloads stay where they are.

- **Arabic:** **Settings → Language** offers **Same as Windows**, **English** and **العربية**. In Arabic the window reads right to left, and **Numbers** chooses 0 1 2 3 or ٠ ١ ٢ ٣. Notifications, file dialogs, window titles and the **Alt** menu follow the language. Changing it reloads the window; downloads keep running.
- **The browser extension follows:** its toolbar menu, warning page, notifications, right-click menu and YouTube button use Ravenshelf's language.
- **Mods page:** your Nexus Mods files by game, newest first, with search. **Mod page** opens the mod's page in your own browser, and **Show file** opens the file's folder. Ravenshelf itself never contacts Nexus Mods.
- **Steadier Nexus Mods downloads:** a file counts as a mod file only when its download began on Nexus Mods and comes from the site's file servers (nexus-cdn.com). Mod files of one game stay in one folder. A cancelled mod download gives up its link; start it again from the mod's page to continue it.
- **PC specs:** a second graphics adapter on Windows' basic display driver is now mentioned, and **Check again** after an incomplete check always reads again.

**Updating from 0.7.0:** open **Settings → Ravenshelf updates** and choose **Download and install**, or download the portable executable below. The extension's files changed: choose **Reload** for Ravenshelf on your browser's extensions page (in Firefox, load the temporary add-on again from `about:debugging`), then reload open Nexus Mods and YouTube tabs.

**Known limits:** the extension switches language the next time it talks to Ravenshelf: when you open its toolbar menu, when the browser starts, or at the latest within an hour. Its description in the browser's list follows the browser's own language. The Arabic texts are new; please report wrong or unclear wording. **Numbers** applies to Ravenshelf's own texts; digits that belong to a name or code, such as 4K or SHA-256, stay as they are. Text from websites, such as game descriptions and mod names, stays as the site wrote it, and folders Ravenshelf creates keep their English names on disk. The **Mods** page shows only what is in your **Downloads** list, and Ravenshelf still does not install mods.

Download **Ravenshelf-0.8.0-Windows.exe** and compare its SHA-256 with **SHA256SUMS.txt**, or verify its build record with the GitHub CLI as described in the README. The portable executable remains unsigned: the build record shows where the file was built, but it is not Windows publisher signing or a malware verdict. Keep Windows protections enabled.

[User guide: Language](https://github.com/khattabhunter/ravenshelf/blob/v0.8.0/docs/USER-GUIDE.md#language) · [User guide: Mods](https://github.com/khattabhunter/ravenshelf/blob/v0.8.0/docs/USER-GUIDE.md#the-mods-page) · [Privacy](https://github.com/khattabhunter/ravenshelf/blob/v0.8.0/docs/PRIVACY.md) · [Security](https://github.com/khattabhunter/ravenshelf/blob/v0.8.0/SECURITY.md)
