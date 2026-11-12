# Ravenshelf user guide

This guide describes Ravenshelf 0.9.0 for Windows, a preview release. See the [0.9.0 release notes](RELEASE-0.9.0.md) for what changed and the [0.4.1 bug review](BUG-REVIEW-0.4.1.md) for earlier fixes and known limits.

## Start and update Ravenshelf

Download `Ravenshelf-0.9.0-Windows.exe` from the [v0.9.0 release](https://github.com/khattabhunter/ravenshelf/releases/tag/v0.9.0). Open it normally; an installer and administrator access are not required. Ravenshelf is currently an unsigned preview.

To move from an older version, close its window before opening the new executable. Preferences, collections and the queue stay in your Windows profile. Unfinished downloads reopen paused, so you can choose when to resume them.

### Automatic app updates

In the packaged Windows portable release, **Settings → Ravenshelf updates** checks this repository for newer published versions, including prereleases. **Check for updates automatically** is on by default: checks start shortly after launch and repeat every six hours while the app is open. A check only looks for a newer release. When one is found, the status shows its version, a desktop notice appears (if notifications are on), and **What’s new** opens its release page. Nothing is downloaded until you choose **Download and install**. Turning automatic checks off leaves **Check for updates** available. Development and unpacked builds do not replace themselves.

After you choose **Download and install**, Ravenshelf first checks GitHub's checksum and the release's signed build record, then downloads the executable. When the status says the update is verified, it installs on the next normal close. Downloading does not restart or interrupt your queue. **Restart now** is available only while downloads, scans, file verification and completion actions are idle. Closing the app pauses unfinished downloads as usual; resume them after reopening.

The signed build record is GitHub's Sigstore attestation for that exact file. Ravenshelf accepts it only when it was created by this repository's `publish-release.yml` workflow on the `main` branch, on a GitHub-hosted runner, and names the executable's exact SHA-256. To check it, Ravenshelf refreshes Sigstore's public signing keys from `tuf-repo-cdn.sigstore.dev`, or uses the copy bundled with the app when that service is unreachable. If the record is missing or does not match, the update stops and your current app is unchanged. The executable must also match its size and SHA-256 in GitHub's asset digest and `SHA256SUMS.txt`, and the staged file is checked again before installation. It backs up `library.json`, `installed-games.json`, `Local State`, `Preferences` and `renderer-cache.json` when present, under the profile's `updates/backups/` directory. This is a backup of critical profile files, not a complete backup of every browser partition or your downloaded files.

The native Windows helper applies the update after the app exits. It does not request elevation or change PowerShell execution policy or Windows security settings. Keep the portable executable in an ordinary writable folder. If verification or replacement fails, use the release page to update manually. The executable remains unsigned: the build record shows where the file was built, but it is not Windows publisher signing or a malware verdict.

After a successful update, the helper keeps the previous executable next to the app as a hidden-name `.ravenshelf-rollback-….exe` copy, and the downloaded copy stays in the profile's `updates/pending/` folder. From 0.4.2, Ravenshelf removes these shortly after it starts, but only when the update's own result shows success and the rollback copy exactly matches the executable that was replaced. After a failed update, the rollback copy is kept. Profile backups are kept.

Updating from 0.4.1 to 0.4.2 still uses 0.4.1's behavior: it prepares the update automatically and installs it on close. The approval step applies to updates offered by 0.4.2 and later.

## Language

**Settings → Language** sets the language of Ravenshelf and its browser extension: **Same as Windows** (the default), **English** or **العربية** (Arabic). **Same as Windows** uses Arabic when Arabic is first in your Windows language list, and English otherwise. Changing the language reloads the window and brings you back to Settings; downloads keep running.

In Arabic the window reads right to left. File names, folder paths, web addresses and game names keep their own direction. **Numbers**, shown only in Arabic, chooses 0 1 2 3 or ٠ ١ ٢ ٣; digits that belong to a name or code, such as 4K or SHA-256, stay as they are.

The language also applies to desktop notifications, file dialogs, the titles of Ravenshelf's other windows and the menu that **Alt** shows. Folders that Ravenshelf creates in your download folder, such as **Browser downloads**, **Mods** and **YouTube**, keep their English names on disk, so files keep going to the same place. Text that comes from websites, such as game descriptions, source notes and mod names, stays as the site wrote it.

The browser extension (its toolbar menu, warning page, notifications, right-click menu and YouTube button) changes language the next time it talks to Ravenshelf: when you open its toolbar menu, when the browser starts, or at the latest within an hour while Ravenshelf is open. Until it has heard from Ravenshelf, it uses your browser's language. Its description in the browser's list of extensions follows the browser's language.

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

Game details show system requirements when the source provides them. Where a verified Steam app ID is available, Ravenshelf requests Steam requirements and recommendation counts. The displayed stars are `positive recommendations ÷ total reviews × 5`, rounded to one decimal, beside the percentage and review count. They are not literal five-star reviews or a Ravenshelf editorial score. Missing data is labeled unavailable. **Can you run it?** (below) compares the lists with this PC. Use **View Steam source** to inspect the linked listing. The review data comes from [Steam's documented review API](https://partner.steamgames.com/doc/webapi/IUserReviewsService#GetAppReviews).

### Can you run it?

When a game has Steam requirement lists, its details show **Can you run it?** above them. Choose **Compare with this PC**: Ravenshelf reads this PC's specs (as on the **PC specs** page, if they have not been read since starting) and sets each line it recognises in the **Minimum** and **Recommended** lists beside what this PC has: Windows, 64-bit Windows, processor, memory, graphics, graphics memory, DirectX and storage. Other lines, such as sound card, network and notes, stay in the lists below and are not compared.

- **Meets** and **Below** are given only for figures: the Windows version, 64-bit Windows, memory, graphics memory, DirectX (with its feature level when the list names one, such as DirectX 12 Ultimate) and free space.
- **Processor** and **Graphics** always say **Can’t tell** and show both names. Comparing models needs a ranking of them, and none may be included in Ravenshelf; compare the names yourself, for example on a benchmark site.
- A line also says **Can’t tell** when the list gives no figure, or when Windows gives no figure for this PC (for example on a PC where only the basic details could be read, where **64-bit Windows** cannot be told). It does when the line can be read two ways: figures in one line that disagree ("100 GB (150 GB during installation)"), a Windows line that rules versions out ("Windows 7 is not supported"), or one that asks for an update of the version this PC has ("Windows 10 version 2004", "Windows 7 SP1"). **Memory** does when Windows reports only the memory it can use and that is less than the figure (installed memory is what lists mean). **Graphics memory** does for built-in graphics, which use part of the PC's memory, and when less memory is found on a device Windows does not call a card. A graphics line about built-in graphics, and sizes in it said to be system memory or a speed, give no figure. **DirectX** does for "DirectX 12" when the card supports DirectX 12 at an older feature level. **Graphics memory** and **DirectX** do for a graphics device that Windows reports a problem with. **64-bit Windows** does on Windows on ARM, which runs many 64-bit games but not every one.
- **Graphics memory** within a twentieth of the figure counts as meeting it, because Windows reports a "6 GB" card as a little less. When the list names several cards, the smallest graphics memory it prints is the figure.
- **Free space** compares the game's storage line with the fixed drive that has the most room, which need not be the drive of your download folder. Removable drives are left out.
- Each list gets a sentence: it meets what can be checked, it is below in named items, or it could not be checked. A "Recommended" heading inside the minimum list ends that list.

After this PC's specs have been read once, later games are compared as soon as you open them. **Compare again** reads this PC again, as **Check again** on **PC specs** does, and compares once more. The comparison is made on this PC from the game's own list and the specs Ravenshelf keeps in memory; nothing is sent anywhere or saved. **Meets** means the figures Ravenshelf can read reach the list. It is not a promise of how well a game runs, which also depends on the processor, the graphics card and the game itself.

## Download a file set

1. Open a game and select **one host**. The available hosts usually offer alternative copies of the same archives; mixing mirrors can duplicate files.
2. Choose **Check download links**. Ravenshelf expands supported paste links and checks the selected files.
3. Read each result. **Ready** means a file response was found. **Needs a browser step** means the host requires interaction. **Not found** means the host explicitly reported a missing or deleted file. Other failures remain **Not verified** with an explanation.
4. Read the archive-set warnings. Recognizable numbered archives are checked for earlier/internal gaps, duplicate part numbers and inconsistent known sizes among nonfinal parts. Errors require a fresh **Queue these ready files anyway** confirmation. An unknown final part is a warning: a gap-free selection does not prove the whole archive is present.
5. Use **Download all** when the required set is ready. If the files need more room than the drive of your download folder has free (less what downloads already waiting there still need), Ravenshelf says so, and the button waits for a tick in **Queue them anyway**; free some space or choose another download folder in **Settings** first if you can. Files of unknown size, and files already in the queue, are not counted; downloads that failed count with what they still need. A check that cannot be made says **Free space could not be checked.** and holds the button for four seconds at most. The check is made when the results appear: after choosing another folder, choose **Check links again**. It covers file sets queued here; browser, YouTube and Nexus Mods downloads are not checked. If only some links are ready, the button clearly names how many files it can queue. Only those ready files enter the queue. If the archive check itself fails, check the links again first.
6. Follow progress in **Downloads**. Use pause, resume, retry, cancel or the completed file's folder button as needed. If a connection drops or times out, Ravenshelf retries by itself up to twice in a row before showing the error.

Check the source notes for required parts, optional languages, updates and separate replacement archives. Before extracting a multipart archive, make sure all required parts are present. Ravenshelf does not automatically extract files, test archive contents or run installers.

**Ready, but size unknown** is possible. If the host's first response omits its size, Ravenshelf makes a small range request and checks for a reliable full-file total. It cancels the response as soon as the information needed for the check arrives. Some hosts omit that total too, so the file can still be ready to download while its size remains unknown. The size of the small response is never presented as the whole archive's size.

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

Files of at least 16 MiB can use parallel sections when the host supplies reliable size and version information. Each section has its own connection (Ravenshelf uses HTTP/1.1 for file transfers, so a site can't carry them all on one). Ravenshelf validates the responses and automatically falls back to one connection if split downloads are unsupported, limited, interrupted or stalled. The download card explains the current mode. A failed fallback stays an error rather than being marked complete.

Settings apply when a file starts or resumes. Older `.atlas-part` downloads retain one connection to preserve their saved progress. Downloads started with the newer section-based system can resume with 1, 2 or 4 connections.

The speed display uses a recent five-second average. Your internet connection, other traffic, server limits and host load all affect throughput. Reduce simultaneous files or connections if a host repeatedly limits requests.

From 0.3.2, progress counters refresh together about twice per second, updating active download cards without redrawing completed history. Pause, errors, completion and scan results still update immediately. This reduces interface work; it does not increase a file host's bandwidth or guarantee faster downloads.

### Shared speed limit and download hours

**Settings → Shared download speed** sets one combined limit across active file transfers, their connections and app-update executable downloads. Choose MB/s or KB/s, enter a value such as `2.25` MB/s, then **Save limit**; `0` means unlimited. This controls download payloads, not every catalogue, browser or update-metadata request, and short bursts or protocol overhead can differ from the displayed limit.

Under **Download hours**, enable a schedule, choose the laptop's local start/end time and weekdays, then save. An overnight window belongs to its starting day: Friday 22:00–06:00 continues into Saturday morning. Matching start/end times allow the whole selected day. Ravenshelf pauses work when the window closes and resumes work paused by the schedule when it opens again. A download you paused manually remains paused. The app must remain open and the laptop awake; scheduling does not wake or launch it.

The schedule controls the game download queue. Automatic app-update checks can still run outside that window; an update you approve downloads immediately and shares the speed limit. Disable automatic checks separately if desired.

Speed-limit and schedule edits stay in the form when background progress or settings updates arrive, even after you move focus away. Use each form's save button to apply its changes; editing a value alone does not change the active setting.

Host limiting responses can put that host into a cooldown. Respecting the delay reduces repeated rejected requests; it does not bypass the host's limits or promise higher speed.

### Pause, restart and partial files

Closing Ravenshelf pauses unfinished work. Reopen the app and resume from **Downloads**. Cancel retains partial data; it does not delete completed files. Ravenshelf refuses to overwrite an existing completed destination.

Keep `.atlas-part` files and `.atlas-segments-*` support folders alongside their downloads until completion. Their saved progress is needed for resume. If the host cannot verify that the remote file still matches, Ravenshelf may restart safely or report an error instead of joining different file versions.

### Remove entries or clean up files

Use a card's remove button, select several files, or choose **Clean up completed** in Downloads. **Select visible** affects the current filter; the selected count can include entries selected under another filter. Review the listed files and estimated size before proceeding.

- **Remove from list** is always the initial choice. It stops selected transfers and removes their queue entries while keeping their files.
- **Delete files** permanently removes the selected managed download files and their queue entries. It requires a fresh confirmation checkbox every time. It does not uninstall games or clear an entire download folder. In game folders it deletes only downloaded archives; downloads taken over from your browser can be any file type and are deleted from the **Browser downloads** folder, and mod files from Nexus Mods from their `Mods\<game>` folder.

Opening the preview pauses selected active downloads. Cancelling leaves them paused; resume them explicitly in Downloads. Changed, linked, shared or inaccessible files can be refused. If only some files can be removed, the dialog reports the failures and requires another preview before retrying.

### Check download storage

Under **Downloads → Download storage**, choose **Check space**. The button shows **Checking…** while it works, then the result includes the time of the check. The summary separates:

- **Managed by your queue:** completed files and remaining partial data belonging to queue entries. Cleanup applies only to reviewed queue-managed files.
- **Other archives:** recognized archives found in your configured download folder that are not in the queue. Expand their list to see names and sizes. This list is read-only; those files cannot be selected or deleted through queue cleanup.
- **Missing files:** queue entries whose expected files are no longer at the saved location. The entries remain in the queue, and missing bytes are not counted. Any remaining partial data may still be included.

The check is limited to queue-owned files and recognized archives in the configured download folder, including up to three levels of subfolders. Folder discovery stops after 5,000 entries or about three seconds, lists at most 200 other archives, and does not follow symbolic links or folder junctions. Broad personal/system folders, such as the whole Downloads folder or a drive root, are not scanned for other archives; choose a dedicated game-download folder. Incomplete checks show a warning and partial totals. This is not a whole-drive space analyzer.

The storage bar and **Estimated space to recover** use logical file sizes. Windows sparse/compressed storage and filesystem behavior can make actual recovered disk space different. Unchecked or inaccessible files are reported rather than counted as known sizes. Removing an entry from the list keeps its files; after another check, recognized archives still in the configured folder may appear under **Other archives**. That total is stored data, not a promise of space available to delete.

## Manually verify downloaded files

Choose **Settings → File integrity → Verify files…**, then **Choose manifest & folder**. Select an SFV (CRC32), MD5 or SHA-256 manifest and the folder whose relative filenames match it. If the manifest describes extracted files, extract them yourself first; Ravenshelf does not extract archives.

Verification runs in a separate worker and can be cancelled. Results distinguish **match**, **mismatch**, **missing** and **error**. A completed check can still contain failures; review the counts and individual rows. Manifests are bounded to 2 MiB and 2,000 entries, and unsafe paths or linked files are refused.

A match detects agreement with the chosen manifest, useful for finding corruption. It does not establish that the manifest is authentic, that a file came from its publisher, or that its contents are safe. A checksum check is separate from Microsoft Defender scanning.

## Copied links and desktop notices

**Settings → Notice copied download links** is off by default. When enabled while Ravenshelf is open, it recognizes supported host and paste links in clipboard text and puts them in **Copied links**. Choose **Inspect link** to fill the Import links form, then press **Check links** yourself. Recognition makes no automatic network request and never starts a download. Dismiss unwanted entries or turn the preference off to clear the tray. Links are held in memory, expire after 30 minutes and are not a clipboard history.

**Desktop notifications** controls generic completion, problem, update-available and update-ready notices. They omit game names, filenames and paths. Windows notification settings can also suppress them. They are not scan or checksum verdicts.

## Browser extension

The Ravenshelf extension sends the downloads you start in Chrome, Edge, Brave or Firefox to Ravenshelf, which checks each one before anything is saved. It also blocks dangerous sites and stops the pop-ups and redirects of file-host pages. It stays off until you connect it.

### Set it up

1. In Ravenshelf, open **Settings → Browser extension** and turn on **Connect the browser extension**. Ravenshelf registers its small connector for your Windows account (no administrator rights) and prepares the extension folders.
2. **Chrome, Edge or Brave:** choose **Open folder** under Chrome, Edge or Brave. In the browser, open `chrome://extensions` (Edge and Brave accept this address too), turn on **Developer mode**, choose **Load unpacked** and select the folder Ravenshelf opened.
3. **Firefox:** choose **Open folder** under Firefox. In Firefox, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…** and select `manifest.json` in that folder. Firefox removes temporary add-ons when it closes, so repeat this after restarting Firefox.

The status line in Settings shows when the extension last contacted Ravenshelf. After Ravenshelf updates, it tells you if the extension is out of date: choose **Reload** for Ravenshelf on the browser's extensions page.

Turning the switch off removes the connector registration, and the browser then keeps all downloads. To remove the extension itself, use the browser's extensions page.

### What happens when you download

When you start a download, the browser hands it to Ravenshelf and keeps no copy. Ravenshelf opens **Downloads from your browser** and checks the link:

- It follows redirects one hop at a time, and never contacts a site on its protection lists, your home network or an unencrypted address.
- It reads only the first 4 KB of the file, without the page's scripts or your browser cookies, to compare the name with the file's real type.
- FuckingFast, FileKeeper and DataNodes links are resolved by Ravenshelf's own host support.
- With a VirusTotal key, it also looks up the sites involved.

Then you choose. **Download** adds the file to your queue, in the **Browser downloads** folder (files from Nexus Mods go to a **Mods** folder instead: see [Nexus Mods downloads](#nexus-mods-downloads)). **Download in browser instead** lets your browser download it once, for links Ravenshelf can't fetch, such as pages that need your sign-in. **Dismiss** forgets it. Programs, scripts and disk images ask you to confirm the warning first. Disguised programs (such as `invoice.pdf.exe`), programs over unencrypted HTTP and links through listed sites are blocked and can't be downloaded from the review.

If Ravenshelf is closed or doesn't answer, the browser downloads as usual. Unencrypted (HTTP) downloads that are not programs also stay with the browser. Downloads in private windows are never sent to Ravenshelf. Reviews you don't act on expire after an hour.

Right-click a link and choose **Download with Ravenshelf** to send it directly. On a FuckingFast, FileKeeper or DataNodes page, the page's right-click menu and the toolbar button offer **Download this file with Ravenshelf**.

### Blocking in the browser

Ravenshelf downloads four public lists of dangerous sites, about 261,000 entries, and gives them to the browser as its own blocking rules. They refresh every 12 hours, or when you choose **Update lists now**. Opening a listed site, or loading anything from one, is blocked; Ravenshelf's page explains why, with **Go back** and **Close tab**. Blocking keeps working while Ravenshelf is closed, with the lists from the last time it ran. Listed IP addresses are checked by Ravenshelf itself rather than by the browser.

On FuckingFast and FileKeeper pages, the page can't send you to another site. A redirect puts the download page back, pop-ups are closed (including blank ones the page fills with ads), and an ad frame that takes over the tab is undone. Opening a site yourself, by typing its address or from a bookmark, is never blocked by this rule.

The toolbar button shows whether Ravenshelf is connected. It lets you turn each protection and each extra (the YouTube button, sorting Nexus Mods files by game) off, or pause both protections for 10 minutes.

### VirusTotal (optional)

Paste your own free VirusTotal API key under **Settings → Browser extension**. Ravenshelf then looks up the sites a browser download comes from (up to three per download), and the SHA-256 fingerprint of each finished browser download. Results appear in the review and on the download's card, with **View report**. If two or more security vendors flag a finished file, Ravenshelf also shows a notice. Only site names and fingerprints are sent, never your files or full web addresses. The key is sealed with Windows protected storage and never shown again. Free keys allow 4 lookups a minute and 500 a day; at the limit, Ravenshelf skips the rest instead of waiting. VirusTotal's terms apply to your key.

### Limits

- The extension handles files the browser downloads (including [mod files from Nexus Mods](#nexus-mods-downloads)), and [YouTube videos](#youtube-downloads) you send with its button or menu. It does not save videos from other sites.
- Checks and lists reduce risk; none of them proves a file or site is safe. Keep Windows protections and Microsoft Defender scans on.
- Sites that need your browser sign-in can only be downloaded with **Download in browser instead**, because Ravenshelf never uses your browser cookies.
- The extension is loaded in Developer mode (Chrome, Edge, Brave) or as a temporary add-on (Firefox) because it isn't published in the browser stores yet. Chrome may remind you about developer-mode extensions.
- Malwarebytes and other security apps can't be connected to Ravenshelf. They keep protecting your PC on their own.

## Nexus Mods downloads

With the [browser extension](#browser-extension) connected, Ravenshelf recognises the files you download on Nexus Mods. Download the way you always do: open the mod's **Files** tab, choose **Manual download**, then press Nexus Mods' own download button. When the browser starts the download, Ravenshelf takes it over like any other browser download and checks it. Its review shows **Nexus Mods file** with the mod and the game, and the folder the file will go to. Choose **Download** and the file is saved in `Mods\<game>` inside your download folder, for example `Mods\Skyrim Special Edition`. The **Downloads** page shows the mod's and the game's names under the file.

- Mod files download over **one connection**, whatever **Connections per file** says. Ravenshelf does not try to get around the site's limits.
- The waiting time and the sign-in on Nexus Mods are the site's own; nothing is skipped. Ravenshelf never uses your Nexus Mods account, an API key or your browser cookies.
- Nexus Mods' download links stop working after a while, and a mod download that fails for that reason says so. Start the download again from the mod's page: a failed or cancelled entry for the same file takes the new link and tries again. A paused entry does not take a new link, also after Ravenshelf restarts: choose **Resume** first, and if it then fails, start the download again from the mod's page. A cancelled mod download keeps no link, so **Resume** and **Retry** only tell you to start it again from the mod's page. What it had already downloaded is kept when Nexus Mods' server allows it.
- A mod file that is already in your **Downloads** list is not added a second time, however often you press the download button: a download counts as the same file when it has the same path on Nexus Mods' file servers and the same name, and goes to the same game's folder.
- **Mod manager download** buttons (for Vortex and other mod managers) are not handled by Ravenshelf.
- Only files that come from Nexus Mods' file servers (nexus-cdn.com), for a download that began on Nexus Mods, are treated as mod files. A file kept on another site, or one that another site sends on to those file servers, is an ordinary browser download, even when a Nexus Mods page links to it. If a mod file's download is sent on to another site while it downloads, Ravenshelf stops it.
- If Ravenshelf can't tell which mod a download belongs to (for example, when two open mod pages offer a file with the same name), the file is treated like any other browser download and saved in **Browser downloads**.
- Ravenshelf downloads mod files. It does not install them, put them in load order or check them against your games; use a mod manager or the mod's own instructions.
- Only download mods you are allowed to use, and follow Nexus Mods' rules and each mod's permissions.
- The toolbar button's **Sort Nexus Mods files by game** switch turns this off. In Firefox, if mod files are not recognised, allow Ravenshelf on www.nexusmods.com from Firefox's extensions menu. After updating Ravenshelf, choose **Reload** for Ravenshelf on the browser's extensions page, then reload open Nexus Mods tabs.

### The Mods page

**Mods** lists the mod files in your **Downloads** list that Ravenshelf recognised as Nexus Mods files, grouped by game, newest first within each game. Each shows the mod's name, the file, its state and its size. Type in **Find a mod, file or game…** to narrow the list.

- **Mod page** opens the mod's page on Nexus Mods in your own browser. Its address is made only from the game and mod number saved with the download; Ravenshelf itself never contacts Nexus Mods.
- **Show file**, for a finished file, opens the folder that holds it. **See in Downloads**, for any other, opens the **Downloads** page, where you can resume or retry it.
- **Open Mods folder** opens `Mods` in your download folder.

The page shows only what is in your **Downloads** list: an entry you remove there leaves this page too, and its file stays on disk unless you chose **Delete files**. Mod files downloaded with 0.7.0 that are still in the list appear here as well.

### Privacy on Nexus Mods

On www.nexusmods.com the extension only reads the tab's address and what the open page says about itself: the game, the mod's name and number, the page's address as the page states it and, on a file's page, the file's name and number. It also notices that you clicked or pressed Enter or Space (not what), and whether the tab is visible. It adds nothing to the page, presses nothing and makes no requests. What it reads stays in the browser's memory. It is forgotten when the tab closes or leaves Nexus Mods, and it is not used after half an hour. It goes to Ravenshelf on your PC only together with a download that you start and that comes from Nexus Mods' file servers. Nexus Mods pages in private windows are never read.

A Nexus Mods download link carries a short-lived signature and can include your Nexus Mods account number. For a file recognised as a mod file, Ravenshelf keeps the link on your PC while the download is waiting or unfinished, because it needs it to continue. Once the file has finished or you cancel it, only the plain address of the file is kept. A file from Nexus Mods that was not recognised is an ordinary browser download and keeps its link until you remove its entry.

## YouTube downloads

Ravenshelf can download a YouTube video you choose: with the **Ravenshelf button** in YouTube's player, next to subtitles and settings, or by right-clicking a video link or a video page and choosing **Download with Ravenshelf**. On the video itself YouTube shows its own menu first; right-click again for the browser's menu. This needs the [browser extension](#browser-extension) connected. After updating Ravenshelf, choose **Reload** for Ravenshelf on the browser's extensions page, then reload your YouTube tabs.

### One-time setup

YouTube downloads use three free helper programs: **yt-dlp** downloads the video, **Deno** is a JavaScript runtime yt-dlp needs for YouTube, and **FFmpeg** joins the video and audio. The first time you send a video, Ravenshelf opens **Set up YouTube downloads**; you can also start it from **Settings → YouTube downloads**. Setup downloads about 168 MB once, from each program's official GitHub release at a fixed version, and stores about 310 MB in `%LOCALAPPDATA%\Ravenshelf\media-tools`. It downloads in 2 MB parts over up to eight connections and replaces a connection that is far slower than the others, so a few slow GitHub download servers don't hold it up. Every part must be exactly the part requested, and every file must match the size and SHA-256 recorded in Ravenshelf, or nothing is installed. The programs are checked again before their first use each time Ravenshelf starts. The video you sent starts as soon as setup finishes. **Remove helper programs** deletes them again.

### Choosing a quality

The player button opens a menu: **Best quality** (up to 4K), **1080p**, **720p**, **480p**, or audio only as **M4A** (original quality) or **MP3** (plays everywhere). Right-click downloads use the quality chosen in **Settings → YouTube downloads**, 1080p unless you change it. Videos are saved as MP4. Files go to the **YouTube** folder in your download folder, named after the video's title. Ravenshelf prefers YouTube's HLS streams, for the video and for the audio, and downloads eight parts at a time, which is usually much faster: YouTube can slow its single-file streams to a few hundred KB/s or less. With a limit in **Settings → Shared download speed**, the parts download one at a time so the limit holds.

The video appears in **Downloads** straight away, with its title once Ravenshelf has read it. You can pause, resume, cancel or remove it like any download, and a paused video continues where it stopped. Finished files keep Windows' internet-zone mark and are scanned by Microsoft Defender when scans are on. The toolbar button's **YouTube download button** switch hides the player button; right-click still works.

### Privacy

Only the video's ID and your quality choice go from the browser to Ravenshelf. yt-dlp then contacts YouTube from your PC, as watching the video does, without your browser cookies or YouTube sign-in, and without configuration files or plugins. Nothing about YouTube videos is sent to VirusTotal.

### Rules and limits

- Only download videos you own, that use a Creative Commons licence, or that you have permission to save. YouTube's terms allow downloading only where YouTube offers it or with permission.
- Because Ravenshelf doesn't use your sign-in, age-restricted, members-only and private videos can't be downloaded. Live streams and premieres can be downloaded after they end.
- A link from a playlist downloads only that video.
- The button hides in small players such as the miniplayer; right-click works there.
- YouTube changes often. If downloads start failing, update Ravenshelf: each version brings the yt-dlp it was tested with. The helper programs never update themselves.
- In Firefox, if the button doesn't appear, allow Ravenshelf on www.youtube.com from Firefox's extensions menu.
- The Chrome Web Store doesn't allow YouTube downloaders, so this extension can't be published there. Loading it from Ravenshelf's folder is not affected.

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

## See your PC's specs

Choose **PC specs** to see what is inside this PC: the processor (cores, threads and clock speed), each graphics adapter, the memory, the drives with their free space, the display and the Windows version. Ravenshelf asks Windows the first time you open the page (or choose **Compare with this PC** in a game's details) after starting, which usually takes a few seconds; it gives up after 20 seconds. Until you close Ravenshelf, opening the page again shows that answer. **Check again** reads everything afresh.

- With more than one graphics adapter, **Main** marks the one games normally use: one that works before one with a problem, then a separate graphics card, then the one with the most memory of its own.
- **Graphics memory** is memory of the adapter's own, read from what DirectX recorded or, if that is missing, from the graphics driver or Windows, so cards with more than 4 GB show their real size. Adapters recognised as built-in graphics show **Shares system memory** instead. When Windows gives no figure that can be trusted, the page says **Not reported by Windows** rather than guessing.
- **Type** (**Graphics card** or **Built-in graphics**) appears when Windows says which adapter is which (on PCs that have both), and for NVIDIA and Intel adapters whose memory makes it clear. Otherwise it is left out, for example for AMD adapters, because AMD makes both kinds with every amount of memory.
- **Supports** shows the DirectX version the adapter and its driver offer, with the feature level when Windows names it, for example **DirectX 12 (feature level 12.1)**. It is left out for an adapter that Windows reports a problem with. A particular game can still need features or speed that the adapter lacks.
- The memory card's title shows the memory installed, the sum of the memory modules. **Usable by Windows** can be lower, for example when built-in graphics keep some for themselves.
- A drive is marked **low on space** when less than a tenth of it, and less than 50 GB, is free.
- If no graphics driver works at all, the page says Windows is using its basic display driver. An adapter that Windows reports a problem with is listed with a warning. A second adapter on the basic display driver is not listed while another one works, and the page says so. Install or repair the graphics driver, then check again.

Nothing on this page leaves your PC. It is not saved to a file, not sent to any site and not shared with the browser extension, and Ravenshelf never asks Windows for serial numbers, the computer's name or user names. A game's details can compare these specs with its requirement lists; see [Can you run it?](#can-you-run-it).

## Watch gameplay and open guides

**Watch gameplay** opens YouTube search results in a separate viewer. Choose the video you want; search results are not verified gameplay clips. Use **YouTube in browser** if the viewer cannot play a video. YouTube ads are not guaranteed to be blocked.

Guide buttons open labeled PCGamingWiki, YouTube walkthrough or Steam community searches. Where an exact Steam app ID is known, Ravenshelf can link directly to that game's Steam pages. Results are not individually vetted guides.

## Choose what happens when downloads finish

Under **Downloads → When this queue finishes**, choose **Keep Ravenshelf open**, **Close Ravenshelf** or **Turn off laptop**.

The default is **Keep Ravenshelf open** each time the app launches. Shutdown requires confirmation. Both close and shutdown wait for successful transfers and any requested Defender scans, then show a 60-second countdown with **Cancel — keep working**. Queued or running scans keep the action waiting. A threat, uncertain result, failed scan, missing file or unavailable scanner blocks the action. Review the result and scan again after resolving it, or choose **Keep Ravenshelf open**. Turning off future automatic scans does not bypass a scan already recorded for a file. Files for which no scan was requested do not acquire a new scan just because a finish action is selected.

Readiness is checked again before the final action, including scans started during the countdown. Save work in other apps before permitting shutdown.

Paused or failed files keep the action waiting. New files join an armed queue; adding work during the countdown returns it to waiting. Cancelling a targeted file cancels the finish action. Restarting Ravenshelf resets the choice. These actions concern downloads, not extraction or installation. Windows may delay shutdown if other apps need attention.

## Local data and troubleshooting

The app normally stores its profile under `%APPDATA%\atlas-repack-library` (the folder keeps its original name so updates from Atlas Library keep your data). It contains preferences, library entries, installed-game scan results, queue data and separate host-browser session data. With the browser extension connected it also holds `browser-host` (the connector and its browser manifests), `browser-extension` (the folders your browsers load), `threat-lists` (the downloaded protection lists) and `virustotal.json` (your sealed VirusTotal key and options). Download files use the folder selected in **Settings**. The YouTube helper programs are kept separately in `%LOCALAPPDATA%\Ravenshelf\media-tools`, with yt-dlp's cache and temporary folders; a temporary folder is removed when its download ends.

Close Ravenshelf before backing up its profile. Treat this backup as private: saved paths, URLs and host-session information can be sensitive. Do not attach the profile, `library.json`, cookies or signed download URLs to a public issue.

If Windows cannot encrypt saved download headers, Ravenshelf displays a warning and keeps those headers in memory only. The queue and partial files remain saved. After restart, affected downloads refresh their source links before resuming and may need another protected-browser step. Nexus Mods files are never looked up again: they continue at their own link, without the page address. Version 0.3.1 removes plaintext headers from the current older queue file; it does not rewrite previous backups.

Read the [privacy notes](PRIVACY.md) for data flows and IP visibility. Catalogue, image and download services still see the IP used to connect; Ravenshelf's ad protections do not make those requests anonymous.

| Problem | Next step |
| --- | --- |
| A link needs verification | Use its protected host button, then check the links again. |
| A link is not found | Check the source page for replacements or choose another complete mirror. |
| A host returns a webpage instead of a file | Complete the browser step or choose another mirror; do not treat the page as an archive. |
| A ready link still has no size | The host did not provide a reliable total, even after the small follow-up check. Downloading can start, but the total may remain unknown. |
| Download is slow or unstable | Try fewer simultaneous files, then compare 1 and 4 connections. Host limits may still apply. |
| Downloads are waiting at certain times | Check Download hours, the laptop's clock and the schedule status in Downloads. |
| Cleanup was cancelled but a transfer is paused | Resume it in Downloads; the preview pauses active files for review. |
| Check space shows less than expected | Expand missing files and other archives, and read any partial-check warning. Check the configured download folder; broad folders and unsupported files are not included in archive discovery. |
| A checksum check finished with mismatches | Verify that the manifest and chosen folder belong together; review missing/error rows and reacquire damaged files from your intended source. |
| App update is unavailable | Use the packaged Windows portable release, or update manually from Releases. |
| An update could not be verified or downloaded | Your current app is unchanged. Choose **Check for updates** and try again later, or download the release manually and verify it as described in the README. |
| A partial download cannot resume | Read the per-file error. The remote file or direct URL may have changed. |
| A header-storage warning appears | Headers were not saved in plaintext. Keep the current session open if needed; after restart, resume or recheck the source link and complete any requested browser verification. |
| Automatic close or shutdown is waiting | Check download cards for queued/running scans or results needing review. Resolve the result and scan again, or choose **Keep Ravenshelf open**. |
| Catalogue update fails | Keep the current results and retry Refresh later. Source changes can require an app update. |
| The app still shows old behavior after updating | Close all older Ravenshelf windows, then open the new release executable. |
| The browser extension says it is not connected | In **Settings → Browser extension**, check that **Connect the browser extension** is on and Ravenshelf is open. Open Ravenshelf normally, not with **Run as administrator**: Windows stops the browser from reaching an app running as administrator. If it says the extension isn't the one Ravenshelf set up, load the folder from **Open folder** again. |
| A download went to the browser instead of Ravenshelf | Ravenshelf was closed or didn't answer in time, the download was unencrypted (HTTP), or it came from a private window. Check the toolbar button's status. |
| A site you need is blocked | Check the address. If you trust it, pause protection for 10 minutes from the toolbar button, or turn off **Block dangerous sites**. |
| The Ravenshelf button doesn't appear on YouTube | After updating Ravenshelf, choose **Reload** for Ravenshelf on the browser's extensions page and reload the YouTube tab. Check the toolbar button's **YouTube download button** switch. The button hides in small players; right-click still works. |
| A YouTube video fails | Read the message on its card: private, members-only, age-restricted and region-locked videos can't be downloaded. If many videos fail, update Ravenshelf for a newer yt-dlp. |
| The YouTube helper programs are damaged | Choose **Set up again** in **Settings → YouTube downloads**. Ravenshelf downloads and checks them again. |
| A Nexus Mods file went to **Browser downloads** instead of **Mods** | After updating Ravenshelf, choose **Reload** for Ravenshelf on the browser's extensions page and reload the Nexus Mods tab. Check the toolbar button's **Sort Nexus Mods files by game** switch. Start the download from the file's own page (**Manual download**). In Firefox, allow Ravenshelf on www.nexusmods.com from Firefox's extensions menu. A file that a mod's page links to on another site is not a Nexus Mods file. |
| A mod download stopped and won't resume | Nexus Mods' download links expire. Start the download again from the mod's page; a failed or cancelled entry takes the new link and tries again. If the entry is paused, choose **Resume** first. |
| Some text is still in English after choosing Arabic | Text from websites stays as the site wrote it. The browser extension changes language the next time it talks to Ravenshelf: open its toolbar menu. |
| **PC specs** shows only the basics | Windows did not answer the full hardware check (some workplace PCs restrict it). Choose **Check again**. Processor and memory are still shown. |
| **PC specs** shows no graphics card, or misses one | No graphics driver works, or the missing adapter is on Windows' basic display driver; the page says which. Install the driver from the maker of the PC or the graphics card, then choose **Check again**. An adapter with a broken driver is listed with a warning. |

For a reproducible app problem, see [CONTRIBUTING.md](../CONTRIBUTING.md) before opening an issue.
