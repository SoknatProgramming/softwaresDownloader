const express = require('express');
const path = require('path');
const { loadLinkJson, saveLinkJson, checkSoftwareList, downloadSoftware, ensureDownloadDir } = require('./src/softwareService');
const { recordVersionCheck, getVersionHistory, generateComparisonReport } = require('./src/versionHistoryService');
const { createSnapshot, getSnapshots, getSnapshot, compareSnapshots, compareWithLatest, deleteSnapshot } = require('./src/snapshotService');
const { checkAndDownloadAll, getUpdateLog } = require('./src/autoUpdateService');
const scheduler = require('./src/schedulerService');
const { getStore, compareVersions, compareAll, getVersionDiff } = require('./src/versionStoreService');

const app = express();
const PORT = process.env.PORT || 4000;
const DOWNLOAD_FOLDER = path.resolve(__dirname, 'Softwares');

app.use(express.json());
app.use(require('cors')());
app.use('/files', express.static(DOWNLOAD_FOLDER));

app.get('/api/softwares', async (req, res) => {
  try {
    const list = await loadLinkJson();
    const result = await checkSoftwareList(list);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/softwares/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const list = await loadLinkJson();
    const item = list.find((entry) => entry.softwareName.toLowerCase() === name.toLowerCase());
    if (!item) {
      return res.status(404).json({ error: `Software not found: ${name}` });
    }
    const [result] = await checkSoftwareList([item]);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/softwares/:name/download', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const list = await loadLinkJson();
    const item = list.find((entry) => entry.softwareName.toLowerCase() === name.toLowerCase());
    if (!item) {
      return res.status(404).json({ error: `Software not found: ${name}` });
    }

    await ensureDownloadDir();
    const downloaded = await downloadSoftware(item);

    if (downloaded.localFileName && downloaded.localUrl) {
      item.localFileName = downloaded.localFileName;
      item.localDir = downloaded.localDir;
      item.localUrl = downloaded.localUrl;
      await saveLinkJson(list);
    }

    res.json(downloaded);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/refresh', async (req, res) => {
  try {
    const list = await loadLinkJson();
    const refreshed = await checkSoftwareList(list, { persist: true });
    await saveLinkJson(refreshed);
    await recordVersionCheck();
    res.json(refreshed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/version-history', async (req, res) => {
  try {
    const history = await getVersionHistory();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/version-history/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const history = await getVersionHistory(name);
    res.json({ softwareName: name, versions: history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/comparison-report', async (req, res) => {
  try {
    const report = await generateComparisonReport();
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Scheduler routes ---

app.get('/api/scheduler/status', (req, res) => {
  res.json(scheduler.getStatus());
});

app.post('/api/scheduler/start', (req, res) => {
  const intervalMs = req.body?.intervalMs;
  res.json(scheduler.start(intervalMs));
});

app.post('/api/scheduler/stop', (req, res) => {
  res.json(scheduler.stop());
});

app.post('/api/scheduler/run-now', async (req, res) => {
  try {
    const result = await scheduler.runNow();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Auto-update routes ---

app.get('/api/auto-update/log', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const log = await getUpdateLog(limit);
    res.json(log);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auto-update/run', async (req, res) => {
  try {
    const result = await checkAndDownloadAll();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Version store routes ---

app.get('/api/version-store', async (req, res) => {
  try {
    const store = await getStore();
    res.json(store);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/version-store/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const entry = await getStore(name);
    if (!entry) return res.status(404).json({ error: `No data for: ${name}` });
    res.json(entry);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/version-store/:name/compare', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const { from, to } = req.query;
    if (from && to) {
      const diff = await getVersionDiff(name, from, to);
      return res.json(diff);
    }
    const comparison = await compareVersions(name);
    res.json(comparison);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/version-store-compare', async (req, res) => {
  try {
    const report = await compareAll();
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Snapshot routes ---

app.post('/api/snapshots', async (req, res) => {
  try {
    const label = req.body?.label;
    const snapshot = await createSnapshot(label);
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/snapshots', async (req, res) => {
  try {
    const snapshots = await getSnapshots();
    res.json(snapshots);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/snapshots/:id', async (req, res) => {
  try {
    const snapshot = await getSnapshot(req.params.id);
    if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/snapshots/compare/:id1/:id2', async (req, res) => {
  try {
    const result = await compareSnapshots(req.params.id1, req.params.id2);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/snapshots/compare-latest', async (req, res) => {
  try {
    const result = await compareWithLatest();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/snapshots/:id', async (req, res) => {
  try {
    await deleteSnapshot(req.params.id);
    res.json({ message: 'Snapshot deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    message: 'Download Softwares Checker API',
    scheduler: scheduler.getStatus(),
    endpoints: {
      softwares: [
        'GET  /api/softwares',
        'GET  /api/softwares/:name',
        'POST /api/softwares/:name/download'
      ],
      refresh: ['POST /api/refresh'],
      versionHistory: [
        'GET /api/version-history',
        'GET /api/version-history/:name',
        'GET /api/comparison-report'
      ],
      versionStore: [
        'GET /api/version-store',
        'GET /api/version-store/:name',
        'GET /api/version-store/:name/compare',
        'GET /api/version-store/:name/compare?from=X&to=Y',
        'GET /api/version-store-compare'
      ],
      autoUpdate: [
        'POST /api/auto-update/run',
        'GET  /api/auto-update/log',
        'GET  /api/auto-update/log?limit=10'
      ],
      scheduler: [
        'GET  /api/scheduler/status',
        'POST /api/scheduler/start',
        'POST /api/scheduler/start  { intervalMs: 600000 }',
        'POST /api/scheduler/stop',
        'POST /api/scheduler/run-now'
      ],
      snapshots: [
        'POST /api/snapshots',
        'GET  /api/snapshots',
        'GET  /api/snapshots/:id',
        'GET  /api/snapshots/compare/:id1/:id2',
        'GET  /api/snapshots/compare-latest',
        'DELETE /api/snapshots/:id'
      ],
      files: ['GET /files/:filename']
    }
  });
});

app.listen(PORT, async () => {
  await ensureDownloadDir();
  console.log(`Server is running at http://localhost:${PORT}`);
  console.log(`Static downloads are served from /files`);
  console.log(`Version history tracked in version-history.json`);
  console.log(`Version store tracked in version-store.json`);
  scheduler.start();
});
