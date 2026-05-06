const fs = require('fs/promises');
const path = require('path');
const {
  loadLinkJson,
  saveLinkJson,
  checkSoftwareList,
  downloadSoftware,
  ensureDownloadDir
} = require('./softwareService');
const { recordVersionCheck } = require('./versionHistoryService');
const { recordVersion } = require('./versionStoreService');

const UPDATE_LOG_FILE = path.resolve(__dirname, '../auto-update-log.json');
const MAX_LOG_RUNS = 100;

async function loadUpdateLog() {
  try {
    const raw = await fs.readFile(UPDATE_LOG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { runs: [], lastRun: null, totalDownloaded: 0 };
  }
}

async function saveUpdateLog(data) {
  await fs.writeFile(UPDATE_LOG_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function checkAndDownloadAll() {
  const timestamp = new Date().toISOString();
  const list = await loadLinkJson();
  const checked = await checkSoftwareList(list);

  await ensureDownloadDir();

  const results = [];
  let anyUpdated = false;

  for (const item of checked) {
    const result = {
      softwareName: item.softwareName,
      currentVersion: item.currentVersion,
      latestVersion: item.latestVersion,
      hasNewerVersion: item.hasNewerVersion,
      status: item.status,
      action: 'none',
      error: null
    };

    const notYetDownloaded = !item.localFileName;
    const shouldDownload = item.status !== 'error' && (notYetDownloaded || item.hasNewerVersion);

    if (item.status === 'error') {
      result.action = 'error';
      result.error = item.error;
      console.error(`[AutoUpdate] Error checking ${item.softwareName}: ${item.error}`);
    } else if (shouldDownload) {
      try {
        const downloaded = await downloadSoftware(item);
        result.action = notYetDownloaded && !item.hasNewerVersion ? 'initial' : 'updated';
        result.localFile = downloaded.localFileName;
        result.localDir = downloaded.localDir;
        result.localUrl = downloaded.localUrl;
        result.downloadMessage = downloaded.message;

        const idx = list.findIndex((l) => l.softwareName === item.softwareName);
        if (idx >= 0) {
          if (item.hasNewerVersion) list[idx].currentVersion = item.latestVersion;
          if (downloaded.localFileName) list[idx].localFileName = downloaded.localFileName;
          if (downloaded.localDir) list[idx].localDir = downloaded.localDir;
          if (downloaded.localUrl) list[idx].localUrl = downloaded.localUrl;
        }

        await recordVersion(item.softwareName, {
          version: item.latestVersion || item.currentVersion,
          detectedAt: timestamp,
          downloadedAt: timestamp,
          localFile: `${downloaded.localDir}/${downloaded.localFileName}`,
          downloadUrl: item.resolvedUrl || item.downloadUrl
        });

        anyUpdated = true;

        if (item.hasNewerVersion) {
          console.log(`[AutoUpdate] Updated  ${item.softwareName}: ${item.currentVersion} → ${item.latestVersion}`);
        } else {
          console.log(`[AutoUpdate] Initial  ${item.softwareName}: ${item.latestVersion || item.currentVersion} (${downloaded.message})`);
        }
      } catch (err) {
        result.action = 'error';
        result.error = err.message;
        console.error(`[AutoUpdate] Failed to download ${item.softwareName}: ${err.message}`);
      }
    } else {
      await recordVersion(item.softwareName, {
        version: item.latestVersion || item.currentVersion,
        detectedAt: timestamp,
        downloadUrl: item.resolvedUrl || item.downloadUrl
      });
      console.log(`[AutoUpdate] No change ${item.softwareName}: ${item.latestVersion || item.currentVersion}`);
    }

    results.push(result);
  }

  if (anyUpdated) {
    await saveLinkJson(list);
  }

  await recordVersionCheck();

  const log = await loadUpdateLog();
  const runSummary = {
    timestamp,
    initial: results.filter((r) => r.action === 'initial').length,
    updated: results.filter((r) => r.action === 'updated').length,
    errors: results.filter((r) => r.action === 'error').length,
    noChange: results.filter((r) => r.action === 'none').length,
    results
  };

  log.runs.push(runSummary);
  if (log.runs.length > MAX_LOG_RUNS) {
    log.runs = log.runs.slice(-MAX_LOG_RUNS);
  }
  log.lastRun = timestamp;
  log.totalDownloaded = (log.totalDownloaded || 0) + runSummary.downloaded;

  await saveUpdateLog(log);

  return runSummary;
}

async function getUpdateLog(limit) {
  const log = await loadUpdateLog();
  const runs = limit ? log.runs.slice(-limit) : log.runs;
  return {
    lastRun: log.lastRun,
    totalDownloaded: log.totalDownloaded,
    totalRuns: log.runs.length,
    runs: runs.reverse()
  };
}

module.exports = {
  UPDATE_LOG_FILE,
  checkAndDownloadAll,
  getUpdateLog
};
