# Atlas user guide

This guide describes Atlas Library 0.2.3 for Windows.

## Start and update Atlas

Download the portable executable from the repository's [Releases](https://github.com/khattabhunter/atlas-library/releases) page. Open it normally; an installer and administrator access are not required. Atlas is currently an unsigned preview.

To update, close the older Atlas window before opening the new executable. Preferences, collections and the queue stay in your Windows profile. Unfinished downloads reopen paused, so you can choose when to resume them.

## Browse the catalogue

**Discover** provides these views:

- **Newest:** most recently published repacks. The date is the repack's publication date, not the original game's release date.
- **Top games:** the source site's monthly popular list. Positions are source rankings, not Atlas review scores.
- **Genres:** source categories such as Action RPG, RPG, real-time strategy, action, simulation, racing and horror. A game can appear in more than one category.

Search within the selected section and use **Next page** to continue. Images, descriptions and sizes come from the live source and may change or become unavailable. Explicitly adult-tagged entries are hidden in the showcase; this is not a comprehensive content filter.

### Automatic refresh

Atlas checks for new uploads at startup and every five minutes while it remains open, including when minimized. It also checks after a wake or return to the window when a check is overdue. Closing Atlas stops these checks; it does not install a Windows background service.

Your current search, genre and page are preserved. If a game dialog or another view is open, the new catalogue results wait until you return. Failed requests retain the last successful catalogue. **Refresh** requests an immediate check.

This updates the catalogue only. It does not download new uploads or patch installed games.

## Save games and collections

Open a game and choose **Save to library** to keep it in Favorites. Use its collection picker to add it to a named collection or create one. Manage collections in **My library**.

Removing a library entry or collection does not delete downloaded files or installed games.

## Download a file set

1. Open a game and select **one host**. The available hosts usually offer alternative copies of the same archives; mixing mirrors can duplicate files.
2. Choose **Check download links**. Atlas expands supported paste links and checks the selected files.
3. Read each result. **Ready** means a file response was found. **Needs a browser step** means the host requires interaction. **Not found** means the host explicitly reported a missing or deleted file. Other failures remain **Not verified** with an explanation.
4. Use **Download all** when the required set is ready. If only some links are ready, the button clearly names how many files it can queue.
5. Follow progress in **Downloads**. Use pause, resume, retry, cancel or the completed file's folder button as needed.

Check the source notes for required parts, optional languages, updates and separate replacement archives. Before extracting a multipart archive, make sure all required parts are present. Atlas does not automatically extract files, test archive contents or run installers.

### Import, export and JDownloader

**Import links** accepts a supported game page, encrypted FitGirl paste or several direct HTTPS links. When a page offers multiple mirrors, choose one host first. **Check links again** retries the original sources.

**Copy links** and **Export link list** preserve the source addresses. **Send to JDownloader** sends them to a running JDownloader 2 instance through its local Click'n'Load interface. Check JDownloader's LinkGrabber after sending; acceptance does not prove every link is available.

### File-host behavior and ad protection

| Host | Expected behavior |
| --- | --- |
| FuckingFast | Atlas reads supported pages and normal download responses through its isolated browser session, without running those pages' scripts or clicking ad controls. A real verification challenge may still require a protected window. |
| FileKeeper | Supported free-download forms and short countdowns are handled automatically. CAPTCHA/password flows require a manual step. |
| DataNodes | Complete its browser steps, import a final direct HTTPS URL, or use JDownloader. |

An **Open protected host** button is available for manual cases. That window blocks new popup windows and requests or navigation outside the chosen host family, apart from the verification domain it needs. FuckingFast captures also check the download endpoint and, when the original link supplies a filename, match the returned archive name. Executable bait and unrelated destinations are rejected.

These restrictions can prevent a host flow from working if it depends on other domains. **Source page** opens your ordinary browser, whose protections are separate. Popup blocking, filename checks and transfer checks do not establish that archive contents are safe. Atlas does not change your antivirus settings.

### Connections and download speed

In **Settings**, two separate controls are available:

| Setting | Meaning |
| --- | --- |
| Simultaneous downloads | How many different files Atlas downloads at once: 1–4. |
| Connections per file | How many connections may fetch separate sections of one large file: 1, up to 2, or up to 4. The default is up to 4. |

Files of at least 16 MiB can use parallel sections when the host supplies reliable size and version information. Atlas validates the responses and automatically falls back to one connection if split downloads are unsupported, limited, interrupted or stalled. The download card explains the current mode. A failed fallback stays an error rather than being marked complete.

Settings apply when a file starts or resumes. Older `.atlas-part` downloads retain one connection to preserve their saved progress. Downloads started with the newer section-based system can resume with 1, 2 or 4 connections.

The speed display uses a recent five-second average. Your internet connection, other traffic, server limits and host load all affect throughput. Reduce simultaneous files or connections if a host repeatedly limits requests.

### Pause, restart and partial files

Closing Atlas pauses unfinished work. Reopen the app and resume from **Downloads**. Cancel retains partial data; it does not delete completed files. Atlas refuses to overwrite an existing completed destination.

Keep `.atlas-part` files and `.atlas-segments-*` support folders alongside their downloads until completion. Their saved progress is needed for resume. If the host cannot verify that the remote file still matches, Atlas may restart safely or report an error instead of joining different file versions.

## See installed games and reported versions

Choose **On this PC → Scan games**. Atlas reads supported Steam and Epic manifests, GOG and Windows installation records, and local game metadata. Use **Add game folder** to include a missed game or library folder; choose a specific folder rather than a whole drive.

Version labels show their evidence. A Steam build ID is different from a publisher version. Executable metadata can describe an engine or launcher rather than the game itself. **Not reported** means reliable metadata was unavailable; it does not mean the game is outdated.

The scan is bounded and can miss installations. It does not run discovered programs or automatically compare installed versions with repacks.

## Watch gameplay and open guides

**Watch gameplay** opens YouTube search results in a separate viewer. Choose the video you want; search results are not verified gameplay clips. Use **YouTube in browser** if the viewer cannot play a video. YouTube ads are not guaranteed to be blocked.

Guide buttons open labeled PCGamingWiki, YouTube walkthrough or Steam community searches. Where an exact Steam app ID is known, Atlas can link directly to that game's Steam pages. Results are not individually vetted guides.

## Choose what happens when downloads finish

Under **Downloads → When this queue finishes**, choose **Keep Atlas open**, **Close Atlas** or **Turn off laptop**.

The default is **Keep Atlas open** each time the app launches. Shutdown requires confirmation. Both close and shutdown wait for successful completion, then show a 60-second countdown with **Cancel — keep working**. Save work in other apps before permitting shutdown.

Paused or failed files keep the action waiting. New files join an armed queue; adding work during the countdown returns it to waiting. Cancelling a targeted file cancels the finish action. Restarting Atlas resets the choice. These actions concern downloads, not extraction or installation. Windows may delay shutdown if other apps need attention.

## Local data and troubleshooting

The app normally stores its profile under `%APPDATA%\atlas-repack-library`. It contains preferences, library entries, installed-game scan results, queue data and separate host-browser session data. Download files use the folder selected in **Settings**.

Close Atlas before backing up its profile. Treat this backup as private: saved paths, URLs and host-session information can be sensitive. Do not attach the profile, `library.json`, cookies or signed download URLs to a public issue.

| Problem | Next step |
| --- | --- |
| A link needs verification | Use its protected host button, then check the links again. |
| A link is not found | Check the source page for replacements or choose another complete mirror. |
| A host returns a webpage instead of a file | Complete the browser step or choose another mirror; do not treat the page as an archive. |
| Download is slow or unstable | Try fewer simultaneous files, then compare 1 and 4 connections. Host limits may still apply. |
| A partial download cannot resume | Read the per-file error. The remote file or direct URL may have changed. |
| Catalogue update fails | Keep the current results and retry Refresh later. Source changes can require an app update. |
| The app still shows old behavior after updating | Close all older Atlas windows, then open the new release executable. |

For a reproducible app problem, see [CONTRIBUTING.md](../CONTRIBUTING.md) before opening an issue.
