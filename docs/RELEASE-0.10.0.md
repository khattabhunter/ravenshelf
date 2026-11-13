# Ravenshelf 0.10.0 — More ways to download

Some games are not offered on the hosts Ravenshelf already handled. This version adds torrents, PixelDrain and MultiUpload, and reads FitGirl's pastes at their new address. Settings, collections, the queue and downloads stay where they are.

- **Torrent downloads, off until you agree.** In **Settings → Torrent downloads**, Ravenshelf first explains what torrents share: everyone sharing the same torrent can see this PC's IP address (only a VPN hides it), and Ravenshelf uploads pieces of a torrent to other people while it downloads. Turn them on, then choose **Set up torrent downloads**: Ravenshelf fetches aria2 1.37.0, a free torrent program, once (about 2.4 MB) from its official GitHub release and checks it against the SHA-256 recorded in Ravenshelf.
- **Magnet links from a game page, from your browser or pasted.** A game page with a torrent offers **Download with torrent**. With the browser extension, a magnet link you click on fitgirl-repacks.site opens in Ravenshelf. You see the torrent's files first and choose which to download; nothing downloads before that.
- **You decide how much it shares.** Choose an upload limit from 10 KB/s to 1 MB/s, and whether uploading stops right away when a torrent finishes (the default) or continues for up to 15 minutes or an hour.
- **Safe by design.** The torrent's file list must match its magnet link; names Windows can't store exactly as written, and names made to disguise a file, are refused, not renamed. Trackers on your PC or home network are never contacted. Files appear in one step when complete, keep Windows' downloaded-from-the-internet mark and are scanned by Microsoft Defender as one folder. aria2 runs with a fixed set of options, is controlled only from this PC with a random secret, keeps no log and exits with Ravenshelf.
- **PixelDrain and MultiUpload.** PixelDrain files and lists, and MultiUpload mirror pages (each file uses its copy on a supported host), now work in link checks.
- **Closed hosts named.** ZippyShare, BayFiles and LetsUpload have shut down. Ravenshelf names them and never contacts them.
- Everything new is in Arabic too.

**Updating from 0.9.0:** open **Settings → Ravenshelf updates** and choose **Download and install**, or download the portable executable below. The browser extension changed: after updating, choose **Reload** for Ravenshelf on the browser's extensions page. In Firefox, allow Ravenshelf on fitgirl-repacks.site from Firefox's extensions menu if magnet links do not open in Ravenshelf.

**Known limits:** torrents expose your IP address to everyone sharing the same torrent, and Ravenshelf neither sets up nor checks for a VPN. A torrent that nobody shares can't start. Version 2 torrents are not supported yet. The browser hook works on fitgirl-repacks.site only; paste other magnet links into **Import links**. Windows Firewall may ask whether to allow `aria2c.exe`; torrents still work, perhaps more slowly, if you don't. PixelDrain allows one connection per file and limits free downloads per day. Only download what you have the right to download and share.

Download **Ravenshelf-0.10.0-Windows.exe** and compare its SHA-256 with **SHA256SUMS.txt**, or verify its build record with the GitHub CLI as described in the README. The portable executable remains unsigned: the build record shows where the file was built, but it is not Windows publisher signing or a malware verdict. Keep Windows protections enabled.

[User guide: Torrent downloads](https://github.com/khattabhunter/ravenshelf/blob/v0.10.0/docs/USER-GUIDE.md#torrent-downloads) · [Privacy](https://github.com/khattabhunter/ravenshelf/blob/v0.10.0/docs/PRIVACY.md) · [Security](https://github.com/khattabhunter/ravenshelf/blob/v0.10.0/SECURITY.md)
