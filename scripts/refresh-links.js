const { loadLinkJson, saveLinkJson, checkSoftwareList } = require('../src/softwareService');

async function refresh() {
  const list = await loadLinkJson();
  const refreshed = await checkSoftwareList(list, { persist: true });
  await saveLinkJson(refreshed);
  console.log('link.json refreshed with version status for each software.');
  refreshed.forEach((item) => {
    console.log(`- ${item.softwareName}: current=${item.currentVersion || 'unknown'} latest=${item.latestVersion || 'unknown'} newer=${item.hasNewerVersion}`);
  });
}

refresh().catch((error) => {
  console.error('Refresh failed:', error.message);
  process.exit(1);
});
