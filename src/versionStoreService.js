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

function compareVersionParts(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function sortHistory(history) {
  return [...history].sort((a, b) => {
    const sv1 = semver.valid(semver.coerce(a.version));
    const sv2 = semver.valid(semver.coerce(b.version));
    if (sv1 && sv2) {
      const cmp = semver.compare(sv1, sv2);
      if (cmp !== 0) return cmp;
      // semver equal after coercion — compare all parts (handles 4-part versions like Chrome)
      return compareVersionParts(a.version, b.version);
    }
    return new Date(a.detectedAt) - new Date(b.detectedAt);
  });
}

// Each download format is tracked under its own key, e.g. "Firefox (exe)" and
// "Firefox (msi)", so two formats of the same software don't overwrite each
// other's current version / history.
function storeKeyFor(softwareName, linkType) {
  return linkType ? `${softwareName} (${linkType})` : softwareName;
}

// Resolve a user-supplied name to an actual store key. Falls back to the first
// "<name> (<format>)" entry so `/api/version-store/Chrome` still works.
function resolveKey(store, name) {
  if (store[name]) return name;
  const prefix = name + ' (';
  return Object.keys(store).find((k) => k.startsWith(prefix)) || name;
}

async function recordVersion(softwareName, versionInfo) {
  const store = await loadStore();
  const now = new Date().toISOString();

  const key = storeKeyFor(softwareName, versionInfo.linkType);

  if (!store[key]) {
    store[key] = {
      current: null,
      linkType: versionInfo.linkType || null,
      firstSeen: now,
      lastChecked: now,
      history: []
    };
  }

  const entry = store[key];
  entry.lastChecked = now;
  if (versionInfo.linkType) entry.linkType = versionInfo.linkType;

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
    return store[resolveKey(store, softwareName)] || null;
  }
  return store;
}

async function compareVersions(softwareName) {
  const store = await loadStore();
  const entry = store[resolveKey(store, softwareName)];

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
  const entry = store[resolveKey(store, softwareName)];
  if (!entry) return { error: 'Software not found' };

  const a = entry.history.find((h) => h.version === versionA);
  const b = entry.history.find((h) => h.version === versionB);

  if (!a || !b) return { error: 'One or both versions not found in history' };

  const svA = semver.valid(semver.coerce(versionA));
  const svB = semver.valid(semver.coerce(versionB));
  let direction = 'unknown';
  if (svA && svB) {
    const cmp = semver.compare(svB, svA) || compareVersionParts(versionB, versionA);
    direction = cmp > 0 ? 'upgrade' : cmp < 0 ? 'downgrade' : 'same';
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
