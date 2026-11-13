# Ravenshelf 0.10.4 — Game pictures

This update changes how game pictures load in the catalogue, after a report that pictures stop appearing after browsing about 8 pages. The cause has not been confirmed yet, so these are **improvements under test, not a confirmed fix**. A new **Settings → Picture loading** summary helps narrow down what happens if pictures still go missing. Settings, collections, queues and download folders stay as they are. To update, open **Settings → Ravenshelf updates** and choose **Download and install**, or download `Ravenshelf-0.10.4-Windows.exe` from this release. The browser extension did not change.

## How pictures load now

- **Pictures of pages you left are cancelled.** Electron, which Ravenshelf is built on, never told Ravenshelf when a picture left the page, so in earlier versions every picture of every page you passed kept downloading, competing with the pictures of the page you were on. Now the window reports pictures that left the page (by a request number, not an address), and their requests are cancelled: card pictures, game-page covers and screenshots, and an enlarged picture you move away from or close. Two cards that need the same picture share one request, and it is cancelled only when no card needs it any more.
- **At most 4 picture requests to one site at a time.** The others wait their turn, in order.
- **"Too many requests" pauses that site.** When a site answers 429, or 503 with a Retry-After time, Ravenshelf sends that site no picture requests for as long as it asks (at least 5 seconds, at most 10 minutes, 60 seconds if it doesn't say). Pictures from that site, alternatives included, wait for the pause to end and then load, instead of being given up at once. Other sites are not affected.
- **No picture waits for ever.** A picture waits at most 90 seconds for its turn. If a site's pause is longer than that, its pictures are given up straight away. Each request then has at most 15 seconds once it starts.
- **Fallback without endless retries.** A card tries at most 3 pictures, one after another, then shows the placeholder. When a game's cover is on imageban.ru (whose picture servers did not resolve when checked in November 2026), the card tries the post's small screenshot thumbnails first. A favourite saved with a full-size RiotPixels picture also tries that picture's small version first. The game page still shows full-size pictures. A picture that failed is skipped for 2 minutes; opening the page again after that tries it again.
- **Pictures kept in memory.** Pictures already loaded are kept in memory, so going back to a page shouldn't download them again. The limit is 40 MB of downloaded picture data (at most 400 pictures, each at most 4 MB); the oldest are dropped first, and every picture is dropped after 30 minutes. Nothing is written to disk, and the memory is cleared when Ravenshelf closes. This limit counts downloaded bytes only. It does not cap Ravenshelf's total memory use: pictures shown on screen use more memory than their files.

## Picture loading summary

Open **Settings → Picture loading** and choose **Show picture loading**. For this session, it shows per site:

- requests sent, pictures loaded, and pictures taken from memory;
- pictures cancelled because you left the page (counted separately; these are not failures);
- each kind of failure: not found (404), refused (401/403), too many requests (429), site error (5xx), other reply, timed out, site name not found (DNS), connection failed, not a picture, too large, incomplete, and blocked for safety;
- pictures skipped while a site was paused, that waited too long for a turn, or that failed a moment ago.

It also shows how many pictures failed and then loaded later or are still failing, after how many loaded pictures the first failure happened, which sites are paused now, and what this window did with card and cover pictures (shown, switched to another picture, placeholders).

The summary has only site names and counts: no picture addresses, game names or browsing history. It lists at most 30 sites, then "Other sites" (paused sites too). It stays in memory, is never saved or sent, and resets when Ravenshelf closes.

If pictures still stop loading: browse until it happens, then open the summary. Many timeouts, 429 or DNS failures for one site point to a problem with that site. Placeholders in this window without matching failures, or cards that stay blank while few requests are sent, point to a problem in Ravenshelf itself. You can share these numbers, since they contain no addresses.

## Unchanged protections

Picture requests keep the same checks: HTTPS only, no private or local addresses (also after redirects), no browser cookies or referrers, a picture type and file signature that must match (PNG, JPEG, GIF or WebP; no SVG or HTML), and at most 12 MiB per picture. Image hosts still see the IP address used to connect.

## Checks

- **Automated tests:** 1,249 tests. On Linux 1,210 passed, 0 failed, and 39 Windows-only tests were skipped. New tests cover shared requests, cancelling by request number, the per-site limit, pauses (including how Retry-After is read), the 90-second wait limit, the memory cache with its limits and expiry, the failure memory, the summary's limits and privacy, a 25-page browsing simulation, and the window's numbering and fallback. Spot checks with deliberately broken code confirmed the tests catch each change. GitHub's Windows test run, code scanning and source-signature checks run before release.
- **Independent reviews:** three reviews of the first version and three of the fixes; their findings were fixed. A test in real Electron showed that Electron 45 never reports a picture leaving the page, so cancelling was rebuilt around request numbers.
- **The real app on a simulated internet:** the real app (Electron 45) browsed a fake catalogue with fake picture sites (no real site was contacted): 25 pages forward, 10 back and 10 forward again, many of them changed within a fraction of a second, then revisits after a pause; plus runs of 124 and 244 page visits. Compared with 0.10.3 on the same fake sites, counting the pages where the test waited for pictures:
  - A site that limits requests (429, then a 20-second pause): 0.10.3 showed 40 of 130 pictures (90 placeholders); 0.10.4 showed 130 of 130.
  - Missing pictures: 0.10.4 showed 111 of 130 by falling back to another picture (the other 19 games had no picture at all); 0.10.3 showed 91.
  - A slow site: pictures taking over 5 seconds fell from 123 to 26, and requests left waiting from up to 42 to up to 18.
  - Revisited pages were answered from memory.
  - Memory levelled off: the window's memory stayed at about 630 MB from about the 130th page visit through the 244th; 0.10.3 levelled off at about 690 MB within 20 visits. The app's own picture cache stays under its 40 MB limit.
  - No request left the fake internet, and the window never stopped responding. The existing automated tests confirm that unsafe addresses and redirects are still refused.
- **Not tested:** the real catalogue and picture sites, your PC and network, and Windows itself. The original problem has not been reproduced with the real sites, so this is not a confirmed fix. The **Picture loading** summary is there to show what happens on your PC.

Passing these checks can't guarantee there are no bugs, or that the original problem is fixed.
