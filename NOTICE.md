# Notices

Ravenshelf is an independent application. It is not affiliated with FitGirl, Hydra, Sigma, Steam, Epic, GOG, YouTube or any file host.

## Original source

Ravenshelf's original implementation is distributed under the [MIT License](LICENSE). Catalogue descriptions, cover images, game names and other third-party content retain their respective owners' rights and are retrieved from external services. The repository does not grant rights to download or redistribute third-party games.

## Dependencies

- [Electron](https://github.com/electron/electron) is MIT-licensed and includes Chromium, Node.js and additional components with their own notices. Preserve the license and third-party notice files included in its distribution.
- [Cheerio](https://github.com/cheeriojs/cheerio) is MIT-licensed.
- [Undici](https://github.com/nodejs/undici) is MIT-licensed.
- [sigstore-js](https://github.com/sigstore/sigstore-js) packages `@sigstore/verify`, `@sigstore/bundle`, `@sigstore/tuf` and `@sigstore/core`, and [`@sigstore/protobuf-specs`](https://github.com/sigstore/protobuf-specs), are Apache-2.0-licensed. They verify update build records; `@sigstore/tuf` includes Sigstore's public TUF root and trusted-root metadata.
- [tuf-js](https://github.com/theupdateframework/tuf-js) (`tuf-js`, `@tufjs/models`, `@tufjs/canonical-json`) is MIT-licensed. Its dependencies `minimatch` and `@isaacs/nonrecursive-glob-match` are BlueOak-1.0.0-licensed; `@gar/promise-retry`, `debug`, `ms`, `brace-expansion` and `balanced-match` are MIT-licensed.
- [electron-builder](https://github.com/electron-userland/electron-builder) is a build-time dependency with its own license and bundled-tool notices.

The lockfile records direct and transitive dependencies. Their licenses remain in their package distributions; Ravenshelf's MIT license does not replace those terms.

## Protection lists (downloaded at run time)

When the browser extension is connected, Ravenshelf downloads these lists for use on the user's PC. They are not bundled with or redistributed by Ravenshelf; **Settings → Browser extension** names each source and license.

- [URLhaus](https://urlhaus.abuse.ch/) data (CC0) through [malware-filter's urlhaus-filter](https://gitlab.com/malware-filter/urlhaus-filter) (CC0 and MIT). That project is not endorsed by abuse.ch.
- [malware-filter's phishing-filter](https://gitlab.com/malware-filter/phishing-filter): its lists are licensed CC BY-SA 4.0 and built from sources including OpenPhish, PhishTank and IPThreat under their own terms.
- [HaGeZi DNS blocklists](https://github.com/hagezi/dns-blocklists): Threat Intelligence Feeds (mini) and Pop-Up Ads, licensed GPL-3.0.

## YouTube helper programs (downloaded at the user's request)

When the user sets up YouTube downloads, Ravenshelf downloads these programs from their publishers' GitHub releases for use on the user's PC. They are not bundled with or redistributed by Ravenshelf; **Settings → YouTube downloads** names each version, license and source.

- [yt-dlp](https://github.com/yt-dlp/yt-dlp), released into the public domain under the Unlicense. Its Windows executable includes Python and other components under their own licenses.
- [Deno](https://github.com/denoland/deno), MIT-licensed.
- [FFmpeg](https://ffmpeg.org/) essentials build by Gyan Doshi, from [GyanD/codexffmpeg](https://github.com/GyanD/codexffmpeg), licensed GPL-3.0 as built. FFmpeg's source is available from the FFmpeg project.

Ravenshelf is not affiliated with YouTube, Google, the yt-dlp project, Deno Land or the FFmpeg project. YouTube's terms allow downloading only where YouTube offers it or with permission.

## Torrent program (downloaded at the user's request)

When the user turns on and sets up torrent downloads, Ravenshelf downloads [aria2](https://github.com/aria2/aria2) 1.37.0 from its GitHub release for use on the user's PC. aria2 is licensed GPL-2.0-or-later (with an OpenSSL linking exception); its source is available from that repository. It is not bundled with or redistributed by Ravenshelf; **Settings → Torrent downloads** names its version, license and source. Ravenshelf is not affiliated with the aria2 project, PixelDrain, MultiUpload or any tracker.

[VirusTotal](https://www.virustotal.com/) is optional and used only with the user's own API key; VirusTotal's terms apply to that key. Ravenshelf is not affiliated with VirusTotal, abuse.ch, malware-filter, HaGeZi, or the makers of the supported browsers.

The encrypted-paste reader implements the [PrivateBin](https://github.com/PrivateBin/PrivateBin) version 2 message format using Node.js crypto and zlib. PrivateBin's application code is not bundled as part of that implementation.

## Project references

These projects were reviewed as references for product ideas and workflows:

- [Hydra Launcher](https://github.com/hydralauncher/hydra)
- [FitRepacks Library](https://github.com/alsasoft-web/FitRepacks-Library)
- [FitGirl Automatic Download Assistant](https://github.com/xmtaha/FitGirl-Automatic-Download-Assistant)
- [Fit-girl-automator](https://github.com/bustacarl1331/Fit-girl-automator)

They are separate projects with their own licenses. Ravenshelf does not bundle their applications or claim to be an official fork. Reviewing a reference project is not a certification that its code or downloads are safe.

Only obtain files you have permission to download. Link availability, matching filenames and popup restrictions are not malware verdicts. Ravenshelf does not automatically run third-party installers or change antivirus settings.
