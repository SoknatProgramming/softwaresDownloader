const fs = require('fs/promises');
const path = require('path');
const { checkSoftwareList, loadLinkJson } = require('./softwareService');

const HISTORY_FILE = path.resolve(__dirname, '../version-history.json');

async function loadHistory() {
  try {
    const raw = await fs.readFile(HISTORY_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

async function saveHistory(data) {
  await fs.writeFile(HISTORY_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function recordVersionCheck() {
  const list = await loadLinkJson();
  const checked = await checkSoftwareList(list);
  const history = await loadHistory();
  const timestamp = new Date().toISOString();

  for (const item of checked) {
    if (!history[item.softwareName]) {
      history[item.softwareName] = [];
    }

    const existing = history[item.softwareName].find((h) => h.version === item.latestVersion);
    if (!existing) {
      history[item.softwareName].push({
        version: item.latestVersion,
        detectedAt: timestamp,
        status: item.status,
        resolvedUrl: item.resolvedUrl
      });
    }
  }

  await saveHistory(history);
  return history;
}

async function getVersionHistory(softwareName) {
  const history = await loadHistory();
  if (softwareName) {
    return history[softwareName] || [];
  }
  return history;
}

async function generateComparisonReport() {
  const list = await loadLinkJson();
  const checked = await checkSoftwareList(list);
  const history = await loadHistory();

  const report = {};
  for (const item of checked) {
    const versions = history[item.softwareName] || [];
    report[item.softwareName] = {
      currentVersion: item.currentVersion,
      latestVersion: item.latestVersion,
      hasNewerVersion: item.hasNewerVersion,
      versionHistory: versions.sort(
        (a, b) => new Date(b.detectedAt) - new Date(a.detectedAt)
      ),
      totalVersionsRecorded: versions.length
    };
  }

  return report;
}

module.exports = {
  HISTORY_FILE,
  loadHistory,
  saveHistory,
  recordVersionCheck,
  getVersionHistory,
  generateComparisonReport
};
