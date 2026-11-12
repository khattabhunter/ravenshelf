'use strict';
const {MESSAGES:TOOL_MESSAGES}=require('./media-tools.cjs');
const {MESSAGES:MEDIA_MESSAGES}=require('./media-downloads.cjs');
const {LINK_EXPIRED_NOTE:MOD_LINK_EXPIRED,LINK_MOVED_NOTE:MOD_LINK_MOVED,LINK_DROPPED_NOTE:MOD_LINK_DROPPED}=require('./mods.cjs');

// Only developer-authored messages cross the main-process error boundary.
// Do not redact arbitrary exception text: paths, credentials and response data
// can appear anywhere in an OS, network, dependency or host-provided exception.
const MESSAGES=new Map([
  'Enter between 1 and 500 links.',
  'Invalid app request.',
  'The completion action has started. Wait before adding another download.',
  'Invalid gameplay link.',
  'Protected windows support FuckingFast, DataNodes and FileKeeper links.',
  'Off-site download blocked.',
  'Unexpected download type. Protected host capture accepts archive files; import other direct links explicitly.',
  'You can scan up to 20 custom game folders.',
  'Scan this game before opening its folder.',
  'The game folder no longer exists. Scan again.',
  'Paste is too large.',
  'Invalid download batch.',
  'Check these links before queuing them.',
  'Download not found.',
  'Unknown action.',
  'Choose whether to scan finished downloads.',
  'Choose 1, 2 or 4 connections per file.',
  'Choose on or off for this preference.',
  'Choose valid local download hours and weekdays.',
  'Choose a whole-number download limit of zero or more bytes per second.',
  'Choose between 1 and 500 downloads.',
  'Wait for these downloads and scans to stop before removing them.',
  'This download is being removed. Wait for the operation to finish.',
  'Pause active work before restarting for an update.',
  'Ravenshelf is closing. Wait for cleanup to finish.',
  'Wait for the current cleanup operation to finish.',
  'Check for updates first.',
  'Choose Download and install, and wait for the update to be verified first.',
  'Choose delete files or remove from list.',
  'The completion action has started. Wait before changing the queue.',
  'Archive parts are missing or inconsistent. Review the link set before downloading.',
  'The cleanup preview expired or changed. Make a new preview.',
  'These files changed or could not be checked safely. Make a new cleanup preview.',
  'Choose links from the detected-links tray.',
  'A checksum verification is already running.',
  'Choose a checksum manifest and its file folder.',
  'Text is too long.',
  'Open JDownloader 2 and enable Click’n’Load, then try again. You can also copy or export all links.',
  'Invalid web address.',
  'Only public HTTPS web addresses are supported.',
  'Only public HTTPS links are supported.',
  'Private network destination blocked.',
  'No compatible public address.',
  'Host returned a redirect without a destination.',
  'Too many host redirects.',
  'Blocked an unexpected download destination. FuckingFast files must use its HTTPS download servers.',
  'Blocked an unexpected download type. FuckingFast capture accepts archive files only.',
  'The selected FuckingFast link has an invalid file name.',
  'Blocked an unexpected file. Its name does not match the selected FuckingFast download.',
  'Blocked an off-site redirect from FuckingFast. Choose another link from the same host.',
  'Choose between 1 and 500 files.',
  'Only finished downloads can be scanned.',
  'Microsoft Defender scanning is not available.',
  'Saved sign-in details are unavailable. Check this download link again before resuming.',
  'The host stopped responding. Retry to resume.',
  'This link needs a browser check.',
  'Host ignored the uncompressed transfer request. Use another mirror to preserve reliable byte ranges.',
  'The host returned a web page instead of a file. Open the protected host.',
  'Host sent an invalid resume range. File was not modified.',
  'The host could not verify the saved file version. Cancel and queue it again.',
  'The file changed on the host. Cancel and queue it again.',
  'Host returned inconsistent range and file lengths.',
  'Host returned an invalid file length.',
  'The host did not return a downloadable file.',
  'Host sent more bytes than expected.',
  'Could not save download bytes.',
  'Transfer length did not match the requested range.',
  'Transfer ended early. Retry to resume.',
  'The host returned an empty file.',
  'The download file or folder changed or is unsafe. Choose a private download folder and retry.',
  'Saved download data is incomplete.',
  'Could not save download data.',
  'Some file sections are incomplete. Retry to resume.',
  'Choose keep open, close Ravenshelf, or turn off laptop.',
  'The completion action is already running.',
  'Add downloads before choosing an action. Completed history cannot trigger it.',
  'The completion action has already started.',
  'The queue changed; the completion action was stopped.',
  'Windows could not perform the shutdown request.',
  'System completion actions are disabled in this isolated test session.',
  'A scan detected a threat. Automatic close/shutdown is blocked. Review Windows Security and scan again after resolving it, or choose Keep Ravenshelf open.',
  'A scan needs review or did not finish successfully. Automatic close/shutdown is blocked. Review the result and scan again, or choose Keep Ravenshelf open.',
  'Waiting for Microsoft Defender scans to finish before starting the completion countdown.',
  'Choose one of the available catalog sections.',
  'The source no longer exposes its monthly popular list.',
  'The monthly popular list could not be read.',
  'The monthly popular list is unavailable.',
  'The newest catalogue page is temporarily unavailable.',
  'The newest catalogue page could not be read. Ravenshelf will try again.',
  'The catalogue response could not be read.',
  'The newest catalogue response did not contain any games. Ravenshelf will retry automatically.',
  'A game title is required.',
  'This page is not a recognizable game listing.',
  'Select a game page from fitgirl-repacks.site.',
  'The response exceeds the page size limit.',
  'Link is too long.',
  'Invalid paste key.',
  'Paste is unavailable or uses an unsupported format.',
  'Unsupported paste encryption settings.',
  'Invalid paste derivation settings.',
  'Burn-after-reading pastes must be opened manually in your browser.',
  'Invalid paste ciphertext size.',
  'Paste could not be decrypted. Its key may be incorrect, or it may require a password.',
  'The paste contains no text links.',
  'Paste up to 1 MB of links.',
  'A paste link needs its complete # decryption key.',
  'The host sent an invalid download filename.',
  'Only supported FuckingFast addresses may use this connection.',
  'Expected a FuckingFast file address.',
  'Unsupported FuckingFast request method.',
  'File addresses cannot receive form submissions.',
  'Blocked an unexpected FuckingFast page address.',
  'The host resolved to a private or unsupported network address.',
  'The host returned an unexpected file destination.',
  'The host returned a redirect without a destination.',
  'Blocked an unexpected FuckingFast redirect.',
  'Blocked an unexpected FuckingFast download destination.',
  'Blocked a form redirect to another origin.',
  'Too many FuckingFast redirects.',
  'The host redirected too many times.',
  'File not found or deleted.',
  'This is a web page, not a verified file download.',
  'The host did not return a verified file response.',
  'The host returned invalid file range information.',
  'FuckingFast requires a browser verification. Open the host, complete its check, and import the resulting direct download link.',
  'The host did not expose a supported direct file link. Open it in your browser.',
  'FileKeeper requires a browser step or has changed its download page.',
  'FileKeeper requires a password or CAPTCHA. Complete it in your browser.',
  'FileKeeper requires a longer waiting period. Continue in your browser.',
  'FileKeeper did not return a direct file link. Continue in your browser.',
  'DataNodes requires its browser download steps. Open the host and import the final direct file URL.',
  'Import this paste to expand its file links first.',
  'Choose up to 20 game folders.',
  'Choose Chrome, Edge, Brave or Firefox.',
  'Confirm that you understand the warning before continuing.',
  'Enter a VirusTotal API key: 64 letters and numbers from your VirusTotal account.',
  'Ravenshelf blocked this download, so it cannot be downloaded from here.',
  'Ravenshelf cannot download this link. You can let your browser download it instead.',
  'The browser connector is available on Windows only.',
  'This browser download is no longer available.',
  'This link is not available, so your browser cannot download it either.',
  'Wait for Ravenshelf to finish checking this link.',
  'Windows protected storage is unavailable, so the VirusTotal key was not saved.',
  'Turn on Connect the browser extension first.',
  'Ravenshelf could not open the extension folder.',
  'Only YouTube video addresses can be downloaded this way.',
  'Too many YouTube downloads are waiting. Let some finish first.',
  'Choose a YouTube download quality.',
  'Choose a language from the list.',
  'This download has no Nexus Mods page.',
  'No mods have been downloaded yet.',
  'Choose how numbers are written from the list.',
  // Fixed messages of the YouTube helper programs and yt-dlp runner.
  ...Object.values(TOOL_MESSAGES),...Object.values(MEDIA_MESSAGES),
  // Fixed messages about a mod file's download link.
  MOD_LINK_EXPIRED,MOD_LINK_MOVED,MOD_LINK_DROPPED
].map(message=>[message,message]));
// The connector check failing means this copy of the app was altered or damaged.
const CONNECTOR_CHANGED='The browser connector in this copy of Ravenshelf failed its integrity check. Download Ravenshelf again from its GitHub releases page.';
MESSAGES.set('The bundled browser connector changed.',CONNECTOR_CHANGED);MESSAGES.set(CONNECTOR_CHANGED,CONNECTOR_CHANGED);
const ACTIONS=new Map([
  ['previewDownloadRemoval','The download files could not be checked. Make a new cleanup preview.'],
  ['removeDownloads','The selected downloads could not be removed. Review the list and try again.'],
  ['getStorageSummary','Download storage could not be checked. Try again later.'],
  ['verifyFiles','Checksum verification could not start. Check the selected files and try again.'],
  ['getGameMetadata','Game details are temporarily unavailable.'],
  ['checkForUpdates','The update could not be checked. Your current app is unchanged.'],
  ['downloadUpdate','The update could not be downloaded. Your current app is unchanged.'],
  ['installUpdate','The update could not be installed. Your current app is unchanged.'],
  ['openHost','The file could not be queued. Check the link and download folder, then try again.'],
  ['checkLinks','The link could not be checked. Try again or choose another mirror.'],
  ['listGames','The catalogue could not be loaded. Please try again.'],
  ['listCatalog','The catalogue could not be loaded. Please try again.'],
  ['getGame','The game page could not be loaded. Please try again.'],
  ['expandLinks','The file list could not be read. Check the source links and try again.'],
  ['paste','The paste could not be read. Check its link and decryption key, then try again.'],
  ['catalogRefresh','The catalogue could not be refreshed. Ravenshelf will try again.'],
  ['completion','The completion action could not run. Please try again.'],
  ['download','The file could not be downloaded. Check the link, connection and download folder, then retry.'],
  ['getInstalledGames','Installed games could not be checked. Check access to your game folders and try again.'],
  ['scanInstalledGames','Installed games could not be checked. Check access to your game folders and try again.'],
  ['addGameFolder','The game folder could not be added. Check access to it and try again.'],
  ['setBrowserIntegration','Ravenshelf could not connect the browser extension. Try again; if it keeps failing, restart Ravenshelf.'],
  ['openBrowserExtensionFolder','The extension folder could not be prepared. Check that your Ravenshelf profile folder is writable, then try again.'],
  ['browserCaptureAction','This browser download could not be handled. Check it again or dismiss it.'],
  ['updateThreatLists','The protection lists could not be updated. The previous lists are still used.'],
  ['setVirusTotalKey','The VirusTotal key could not be saved.'],
  ['clearVirusTotalKey','The VirusTotal key could not be removed. Try again.'],
  ['saveVirusTotalSettings','The VirusTotal preference could not be saved. Try again.'],
  ['media',MEDIA_MESSAGES.failed],
  ['setUpYouTube','YouTube downloads could not be set up. Try again later.'],
  ['cancelYouTubeSetup','The YouTube setup could not be cancelled. Try again.'],
  ['removeYouTubeTools','The YouTube helper programs could not be removed. Pause YouTube downloads and try again.'],
  ['saveYouTubeSettings','The YouTube preference could not be saved. Try again.'],
  ['dismissYouTubeRequests','The waiting YouTube videos could not be dismissed. Try again.'],
  ['getHardware','This PC’s specs could not be read. Try again.'],
  ['checkGame','This PC could not be compared with the game. Try again.'],
  ['getDownloadSpace','Free space could not be checked.'],
  ['setLanguage','The language could not be changed. Try again.'],
  ['openModPage','The mod’s page could not be opened.'],
  ['openModsFolder','The Mods folder could not be opened.']
]);
const SYSTEM_MESSAGES=new Map([
  ['ENOENT','The requested file or folder is unavailable. Check that it still exists and try again.'],
  ['EACCES','Ravenshelf cannot access this file or folder. Check its permissions and try again.'],
  ['EPERM','Ravenshelf cannot access this file or folder. Check its permissions and try again.'],
  ['ENOSPC','There is not enough free disk space. Free some space and try again.'],
  ['EEXIST','A file with this name already exists. Choose another location or file name.'],
  ['ETIMEDOUT','The connection timed out. Check your connection and try again.'],
  ['ECONNRESET','The connection was interrupted. Please try again.'],
  ['ENOTFOUND','The host could not be reached. Check your connection and try again.'],
  ['ERR_INVALID_URL','Invalid web address.'],
  // Codes that the network library reports for the same failures.
  ['EAI_AGAIN','The host could not be reached. Check your connection and try again.'],
  ['ENETUNREACH','The host could not be reached. Check your connection and try again.'],
  ['EHOSTUNREACH','The host could not be reached. Check your connection and try again.'],
  ['ECONNREFUSED','The host refused the connection. Try again later.'],
  ['EPIPE','The connection was interrupted. Please try again.'],
  ['ECONNABORTED','The connection was interrupted. Please try again.'],
  ['UND_ERR_SOCKET','The connection was interrupted. Please try again.'],
  ['UND_ERR_CONNECT_TIMEOUT','The connection timed out. Check your connection and try again.'],
  ['UND_ERR_HEADERS_TIMEOUT','The connection timed out. Check your connection and try again.'],
  ['UND_ERR_BODY_TIMEOUT','The connection timed out. Check your connection and try again.']
]);
// A sanitized provider failure can later become a download or IPC failure.
// Keep fixed public guidance stable when it crosses a second boundary.
for(const message of [...ACTIONS.values(),...SYSTEM_MESSAGES.values()])MESSAGES.set(message,message);
MESSAGES.set('Ravenshelf could not complete this action. Please try again.','Ravenshelf could not complete this action. Please try again.');
function publicErrorMessage(error,action){
  try{
    const message=error?.message;
    if(typeof message==='string'){
      const known=MESSAGES.get(message);if(known)return known;
      const downloadHTTP=/^Host returned HTTP ([1-5]\d{2})\. Check the source link or retry\.$/.exec(message);
      if(downloadHTTP)return `Host returned HTTP ${downloadHTTP[1]}. Check the source link or retry.`;
      const hostHTTP=/^The host returned HTTP ([1-5]\d{2}); open it in your browser\.$/.exec(message);
      if(hostHTTP)return `The host returned HTTP ${hostHTTP[1]}; open it in your browser.`;
      const fastHTTP=/^FuckingFast returned HTTP ([1-5]\d{2})\. Open the protected host to complete its verification\.$/.exec(message);
      if(fastHTTP)return `FuckingFast returned HTTP ${fastHTTP[1]}. Open the protected host to complete its verification.`;
      // Preserve only the numeric HTTP status, never arbitrary host response text.
      const http=/^(?:Catalog source unavailable \(HTTP (\d{3})\)\.|Catalog unavailable \(HTTP (\d{3})\)\. Try again later\.|Game page unavailable \(HTTP (\d{3})\)\.|Paste returned HTTP (\d{3})\.)$/.exec(message);
      if(http)return `The source returned HTTP ${http.slice(1).find(Boolean)}. Please try again or choose another source.`;
    }
    // A failed request arrives as "fetch failed" with the real reason as its
    // cause. Only fixed public messages and known codes are used from causes.
    for(let cause=error,depth=0;cause&&depth<4;cause=cause.cause,depth++){
      if(depth&&typeof cause.message==='string'){const known=MESSAGES.get(cause.message);if(known)return known;}
      const system=SYSTEM_MESSAGES.get(cause.code);if(system)return system;
    }
  }catch{ /* An unexpected error object must not break the public error boundary. */ }
  return ACTIONS.get(action)||'Ravenshelf could not complete this action. Please try again.';
}
function publicError(error,action){
  const failure=new Error(publicErrorMessage(error,action));
  // Electron normally serializes only the message. Also discard the stack so
  // alternate callers cannot receive a main-process filesystem path.
  failure.stack=failure.message;
  return failure;
}
const ERROR_RESPONSE_HEADERS=Object.freeze({
  'Content-Type':'text/plain; charset=utf-8',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; sandbox"
});
module.exports={publicErrorMessage,publicError,ERROR_RESPONSE_HEADERS};
