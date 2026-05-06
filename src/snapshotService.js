const fs = require('fs/promises');
const path = require('path');
const { checkSoftwareList, loadLinkJson } = require('./softwareService');

const SNAPSHOTS_FILE = path.resolve(__dirname, '../version-snapshots.json');

async function loadSnapshots() {
  try {
    const raw = await fs.readFile(SNAPSHOTS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return {
      snapshots: [],
      latestSnapshot: null
    };
  }
}

async function saveSnapshots(data) {
  await fs.writeFile(SNAPSHOTS_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function createSnapshot(label) {
  const list = await loadLinkJson();
  const checked = await checkSoftwareList(list);
  const snapshots = await loadSnapshots();
  
  const timestamp = new Date().toISOString();
  const snapshot = {
    id: `snapshot-${Date.now()}`,
    label: label || `Snapshot from ${new Date().toLocaleDateString()}`,
    timestamp,
    versions: {}
  };

  for (const item of checked) {
    snapshot.versions[item.softwareName] = {
      version: item.latestVersion,
      currentVersion: item.currentVersion,
      hasNewerVersion: item.hasNewerVersion,
      resolvedUrl: item.resolvedUrl
    };
  }

  snapshots.snapshots.push(snapshot);
  snapshots.latestSnapshot = snapshot.id;
  await saveSnapshots(snapshots);

  return snapshot;
}

async function getSnapshots() {
  return await loadSnapshots();
}

async function getSnapshot(snapshotId) {
  const snapshots = await loadSnapshots();
  return snapshots.snapshots.find((s) => s.id === snapshotId);
}

async function compareSnapshots(snapshotId1, snapshotId2) {
  const snapshots = await loadSnapshots();
  const snapshot1 = snapshots.snapshots.find((s) => s.id === snapshotId1);
  const snapshot2 = snapshots.snapshots.find((s) => s.id === snapshotId2);

  if (!snapshot1 || !snapshot2) {
    throw new Error('One or both snapshots not found');
  }

  const comparison = {
    snapshot1: {
      id: snapshot1.id,
      label: snapshot1.label,
      timestamp: snapshot1.timestamp
    },
    snapshot2: {
      id: snapshot2.id,
      label: snapshot2.label,
      timestamp: snapshot2.timestamp
    },
    changes: {}
  };

  const allSoftware = new Set([
    ...Object.keys(snapshot1.versions),
    ...Object.keys(snapshot2.versions)
  ]);

  for (const software of allSoftware) {
    const v1 = snapshot1.versions[software];
    const v2 = snapshot2.versions[software];

    if (!v1) {
      comparison.changes[software] = {
        status: 'added',
        oldVersion: null,
        newVersion: v2.version
      };
    } else if (!v2) {
      comparison.changes[software] = {
        status: 'removed',
        oldVersion: v1.version,
        newVersion: null
      };
    } else if (v1.version !== v2.version) {
      comparison.changes[software] = {
        status: 'updated',
        oldVersion: v1.version,
        newVersion: v2.version,
        upgraded: v1.hasNewerVersion ? 'yes' : 'no'
      };
    } else {
      comparison.changes[software] = {
        status: 'unchanged',
        version: v1.version
      };
    }
  }

  return comparison;
}

async function compareWithLatest() {
  const snapshots = await loadSnapshots();
  
  if (!snapshots.latestSnapshot || snapshots.snapshots.length < 2) {
    throw new Error('Need at least two snapshots for comparison');
  }

  const latestSnapshot = snapshots.snapshots[snapshots.snapshots.length - 1];
  const previousSnapshot = snapshots.snapshots[snapshots.snapshots.length - 2];

  return await compareSnapshots(previousSnapshot.id, latestSnapshot.id);
}

async function deleteSnapshot(snapshotId) {
  const snapshots = await loadSnapshots();
  snapshots.snapshots = snapshots.snapshots.filter((s) => s.id !== snapshotId);
  
  if (snapshots.latestSnapshot === snapshotId) {
    snapshots.latestSnapshot = snapshots.snapshots.length > 0 
      ? snapshots.snapshots[snapshots.snapshots.length - 1].id 
      : null;
  }

  await saveSnapshots(snapshots);
}

module.exports = {
  SNAPSHOTS_FILE,
  loadSnapshots,
  saveSnapshots,
  createSnapshot,
  getSnapshots,
  getSnapshot,
  compareSnapshots,
  compareWithLatest,
  deleteSnapshot
};
