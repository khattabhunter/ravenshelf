# Changelog

## 0.2.4

### Protection

- Cover images now use a restricted app loader with public-address validation at the socket and on redirects. The renderer can no longer load arbitrary remote images directly.
- Image responses have byte/time limits and must contain a supported raster format; HTML and SVG responses are rejected.
- Cover requests do not forward browser-session cookies, credentials or referrers.
- Added a privacy guide describing public source, local profile storage and the IP visibility of normal network connections.

## 0.2.3

### Fixed

- FuckingFast link checks now use an isolated Chromium session for supported host pages and form responses. File checks and transfers retain the existing guarded network path.
- Passive Cloudflare scripts no longer cause valid download pages to be mistaken for active verification challenges.
- Download controls are matched to the selected file rather than taking the first unrelated form control.
- Filename parsing handles extended encodings and rejects malformed explicit names. Hosts that reject HEAD checks can receive a limited GET check.
- Link results distinguish browser steps, missing files and other failures. Added **Check links again** and protection against stale check results replacing newer results.

### Protection

- Browser-session requests are restricted to supported host paths and validated redirects.
- Session cookies stay in the main process rather than being returned to the renderer in link-check results.
- Availability checks do not click advertisements or execute the host page's scripts.

## 0.2.2

### Added

- Select 1, up to 2 or up to 4 connections per file; up to 4 is the default.
- Validated parallel downloads for large files, durable section checkpoints and automatic fallback to one connection.
- Download-card connection counts and fallback explanations.
- Support for hosts with valid open-ended ranges even when their bounded-range headers are inconsistent.

### Protection

- Workers settle before fallback or publication, and completed destinations are not overwritten.
- Older partial files retain their existing single-connection resume path.
- FuckingFast captures check archive filenames and download endpoints, and reject unrelated redirects and unexpected file types.

## 0.2.1

### Added

- Automatic newest-catalogue refresh at startup and every five minutes while the app is open, including when minimized.
- Overdue checks when returning to the app or waking the laptop.
- Last-check status and preservation of catalogue results when a request fails.

### Improved

- Background updates preserve the selected search, genre, page, scroll and focus, and wait while another view or dialog is open.
- Manual refresh bypasses the catalogue cache; overlapping requests are coalesced.

## Earlier preview foundation

The initial previews introduced the visual catalogue, source-based genre sections, Favorites and collections, batch downloads, protected host windows, installed-game metadata scanning, gameplay/guide links and optional completion actions.
