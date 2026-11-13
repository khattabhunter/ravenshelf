'use strict';
// Fixed messages about torrent downloads, shared by the queue, the settings and
// the error boundary.
const TORRENT_SETUP='Turn on torrent downloads in Settings first, then retry.';
const TOOL_MESSAGES=Object.freeze({
  setup:'Set up torrent downloads in Settings first, then retry.',
  damaged:'The torrent downloader changed or is damaged. Set up torrent downloads again in Settings.',
  running:'The torrent downloader is being set up. Wait for setup to finish.',
  busy:'Pause your torrent downloads before removing the torrent downloader.',
  unsupported:'Torrent downloads are available in Ravenshelf on Windows.',
  failed:'The torrent downloader could not be downloaded or verified. Nothing was installed. Try again later.',
  cancelled:'Setup was cancelled. Nothing was installed.',
  unreadable:'The torrent downloader could not be checked right now. Try again in a moment.'
});
const MESSAGES=Object.freeze({
  off:TORRENT_SETUP,
  accept:'Read and accept what torrents share before turning them on.',
  stillActive:'Pause your torrent downloads before turning torrents off.',
  request:'This torrent request is no longer available. Open the magnet link again.',
  waiting:'Ravenshelf is still finding this torrent’s file list.',
  tooManyRequests:'Too many torrents are waiting to be checked. Close some first.',
  limit:'Choose an upload limit from the list.',
  share:'Choose how long to share after downloading from the list.',
  full:'Too many torrents are waiting. Let some finish first.',
  choose:'Choose at least one file of this torrent to download.'
});
module.exports={TORRENT_SETUP,TOOL_MESSAGES,MESSAGES};
