// Publish the new history UI only after its backend API and save coordinator
// have passed production checks. This is a build-time gate, not a user redirect.
const url = 'https://er2-lab-api.zhujunjie418.workers.dev/health';
let failure = '';
for (let attempt = 0; attempt < 24; attempt++) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
    const h = await response.json();
    if (response.ok && h.coreReady === true && h.capabilities?.weekly?.version === 'weekly-save-history-v1' &&
        h.capabilities?.learning?.storageReady === true && h.capabilities.learning.recipientsReady === true && h.capabilities.learning.version === 'learning-text-v1' &&
        h.capabilities.weekly.coordinatedWrites === true && h.capabilities.weekly.historyPagination === true) {
      console.log('Weekly backend verified; publishing compatible UI. Backend commit: ' + h.release?.commit);
      process.exit(0);
    }
    failure = 'Weekly/learning backend is not ready';
  } catch (_) { failure = 'Weekly backend health could not be read'; }
  await new Promise(resolve => setTimeout(resolve, 10000));
}
throw new Error(failure + '; existing Pages deployment retained');
