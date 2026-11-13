# Ravenshelf 0.10.1 — Privacy and recovery fixes

Unreleased. This change does not install an update or move the existing download folder. The published download remains 0.10.0 until release approval and the release checks succeed.

- **Less page information shared.** Browser handoffs keep only the page origin, while retaining the chosen file URL needed to download. Provider requests remove query strings and fragments from `Referer` and `HX-Current-URL`; redirects to another origin also remove their paths. Browser cookies are still not imported. Finished ordinary browser downloads discard their saved query tokens and request headers.
- **More reliable browser handoff.** A valid native-message request can arrive in one chunk or many without being mistaken for an oversized authentication header. Both frame limits and authentication checks remain enforced. The right-click menu now accepts images and uses the image URL; private windows and unsupported URL types remain excluded.
- **Saved-data recovery.** Validate the saved library before using its settings or queue entries. Keep valid entries and preserve damaged original data in an exclusive local recovery file before repairing it. A newer format, unsafe file or failed recovery copy prevents saving and starting downloads; the window explains the issue. Ordinary existing queues migrate without resetting settings or download paths.
- **Safer local files.** Reject Windows device aliases such as `con .txt` throughout storage checks, cleanup, checksum manifests and the native updater. New download names are made safe. Installed-game inspection uses only Windows' PowerShell module directory.
- **Torrent privacy and shutdown.** Strip untrusted trackers, web seeds and other outer metadata while retaining the exact info-hash bytes. Check tracker DNS answers before handing them to aria2. Bound startup/stop operations and confirm process termination before reusing the engine or publishing completed files. Preserve torrent metadata when the saved queue cannot establish ownership reliably.
- **Updated build dependencies.** Pin `@electron/asar` 4.3.2, `@electron/fuses` 2.1.3 and `js-yaml` 5.5.0. ASAR 4.3.2 includes the patched glob dependency; 4.3.1 is not adopted. Signed-source requirements and the updater's signed-build verification remain in place.

After installing this version, reload the Ravenshelf browser extension on the browser's extensions page to activate its changes.

## Limits

Tracker DNS checks happen before aria2's independent networking; they are not a VPN kill switch or socket-level protection against later DNS changes, tracker redirects or discovered private peers. Torrents still expose the connection IP to peers and trackers. Firefox can write initial temporary bytes before its download-created event lets the extension pause a download. Active signed download URLs are retained to support resume. Recovery files may contain private URLs, paths or old credentials: keep them local and never attach them to a public issue.

Validation results are recorded in the pull request after the full Windows test suite, dependency checks and actual packaging checks complete. Tests use isolated fixtures, not the installed app's settings or download files.
