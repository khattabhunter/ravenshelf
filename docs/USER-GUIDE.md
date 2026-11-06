# Ravenshelf user guide

This guide describes Ravenshelf 0.4.0 for Windows, a feature prerelease.

## Start and update Ravenshelf

Download the portable executable from the repository's [Releases](https://github.com/khattabhunter/ravenshelf/releases) page. Open it normally; an installer and administrator access are not required. Ravenshelf is currently an unsigned preview.

To move from an older version, close its window before opening the new executable. Preferences, collections and the queue stay in your Windows profile. Unfinished downloads reopen paused, so you can choose when to resume them.

### Automatic app updates

In the packaged Windows portable release, **Settings → Ravenshelf updates** checks this repository for newer published versions, including prereleases. **Automatically check and prepare updates** is on by default: checks start shortly after launch and repeat every six hours while the app is open. **Check for updates** also downloads and verifies a newer eligible release; it is not only a version lookup. Turning automatic checks off leaves the manual button available. Development and unpacked builds do not replace themselves.

When the status says an update is ready, it installs on the next normal close. Background preparation does not restart or interrupt your queue. **Restart now** is available only while downloads, scans, file verification and completion actions are idle. Closing the app pauses unfinished downloads as usual; resume them after reopening.

Ravenshelf accepts the expected executable from this GitHub repository and release tag, verifies its size and SHA-256 against GitHub's asset digest and `SHA256SUMS.txt`, then checks the staged file again before installation. It backs up `library.json`, `installed-games.json`, `Local State`, `Preferences` and `renderer-cache.json` when present, under the profile's `updates/backups/` directory. This is a backup of critical profile files, not a complete backup of every browser partition or your downloaded files.

The native Windows helper applies the update after the app exits. It does not request elevation or change PowerShell execution policy or Windows security settings. Keep the portable executable in an ordinary writable folder. If verification or replacement fails, use the release page to update manually. The executable remains unsigned: checksum verification is not publisher signing or a malware verdict.

## Browse the catalogue

**Discover** provides these views:

- **Newest:** most recently published repacks. The date is the repack's publication date, not the original game's release date.
- **Top games:** the source site's monthly popular list. Positions are source rankings, not Ravenshelf review scores.
- **Genres:** source categories such as Action RPG, RPG, real-time strategy, action, simulation, racing and horror. A game can appear in more than one category.

Search within the selected section and use **Next page** to continue. Images, descriptions and sizes come from the live source and may change or become unavailable. Explicitly adult-tagged entries are hidden in the showcase; this is not a comprehensive content filter.

### Automatic refresh

Ravenshelf checks for new uploads at startup and every five minutes while it remains open, including when minimized. It also checks after a wake or return to the window when a check is overdue. Closing Ravenshelf stops these checks; it does not install a Windows background service.

Your current search, genre and page are preserved. If a game dialog or another view is open, the new catalogue results wait until you return. Failed requests retain the last successful catalogue. **Refresh** requests an immediate check.

This updates the catalogue only. It does not download new uploads or patch installed games.

## Save games and collections

Open a game and choose **Save to library** to keep it in Favorites. Use its collection picker to add it to a named collection or create one. Manage collections in **My library**.

Removing a library entry or collection does not delete downloaded files or installed games.

The **A few you might like** suggestions use available genre information from saved and completed games to find matches on the current catalogue page. They explain the matching genres and can be empty when metadata or matches are unavailable. This preference matching stays on your laptop; it does not send a taste profile to a service.

### Images, requirements and player recommendations

Click a game cover or screenshot to enlarge it. Use the left/right arrow keys or on-screen buttons to browse, and **Escape** to close and return to the image button. **Settings → Match accents to game artwork** controls the optional cover-derived color accents.

Game details show system requirements when the source provides them. Where a verified Steam app ID is available, Ravenshelf requests Steam requirements and recommendation counts. The displayed stars are `positive recommendations ÷ total reviews × 5`, rounded to one decimal, beside the percentage and review count. They are not literal five-star reviews or a Ravenshelf editorial score. Missing data is labeled unavailable; requirements are not a test of your laptop's compatibility. Use **View Steam source** to inspect the linked listing. The review data comes from [Steam's documented review API](https://partner.steamgames.com/doc/webapi/IUserReviewsService#GetAppReviews).

## Download a file set

1. Open a game and select **one host**. The available hosts usually offer alternative copies of the same archives; mixing mirrors can duplicate files.
2. Choose **Check download links**. Ravenshelf expands supported paste links and checks the selected files.
3. Read each result. **Ready** means a file response was found. **Needs a browser step** means the host requires interaction. **Not found** means the host explicitly reported a missing or deleted file. Other failures remain **Not verified** with an explanation.
4. Read the archive-set warnings. Recognizable numbered archives are checked for earlier/internal gaps, duplicate part numbers and inconsistent known sizes among nonfinal parts. Errors require a fresh **Queue these ready files anyway** confirmation. An unknown final part is a warning: a gap-free selection does not prove the whole archive is present.
5. Use **Download all** when the required set is ready. If only some links are ready, the button clearly names how many files it can queue. Only those ready files enter the queue. If the archive check itself fails, check the links again first.
6. Follow progress in **Downloads**. Use pause, resume, retry, cancel or the completed file's folder button as needed.

Check the source notes for required parts, optional languages, updates and separate replacement archives. Before extracting a multipart archive, make sure all required parts are present. Ravenshelf does not automatically extract files, test archive contents or run installers.

### Import, export and JDownloader

**Import links** accepts a supported game page, encrypted FitGirl paste or several direct HTTPS links. When a page offers multiple mirrors, choose one host first. **Check links again** retries the original sources.

**Copy links** and **Export link list** preserve the source addresses. **Send to JDownloader** sends them to a running JDownloader 2 instance through its local Click'n'Load interface. Check JDownloader's LinkGrabber after sending; acceptance does not prove every link is available.

### File-host behavior and ad protection

| Host | Expected behavior |
| --- | --- |
| FuckingFast | Ravenshelf reads supported pages and normal download responses through its isolated browser session, without running those pages' scripts or clicking ad controls. A real verification challenge may still require a protected window. |
| FileKeeper | Supported free-download forms and short countdowns are handled automatically. CAPTCHA/password flows require a manual step. |
| DataNodes | Complete its browser steps, import a final direct HTTPS URL, or use JDownloader. |

An **Open protected host** button is available for manual cases. That window blocks new popup windows and requests or navigation outside the chosen host family, apart from the verification domain it needs. FuckingFast captures also check the download endpoint and, when the original link supplies a filename, match the returned archive name. Executable bait and unrelated destinations are rejected.

These restrictions can prevent a host flow from working if it depends on other domains. **Source page** opens your ordinary browser, whose protections are separate. Popup blocking, filename checks and transfer checks do not establish that archive contents are safe. Ravenshelf does not change your antivirus settings.

### Connections and download speed

In **Settings**, two separate controls are available:

| Setting | Meaning |
| --- | --- |
| Simultaneous downloads | How many different files Ravenshelf downloads at once: 1–4. |
| Connections per file | How many connections may fetch separate sections of one large file: 1, up to 2, or up to 4. The default is up to 4. |

Files of at least 16 MiB can use parallel sections when the host supplies reliable size and version information. Ravenshelf validates the responses and automatically falls back to one connection if split downloads are unsupported, limited, interrupted or stalled. The download card explains the current mode. A failed fallback stays an error rather than being marked complete.

Settings apply when a file starts or resumes. Older `.atlas-part` downloads retain one connection to preserve their saved progress. Downloads started with the newer section-based system can resume with 1, 2 or 4 connections.

The speed display uses a recent five-second average. Your internet connection, other traffic, server limits and host load all affect throughput. Reduce simultaneous files or connections if a host repeatedly limits requests.

From 0.3.2, progress counters refresh together about twice per second, updating active download cards without redrawing completed history. Pause, errors, completion and scan results still update immediately. This reduces interface work; it does not increase a file host's bandwidth or guarantee faster downloads.

### Shared speed limit and download hours

**Settings → Shared download speed** sets one combined limit across active file transfers, their connections and app-update executable downloads. Choose MB/s or KB/s, then **Save limit**; `0` means unlimited. This controls download payloads, not every catalogue, browser or update-metadata request, and short bursts or protocol overhead can differ from the displayed limit.

Under **Download hours**, enable a schedule, choose the laptop's local start/end time and weekdays, then save. An overnight window belongs to its starting day: Friday 22:00–06:00 continues into Saturday morning. Matching start/end times allow the whole selected day. Ravenshelf pauses work when the window closes and resumes work paused by the schedule when it opens again. A download you paused manually remains paused. The app must remain open and the laptop awake; scheduling does not wake or launch it.

The schedule controls the game download queue. Automatic app-update checks and preparation can still run outside that window; disable automatic updates separately if desired.

Host limiting responses can put that host into a cooldown. Respecting the delay reduces repeated rejected requests; it does not bypass the host's limits or promise higher speed.

### Pause, restart and partial files

Closing Ravenshelf pauses unfinished work. Reopen the app and resume from **Downloads**. Cancel retains partial data; it does not delete completed files. Ravenshelf refuses to overwrite an existing completed destination.

Keep `.atlas-part` files and `.atlas-segments-*` support folders alongside their downloads until completion. Their saved progress is needed for resume. If the host cannot verify that the remote file still matches, Ravenshelf may restart safely or report an error instead of joining different file versions.

### Remove entries or clean up files

Use a card's remove button, select several files, or choose **Clean up completed** in Downloads. **Select visible** affects the current filter; the selected count can include entries selected under another filter. Review the listed files and estimated size before proceeding.

- **Remove from list** is always the initial choice. It stops selected transfers and removes their queue entries while keeping their files.
- **Delete files** permanently removes the selected managed download files and their queue entries. It requires a fresh confirmation checkbox every time. It does not uninstall games or clear an entire download folder.

Opening the preview pauses selected active downloads. Cancelling leaves them paused; resume them explicitly in Downloads. Changed, linked, shared or inaccessible files can be refused. If only some files can be removed, the dialog reports the failures and requires another preview before retrying.

The storage bar and **Estimated space to recover** use logical file sizes. Windows sparse/compressed storage and filesystem behavior can make actual recovered disk space different. Unchecked or inaccessible files are reported rather than counted as known sizes. Removing an entry from the list also removes it from this managed-storage view.

## Manually verify downloaded files

Choose **Settings → File integrity → Verify files…**, then **Choose manifest & folder**. Select an SFV (CRC32), MD5 or SHA-256 manifest and the folder whose relative filenames match it. If the manifest describes extracted files, extract them yourself first; Ravenshelf does not extract archives.

Verification runs in a separate worker and can be cancelled. Results distinguish **match**, **mismatch**, **missing** and **error**. A completed check can still contain failures; review the counts and individual rows. Manifests are bounded to 2 MiB and 2,000 entries, and unsafe paths or linked files are refused.

A match detects agreement with the chosen manifest, useful for finding corruption. It does not establish that the manifest is authentic, that a file came from its publisher, or that its contents are safe. A checksum check is separate from Microsoft Defender scanning.

## Copied links and desktop notices

**Settings → Notice copied download links** is off by default. When enabled while Ravenshelf is open, it recognizes supported host and paste links in clipboard text and puts them in **Copied links**. Choose **Inspect link** to fill the Import links form, then press **Check links** yourself. Recognition makes no automatic network request and never starts a download. Dismiss unwanted entries or turn the preference off to clear the tray. Links are held in memory, expire after 30 minutes and are not a clipboard history.

**Desktop notifications** controls generic completion, problem and ready-update notices. They omit game names, filenames and paths. Windows notification settings can also suppress them. They are not scan or checksum verdicts.

## Microsoft Defender scans

When a file finishes, Ravenshelf asks Microsoft Defender to scan it and shows the result on the download card:

- **Microsoft Defender found no threats** — Ravenshelf recognized an explicit clean result from Defender. A successful exit code alone is not enough.
- **Microsoft Defender found a threat** — do not open the file. Defender may already have quarantined or removed it. Open **Windows Security → Virus & threat protection → Protection history** for details.
- **Result needs review** — Defender finished, but Ravenshelf could not confidently interpret a clean result. Check **Windows Security → Virus & threat protection → Protection history**. Unrecognized language or output formats can produce this status.
- **Not scanned** — Defender is unavailable (for example, another antivirus replaced it), the file was missing, or the scan could not finish. Scan the file with your antivirus before opening it.

Scans run one at a time so the PC stays responsive; large archives can take a few minutes. Use the shield button on a finished download to scan it again. Turn automatic scans on or off in **Settings → Scan finished downloads**. Ravenshelf never changes Defender settings and never adds exclusions. A clean result lowers risk but cannot prove a file is safe.

## See installed games and reported versions

Choose **On this PC → Scan games**. Ravenshelf reads supported Steam and Epic manifests, GOG and Windows installation records, and local game metadata. Use **Add game folder** to include a missed game or library folder; choose a specific folder rather than a whole drive.

Version labels show their evidence. A Steam build ID is different from a publisher version. Executable metadata can describe an engine or launcher rather than the game itself. **Not reported** means reliable metadata was unavailable; it does not mean the game is outdated.

The scan is bounded and can miss installations. It does not run discovered programs or automatically compare installed versions with repacks.

## Watch gameplay and open guides

**Watch gameplay** opens YouTube search results in a separate viewer. Choose the video you want; search results are not verified gameplay clips. Use **YouTube in browser** if the viewer cannot play a video. YouTube ads are not guaranteed to be blocked.

Guide buttons open labeled PCGamingWiki, YouTube walkthrough or Steam community searches. Where an exact Steam app ID is known, Ravenshelf can link directly to that game's Steam pages. Results are not individually vetted guides.

## Choose what happens when downloads finish

Under **Downloads → When this queue finishes**, choose **Keep Ravenshelf open**, **Close Ravenshelf** or **Turn off laptop**.

The default is **Keep Ravenshelf open** each time the app launches. Shutdown requires confirmation. Both close and shutdown wait for successful transfers and any requested Defender scans, then show a 60-second countdown with **Cancel — keep working**. Queued or running scans keep the action waiting. A threat, uncertain result, failed scan, missing file or unavailable scanner blocks the action. Review the result and scan again after resolving it, or choose **Keep Ravenshelf open**. Turning off future automatic scans does not bypass a scan already recorded for a file. Files for which no scan was requested do not acquire a new scan just because a finish action is selected.

Readiness is checked again before the final action, including scans started during the countdown. Save work in other apps before permitting shutdown.

Paused or failed files keep the action waiting. New files join an armed queue; adding work during the countdown returns it to waiting. Cancelling a targeted file cancels the finish action. Restarting Ravenshelf resets the choice. These actions concern downloads, not extraction or installation. Windows may delay shutdown if other apps need attention.

## Local data and troubleshooting

The app normally stores its profile under `%APPDATA%\atlas-repack-library` (the folder keeps its original name so updates from Atlas Library keep your data). It contains preferences, library entries, installed-game scan results, queue data and separate host-browser session data. Download files use the folder selected in **Settings**.

Close Ravenshelf before backing up its profile. Treat this backup as private: saved paths, URLs and host-session information can be sensitive. Do not attach the profile, `library.json`, cookies or signed download URLs to a public issue.

If Windows cannot encrypt saved download headers, Ravenshelf displays a warning and keeps those headers in memory only. The queue and partial files remain saved. After restart, affected downloads refresh their source links before resuming and may need another protected-browser step. Version 0.3.1 removes plaintext headers from the current older queue file; it does not rewrite previous backups.

Read the [privacy notes](PRIVACY.md) for data flows and IP visibility. Catalogue, image and download services still see the IP used to connect; Ravenshelf's ad protections do not make those requests anonymous.

| Problem | Next step |
| --- | --- |
| A link needs verification | Use its protected host button, then check the links again. |
| A link is not found | Check the source page for replacements or choose another complete mirror. |
| A host returns a webpage instead of a file | Complete the browser step or choose another mirror; do not treat the page as an archive. |
| Download is slow or unstable | Try fewer simultaneous files, then compare 1 and 4 connections. Host limits may still apply. |
| Downloads are waiting at certain times | Check Download hours, the laptop's clock and the schedule status in Downloads. |
| Cleanup was cancelled but a transfer is paused | Resume it in Downloads; the preview pauses active files for review. |
| A checksum check finished with mismatches | Verify that the manifest and chosen folder belong together; review missing/error rows and reacquire damaged files from your intended source. |
| App update is unavailable | Use the packaged Windows portable release, or update manually from Releases. |
| A partial download cannot resume | Read the per-file error. The remote file or direct URL may have changed. |
| A header-storage warning appears | Headers were not saved in plaintext. Keep the current session open if needed; after restart, resume or recheck the source link and complete any requested browser verification. |
| Automatic close or shutdown is waiting | Check download cards for queued/running scans or results needing review. Resolve the result and scan again, or choose **Keep Ravenshelf open**. |
| Catalogue update fails | Keep the current results and retry Refresh later. Source changes can require an app update. |
| The app still shows old behavior after updating | Close all older Ravenshelf windows, then open the new release executable. |

For a reproducible app problem, see [CONTRIBUTING.md](../CONTRIBUTING.md) before opening an issue.
