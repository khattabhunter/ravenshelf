'use strict';

const PENDING_SCANS=new Set(['queued','scanning']);
function isScanPending(download){return PENDING_SCANS.has(download?.scan?.status);}

// No scan record means scanning was not requested. A recorded scan must finish
// cleanly before an unattended completion action can run, even if the user
// subsequently switches automatic scanning off.
function scanCompletionBlocker(downloads){
  const scans=downloads.filter(d=>d?.scan!==undefined&&d.scan!==null);
  if(scans.some(d=>d.scan.status==='threat'))return {kind:'review',message:'A scan detected a threat. Automatic close/shutdown is blocked. Review Windows Security and scan again after resolving it, or choose Keep Ravenshelf open.'};
  if(scans.some(d=>!PENDING_SCANS.has(d.scan.status)&&d.scan.status!=='clean'))return {kind:'review',message:'A scan needs review or did not finish successfully. Automatic close/shutdown is blocked. Review the result and scan again, or choose Keep Ravenshelf open.'};
  if(scans.some(isScanPending))return {kind:'pending',message:'Waiting for Microsoft Defender scans to finish before starting the completion countdown.'};
  return null;
}

// Used again immediately before the callback and at the OS boundary. This also
// catches a new scan or transfer queued after the last countdown observation.
function assertCompletionReady(downloads,ids){
  const targets=new Set(ids),byId=new Map(downloads.map(d=>[d.id,d]));
  if(!targets.size||downloads.some(d=>!['completed','cancelled'].includes(d.status))||
    [...targets].some(id=>byId.get(id)?.status!=='completed'))throw new Error('The queue changed; the completion action was stopped.');
  const blocker=scanCompletionBlocker(downloads.filter(d=>targets.has(d.id)||isScanPending(d)));
  if(blocker)throw new Error(blocker.message);
}

module.exports={isScanPending,scanCompletionBlocker,assertCompletionReady};
