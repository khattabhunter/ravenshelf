# Ravenshelf 0.5.0 — Browser extension: downloads checked first, dangerous sites blocked

This release adds a Ravenshelf extension for Chrome, Edge, Brave and Firefox. It stays off until you connect it. Settings, collections, the queue and downloads stay where they are.

- **Downloads go through Ravenshelf first:** a download you start in the browser is handed to Ravenshelf, and the browser keeps no copy. Ravenshelf checks the link and shows it in **Downloads from your browser**; nothing is saved until you choose **Download**. If Ravenshelf is closed or doesn't answer, the browser downloads as usual. Downloads in private windows are never sent to Ravenshelf.
- **What is checked:** Ravenshelf follows redirects one hop at a time without opening the page or using your browser cookies, never contacts a listed site, your home network or an unencrypted address, and reads only the first 4 KB of the file to compare its name with its real type. Disguised programs such as `invoice.pdf.exe`, programs over unencrypted HTTP and links through listed sites are blocked. Other programs, scripts and disk images need you to confirm a warning first.
- **Dangerous sites are blocked in the browser:** Ravenshelf downloads four public lists of malware, phishing, scam and malicious pop-up ad sites (about 261,000 entries), checks them on your PC and gives them to the browser as its own blocking rules, refreshed every 12 hours. A blocked page explains why. Blocking continues while Ravenshelf is closed.
- **File-host pop-ups and redirects are stopped:** on FuckingFast and FileKeeper, a page can no longer send you to another site. A redirect puts the download page back, pop-ups are closed and an ad frame that takes over the tab is undone. Opening a site yourself is never blocked by this rule.
- **VirusTotal, if you want it:** with your own free API key, Ravenshelf also looks up the sites behind each browser download and the SHA-256 fingerprint of each finished one. Only site names and fingerprints are sent, never your files or full web addresses.
- **Privacy:** the extension talks only to Ravenshelf on your PC and contacts no other service itself. Ravenshelf downloads each list whole, so list providers learn nothing about the sites you visit.

**Set it up:** in **Settings → Browser extension**, turn on **Connect the browser extension**, then follow the steps shown for your browser. Chrome, Edge and Brave load the folder Ravenshelf prepares with **Load unpacked** in Developer mode. Firefox loads it as a temporary add-on from `about:debugging`, which Firefox removes when it closes. The extension is not in the browser stores yet.

**Limits:** the extension handles files the browser downloads; it does not detect or save videos playing on a page. Sites that need your browser sign-in can be downloaded only with **Download in browser instead**, because Ravenshelf never uses your browser cookies. Lists, file checks and VirusTotal reduce risk, but none proves that a file or site is safe. Security apps such as Malwarebytes can't be connected to Ravenshelf; they keep protecting your PC on their own. Keep Windows protections enabled.

**Updating from 0.4.2:** choose **Download and install** in **Settings → Ravenshelf updates**. Ravenshelf checks this release's signed build record before downloading it.

Download **Ravenshelf-0.5.0-Windows.exe** and compare its SHA-256 with **SHA256SUMS.txt**, or verify its build record with the GitHub CLI as described in the README. The portable executable remains unsigned: the build record shows where the file was built, but it is not Windows publisher signing or a malware verdict.

[User guide](https://github.com/khattabhunter/ravenshelf/blob/v0.5.0/docs/USER-GUIDE.md#browser-extension) · [Privacy](https://github.com/khattabhunter/ravenshelf/blob/v0.5.0/docs/PRIVACY.md) · [Security](https://github.com/khattabhunter/ravenshelf/blob/v0.5.0/SECURITY.md)
