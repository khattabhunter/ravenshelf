# Ravenshelf 0.6.1 — Much faster YouTube setup and downloads

YouTube's one-time setup now takes about a minute, and videos download faster. Settings, collections, the queue and downloads stay where they are.

- **Setup in about a minute:** the three helper programs (about 168 MB) download in 2 MB parts over up to eight connections, and a connection that is far slower than the others is replaced. Where GitHub's download servers had slowed setup to more than an hour, it took about a minute in our trial. Every part must be exactly the part requested, and nothing is installed unless the finished files match the sizes and SHA-256 values recorded in Ravenshelf, as before.
- **Audio no longer holds videos up:** YouTube sometimes slowed its single-file audio to about 150 KB/s, so the audio could take longer than the video. Ravenshelf now takes the audio from YouTube's HLS stream, which downloads in parts like the video. In a trial, a 6-minute 1080p video took 16 seconds instead of 54. **Audio (M4A)** and **Audio (MP3)** use the same stream.
- **Eight parts at a time:** video and audio parts download eight at a time instead of four. With a limit in **Settings → Shared download speed**, they still download one at a time so the limit holds.
- **Always MP4:** videos are saved as MP4, including 4K videos in VP9 that 0.6.0 saved as MKV.
- **Several connections really means several:** file downloads use HTTP/1.1. Over HTTP/2, a site could carry all of a file's connections on a single one, so a download with up to four connections per file could be no faster than one.

**Updating from 0.6.0:** open **Settings → Ravenshelf updates** and choose **Download and install**. The browser extension hasn't changed, but its version number has: choose **Reload** for Ravenshelf on your browser's extensions page so **Settings → Browser extension** stops reporting it as out of date. If you already set up YouTube downloads, the helper programs stay as they are.

**Rules and limits:** only download videos you own, that use a Creative Commons licence, or that you have permission to save. YouTube's terms allow downloading only where YouTube offers it or with permission. Speeds depend on your connection and on YouTube's servers.

Download **Ravenshelf-0.6.1-Windows.exe** and compare its SHA-256 with **SHA256SUMS.txt**, or verify its build record with the GitHub CLI as described in the README. The portable executable remains unsigned: the build record shows where the file was built, but it is not Windows publisher signing or a malware verdict. Keep Windows protections enabled.

[User guide](https://github.com/khattabhunter/ravenshelf/blob/v0.6.1/docs/USER-GUIDE.md#youtube-downloads) · [Privacy](https://github.com/khattabhunter/ravenshelf/blob/v0.6.1/docs/PRIVACY.md) · [Security](https://github.com/khattabhunter/ravenshelf/blob/v0.6.1/SECURITY.md)
