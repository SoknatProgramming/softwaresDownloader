const fs = require('fs/promises');
const path = require('path');
const semver = require('semver');

const STORE_FILE = path.resolve(__dirname, '../version-store.json');

async function loadStore() {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveStore(data) {
  await fs.writeFile(STORE_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function sortHistory(history) {
  return [...history].sort((a, b) => {
    const sv1 = semver.valid(semver.coerce(a.version));
    const sv2 = semver.valid(semver.coerce(b.version));
    if (sv1 && sv2) return semver.compare(sv1, sv2);
    return new Date(a.detectedAt) - new Date(b.detectedAt);
  });
}

async function recordVersion(softwareName, versionInfo) {
  const store = await loadStore();
  const now = new Date().toISOString();

  if (!store[softwareName]) {
    store[softwareName] = {
      current: null,
      firstSeen: now,
      lastChecked: now,
      history: []
    };
  }

  const entry = store[softwareName];
  entry.lastChecked = now;

  const version = versionInfo.version;
  if (version) {
    const alreadyExists = entry.history.find((h) => h.version === version);
    if (!alreadyExists) {
      entry.history.push({
        version,
        detectedAt: versionInfo.detectedAt || now,
        downloadedAt: versionInfo.downloadedAt || null,
        localFile: versionInfo.localFile || null,
        downloadUrl: versionInfo.downloadUrl || null
      });
      entry.history = sortHistory(entry.history);
    } else if (versionInfo.downloadedAt && !alreadyExists.downloadedAt) {
      alreadyExists.downloadedAt = versionInfo.downloadedAt;
      alreadyExists.localFile = versionInfo.localFile || alreadyExists.localFile;
    }
    entry.current = version;
  }

  await saveStore(store);
  return entry;
}

async function getStore(softwareName) {
  const store = await loadStore();
  if (softwareName) {
    return store[softwareName] || null;
  }
  return store;
}

async function compareVersions(softwareName) {
  const store = await loadStore();
  const entry = store[softwareName];

  if (!entry) {
    return { softwareName, error: 'No data found' };
  }

  const sorted = sortHistory(entry.history);

  if (sorted.length === 0) {
    return { softwareName, current: null, previous: null, changed: false, history: [] };
  }

  const current = sorted[sorted.length - 1];
  const previous = sorted.length >= 2 ? sorted[sorted.length - 2] : null;

  return {
    softwareName,
    current: current.version,
    previous: previous ? previous.version : null,
    changed: previous ? current.version !== previous.version : false,
    downloadedCurrent: !!current.downloadedAt,
    totalVersionsTracked: sorted.length,
    history: sorted
  };
}

async function compareAll() {
  const store = await loadStore();
  const result = {};
  for (const name of Object.keys(store)) {
    result[name] = await compareVersions(name);
  }
  return result;
}

async function getVersionDiff(softwareName, versionA, versionB) {
  const store = await loadStore();
  const entry = store[softwareName];
  if (!entry) return { error: 'Software not found' };

  const a = entry.history.find((h) => h.version === versionA);
  const b = entry.history.find((h) => h.version === versionB);

  if (!a || !b) return { error: 'One or both versions not found in history' };

  const svA = semver.valid(semver.coerce(versionA));
  const svB = semver.valid(semver.coerce(versionB));
  let direction = 'unknown';
  if (svA && svB) {
    direction = semver.gt(svB, svA) ? 'upgrade' : semver.lt(svB, svA) ? 'downgrade' : 'same';
  }

  return {
    softwareName,
    from: { version: versionA, detectedAt: a.detectedAt, downloadedAt: a.downloadedAt },
    to: { version: versionB, detectedAt: b.detectedAt, downloadedAt: b.downloadedAt },
    direction
  };
}

module.exports = {
  STORE_FILE,
  loadStore,
  saveStore,
  recordVersion,
  getStore,
  compareVersions,
  compareAll,
  getVersionDiff
};
