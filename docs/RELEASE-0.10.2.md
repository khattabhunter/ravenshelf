# Ravenshelf 0.10.2 — Saved-list and torrent fixes

This update fixes problems found in an independent review of 0.10.1. Settings, collections, queues and download folders stay as they are. To update, open **Settings → Ravenshelf updates** and choose **Download and install**, or download `Ravenshelf-0.10.2-Windows.exe` from this release.

- **Profiles reached through a junction or link** (for example AppData moved to another drive) open normally again. 0.10.1 showed an empty, read-only list for them. The real profile folder is found once, checked as before, and saved to; a `library.json` that is itself a link or a hard link is still refused.
- **A list briefly held by antivirus, backup or sync software** is read after a short wait instead of being treated as unreadable.
- **Very long lists are kept.** More than 10,000 saved downloads no longer blocks the whole list: every unfinished download and the newest finished ones are kept, and the original stays in a recovery copy. Lists up to 128 MB are read. A full list refuses new downloads with a message.
- **Recovery copies stay few.** A repaired list is saved at once, the same damage is copied only once, and at most 5 `library.json.recovery-….json` copies are kept (the oldest and the newest four). One damaged favourite, shelf, shelf game or game folder drops only that item; an invalid Nexus Mods label drops only the label, and a finished or cancelled download that had one keeps no signed link.
- **Folders.** WSL and WebDAV download folders are accepted. **Add game folder** refuses a whole drive, a network folder or a name Windows would change when you choose one, and a scan skips a whole drive saved by an older version with a note.
- **Read-only lists explain themselves** when you try to add a download.
- **Torrent tracker check.** IPv4 answers only, through Windows' resolver, at most two lookups at a time and 3 seconds in all: lookups that hang can no longer slow other downloads' file access, and an IPv6 answer no longer drops a good tracker. Saved torrent file lists keep no trackers.
- **Torrent engine.** Stopping torrents while aria2 is starting ends that start; repeated failed starts stop after 3 tries; aria2 started for nobody still stops; a late aria2 exit clears a failed stop; a job of an aria2 that has gone never touches a newer one; a tracker name already being looked up is joined; a failed download keeps its own error message, and the file-list search folder is always removed.
- **`CONIN$` and `CONOUT$`** count as Windows device names in the app and the updater, on every Windows language.

After installing, reload the Ravenshelf browser extension on your browser's extensions page.

## Limits

The tracker check still runs before aria2's own networking, and aria2's own lookups use its own DNS client; it is not a VPN kill switch, and torrents still show this PC's IP address to the people sharing them. Trackers not answered within 3 seconds are left out (the torrent still finds people through the other trackers and the DHT). Recovery copies can contain private paths and signed links: keep them local.

Validation: the full automated test suite with new tests for every fix, deliberate faults in the changed code (all caught by the tests), and independent reviews of the saved-list, torrent and security/privacy changes, every finding fixed with a test or listed here.
