# Ravenshelf 0.10.3 — Background mode and browser saves

This update adds a choice to keep Ravenshelf running in the background, sends more browser saves to Ravenshelf for review, and fixes problems found in independent reviews. Settings, collections, queues and download folders stay as they are. To update, open **Settings → Ravenshelf updates** and choose **Download and install**, or download `Ravenshelf-0.10.3-Windows.exe` from this release. After updating, choose **Reload** for Ravenshelf on your browser's extensions page.

## Closing and background mode

Closing the window now asks whether to **Keep running in background**, **Exit Ravenshelf**, or **Cancel**. Tick **Remember my choice** to save a preference, or change **Settings → When I close the window** later. Background mode adds a tray icon before hiding the window; use it to reopen Ravenshelf or exit fully.

- Downloads and the services you turned on keep running while the app is hidden and the PC is awake. Background mode does not start Ravenshelf with Windows, keep a sleeping PC awake, or turn on services you had turned off.
- A minimized window comes back before the close question opens, so the question is never hidden. If the tray icon can't be created or can't be loaded, or a remembered choice can't be saved, the window stays open.
- A full exit pauses unfinished work and stops the app's services. If that takes longer than about 45 seconds, Ravenshelf exits anyway, saves the download list, and does not install a waiting update. A notice (if desktop notifications are on) says the update was not installed; check for updates again after reopening. Work still running at that point, such as deleting a large folder, may be left half done.
- An update still downloads only after **Download and install** and must pass the signed-record and file checks. A verified, approved update installs on a full exit or **Restart now**, never merely because the window was hidden, and never after a failed cleanup.

## Browser saves

With the extension connected and **Send downloads to Ravenshelf** on, ordinary Save image, video, audio and file downloads are handed to Ravenshelf for review. Right-click a direct image, video file or audio file to send that file. YouTube keeps its own video menu.

- The browser's download is cancelled only after Ravenshelf accepts the review (or for a security block). A save that already finished is kept in the browser. If Ravenshelf is exited, doesn't answer, refuses, or has a full review list, the browser keeps the download. Your own pause, cancel or resume always wins over a late answer.
- **Firefox:** a new download is paused while Ravenshelf decides, and resumed if Ravenshelf leaves it to the browser. Firefox reports that pause as "interrupted", and Ravenshelf now recognises its own pause. For a server that can't resume, Firefox throws away what was downloaded when it pauses; Ravenshelf is still asked, and if it leaves the file to the browser, a notice asks you to choose **Retry** in Firefox's downloads list. Downloads from that site are then not paused for 10 minutes; they are still checked while they run.
- **Chrome, Edge and Brave:** Ravenshelf waits up to a second for the browser to report the file's real name before deciding, so a program named only by the server is checked like any other file.
- A link Ravenshelf's file check already blocked stays blocked when it comes again, even when the review list is full. An unencrypted (HTTP) download whose name the browser didn't report is stopped.
- Automatic captures keep a background window hidden and show a notification instead. With desktop notifications off, the window opens, so a handed-over download never seems to vanish.
- Acceptance means **waiting for review**, not a finished or proven-safe download. Choose **Download** in Ravenshelf after checking the result. Programs, scripts and disk images keep their confirmation step.

Browser review cards are kept in memory only: queue the files you want before a full exit. No new extension permissions, page scraping, browser cookies, dependencies or telemetry were added. Private windows, local addresses and addresses with a user name or password are never sent. Files a web page builds itself (`blob:` and `data:`) stay in the browser, except programs, which are still blocked. Protected streams and downloads that need your sign-in may need the browser. A very small file can finish before it can be caught.

## Saved list, settings and torrent fixes

- Unfinished jobs above 10,000 are all kept and can resume; new downloads are refused while the list is at its limit. Trimming old history is now treated as upkeep: no "damaged" warning and no new recovery copy at each start. The oldest finished files go first and cancelled downloads (which can still be retried) last; files still waiting for a Defender scan, or that Defender flagged, are kept.
- A list too large to be read back (over 128 MB) is never written. The previous file stays, the window explains what to do, and nothing new is added until it fits again.
- When settings can't be saved (a read-only list), you can still turn off clipboard watching, automatic update checks, notifications, the browser connector and torrents; the change lasts until restart. Turning things on, and other settings such as Defender scanning, still need a list that can be saved.
- A missing profile folder uses one checked destination even if a junction changes during recovery. Reused recovery copies are checked again after reading. A damaged favourite, shelf or shelf game drops only that item. A failed settings write puts the old settings back before changing bandwidth or the schedule.
- Exit stops new browser handoffs at once and nothing new joins the list after that. Late folder-picker results and torrent reviews can't change the queue after exit starts.
- Torrent tracker lookups: one cancelled caller no longer cancels another caller waiting for the same tracker, and waiting lookups are limited. This is not a VPN kill switch; aria2 makes its own connections and people sharing a torrent can see your IP address.

## Checks

- **Automated tests:** 1,222 tests. On Linux 1,183 passed, 0 failed, and 39 Windows-only tests were skipped. GitHub's Windows test run, code scanning and source-signature checks run before release.
- **Independent reviews:** three reviews of the candidate (app lifecycle; browser capture; saved list, queue and torrents) and two reviews of the fixes; their findings were fixed too. Each fix comes with tests, and spot checks confirmed those tests fail without the fix.
- **Real Chrome test:** Chrome 153 with the real extension and Ravenshelf's real browser connector, in an isolated test profile with local test sites only. 27 of 29 checks passed: single handoff, block of disguised programs, browser keeps the file when Ravenshelf is closed or leaves it, HTTP and local addresses, slow answers, user cancel, timeouts, right-click image/video/audio, and no local or credential address ever reaching the app. The 2 checks for files a page builds itself could not run, because that headless Chrome doesn't download such files even without the extension; they are covered by automated tests.
- **Firefox:** no Firefox was available in the test machine. The Firefox build passed Mozilla's `web-ext lint` with no errors, and the automated tests now simulate Firefox's real pause behaviour.
- **Not tested by hand:** real Firefox, the tray in a real Windows desktop, and installing this update over 0.10.2. The published file's checksum and signed build record are verified after publishing.

Passing these checks can't guarantee there are no bugs, or that a downloaded file is safe.
