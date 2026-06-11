const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const semver = require('semver');

const DATA_FILE = path.resolve(__dirname, '../link.json');
const DOWNLOAD_DIR = path.resolve(__dirname, '../Softwares');
const VERSION_REGEX = /(\d+\.\d+\.\d+(?:\.\d+)*|\d+\.\d+)/g;

async function loadLinkJson() {
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}

async function saveLinkJson(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function normalizeVersion(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const normalized = semver.valid(trimmed) || semver.coerce(trimmed)?.version;
  return normalized || null;
}

function extractVersion(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // value contains malformed % sequences; scan the original
  }

  const matches = [...decoded.matchAll(VERSION_REGEX)].map((m) => m[0]);
  const pairs = matches
    .map((raw) => ({ raw, normalized: normalizeVersion(raw) }))
    .filter((p) => p.normalized);

  if (pairs.length > 0) {
    pairs.sort((a, b) => semver.rcompare(a.normalized, b.normalized));
    return pairs[0].raw;
  }

  return matches[0] || null;
}

function extractVersionFromText(text, regex) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const attempts = [];
  if (regex) {
    try {
      const custom = new RegExp(regex, 'gi');
      let match;
      while ((match = custom.exec(text))) {
        attempts.push(match[1] || match[0]);
      }
    } catch (error) {
      // invalid regex; fall back to default extraction
    }
  }

  if (attempts.length > 0) {
    const pairs = attempts
      .map((raw) => ({ raw, normalized: normalizeVersion(raw) }))
      .filter((p) => p.normalized);
    if (pairs.length > 0) {
      pairs.sort((a, b) => semver.rcompare(a.normalized, b.normalized));
      return pairs[0].raw;
    }
    return attempts[0];
  }

  // When a custom regex was supplied but matched nothing, return null.
  // Falling back to generic HTML scanning produces false positives on full pages.
  if (regex) return null;

  return extractVersion(text);
}

async function fetchHtml(url) {
  const response = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Node.js) DownloadSoftwaresChecker' },
    maxRedirects: 5,
    timeout: 15000,
    validateStatus: (status) => status < 500
  });
  const data = response.data;
  return typeof data === 'string' ? data : JSON.stringify(data);
}

async function resolveSourceForgeUrl(sfUrl) {
  try {
    // No browser User-Agent — SourceForge returns 403 for browser UAs on /download URLs
    // but redirects non-browser clients directly to the actual mirror file
    const response = await axios.get(sfUrl, {
      maxRedirects: 10,
      timeout: 30000,
      validateStatus: (status) => status < 500
    });

    // If axios followed an HTTP redirect straight to the file host, use that
    const redirected =
      response.request?.res?.responseUrl ||
      response.request?._redirectable?._currentUrl;
    if (redirected && !redirected.includes('sourceforge.net/projects/')) {
      return redirected;
    }

    // SourceForge served its HTML countdown page — extract the real mirror link
    const html = typeof response.data === 'string' ? response.data : '';
    const patterns = [
      /id="direct-link"[^>]*href="([^"]+)"/i,
      /href="(https?:\/\/downloads\.sourceforge\.net\/project\/[^"?]+)(?:[^"]*)?"/i,
      /<meta[^>]+content="\d+;\s*url=([^"]+)"/i
    ];
    for (const pattern of patterns) {
      const m = pattern.exec(html);
      if (m) return m[1].replace(/&amp;/g, '&');
    }
  } catch {
    // fall back to the original SourceForge /download URL
  }
  return sfUrl;
}

async function resolveDownloadUrl(item) {
  if (!item.downloadLinkRegex || !item.productPageUrl) {
    return item.linkUrl;
  }
  try {
    const html = await fetchHtml(item.productPageUrl);
    const regex = new RegExp(item.downloadLinkRegex, 'i');
    const match = regex.exec(html);
    if (match) {
      let href = match[1] || match[0];
      if (!/^https?:\/\//.test(href)) {
        const base = new URL(item.productPageUrl);
        href = `${base.protocol}//${base.host}${href}`;
      }
      // SourceForge /download URLs need a second step to get the real mirror URL
      if (href.includes('sourceforge.net') && href.includes('/download')) {
        return await resolveSourceForgeUrl(href);
      }
      return href;
    }
  } catch {
    // fall back to linkUrl
  }
  return item.linkUrl;
}

async function getPageVersion(item) {
  if (!item.productPageUrl) {
    return null;
  }

  try {
    const html = await fetchHtml(item.productPageUrl);
    return extractVersionFromText(html, item.versionRegex);
  } catch (error) {
    return null;
  }
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

function isNewerVersion(current, latest) {
  const currentNormalized = normalizeVersion(current);
  const latestNormalized = normalizeVersion(latest);

  if (currentNormalized && latestNormalized) {
    const cmp = semver.compare(latestNormalized, currentNormalized);
    if (cmp !== 0) return cmp > 0;
    // semver truncates 4-part versions (e.g. Chrome 148.0.7778.168 → 148.0.7778)
    // fall back to full numeric part comparison
    return compareVersionParts(latest, current) > 0;
  }

  if (current && latest) {
    return latest !== current;
  }

  return false;
}

async function fetchUrlMetadata(url) {
  const isSourceForge = url.includes('sourceforge.net');
  const opts = {
    maxRedirects: isSourceForge ? 10 : 5,
    timeout: isSourceForge ? 30000 : 15000,
    validateStatus: (status) => status < 500
  };

  try {
    return await axios.head(url, opts);
  } catch (error) {
    if (error.response?.status === 405 || error.response?.status === 403) {
      return await axios.get(url, { ...opts, headers: { ...opts.headers, Range: 'bytes=0-0' } });
    }
    throw error;
  }
}

function getFinalUrl(response, fallback) {
  if (!response) {
    return fallback;
  }

  const responseUrl = response.request?.res?.responseUrl || response.request?._redirectable?._currentUrl;
  return responseUrl || fallback;
}

// Size the website reports for the file. Handles both a normal HEAD/GET
// (content-length) and the Range fallback in fetchUrlMetadata, where the real
// total lives in content-range ("bytes 0-0/12345").
function getRemoteSize(headers) {
  if (!headers) return null;
  const range = headers['content-range'];
  if (range) {
    const m = /\/\s*(\d+)\s*$/.exec(range);
    if (m) return Number(m[1]);
    return null; // range request: content-length is the chunk, not the file
  }
  const len = headers['content-length'];
  if (len != null && len !== '') return Number(len);
  return null;
}

// The filename we expect on disk for a resolved download URL. Shared by the
// check (to detect a wrong name) and the download (to write the file).
function deriveTargetName(item, finalUrl) {
  const parsed = new URL(finalUrl);
  const nameFromUrl = path.basename(decodeURIComponent(parsed.pathname));
  const ext = path.extname(nameFromUrl).replace('.', '') || item.linkType || 'bin';
  // Prefer the version embedded in the resolved URL — that's the file the
  // website is actually serving — so the name matches the real content and
  // stale latest/current fields don't cause spurious name mismatches.
  const version = extractVersion(finalUrl) || item.latestVersion || item.currentVersion || Date.now();
  return safeFileName(`${item.softwareName}-V${version}`) + `.${ext}`;
}

async function checkSoftwareItem(item) {
  const downloadUrl = await resolveDownloadUrl(item);
  const currentVersion =
    item.currentVersion ||
    item.version ||
    extractVersion(item.localFileName) ||
    extractVersion(downloadUrl) ||
    null;
  let latestVersion = currentVersion;
  let resolvedUrl = downloadUrl;
  let headers = {};

  const versionFromPage = await getPageVersion(item);
  if (versionFromPage) {
    latestVersion = versionFromPage;
  }

  try {
    const response = await fetchUrlMetadata(downloadUrl);
    resolvedUrl = getFinalUrl(response, downloadUrl);
    headers = response.headers || {};

    const versionFromUrl = extractVersion(resolvedUrl);
    const versionFromHeader = extractVersion(headers['content-disposition'] || '');
    const versionFromLocation = extractVersion(headers.location || '');

    latestVersion = versionFromPage || versionFromUrl || versionFromHeader || versionFromLocation || latestVersion;
  } catch (error) {
    const fileSize = await getLocalFileSize(item.localDir, item.localFileName);
    return {
      ...item,
      currentVersion,
      latestVersion,
      resolvedUrl,
      downloadUrl,
      hasNewerVersion: false,
      fileSize,
      remoteSize: null,
      expectedFileName: null,
      status: 'error',
      error: error.message
    };
  }

  const hasNewerVersion = isNewerVersion(currentVersion, latestVersion);
  const fileSize = await getLocalFileSize(item.localDir, item.localFileName);
  // What the website says this file should be, so the caller can re-download
  // when the local copy is missing, the wrong size, or the wrong name.
  const remoteSize = getRemoteSize(headers);
  // Use the same version the download will use (the returned latestVersion),
  // so the expected name matches what downloadSoftware actually writes and we
  // don't flag a false name mismatch.
  const expectedFileName = deriveTargetName({ ...item, latestVersion }, resolvedUrl);

  return {
    ...item,
    currentVersion,
    latestVersion,
    hasNewerVersion,
    resolvedUrl,
    downloadUrl,
    fileSize,
    remoteSize,
    expectedFileName,
    status: 'ok'
  };
}

async function listSoftwaresFast() {
  const list = await loadLinkJson();
  return Promise.all(
    list.map(async (item) => {
      const currentVersion =
        item.currentVersion || extractVersion(item.localFileName) || null;
      const stat = await getLocalFileStat(item.localDir, item.localFileName);
      return {
        ...item,
        currentVersion,
        latestVersion: item.latestVersion || currentVersion,
        hasNewerVersion: Boolean(item.hasNewerVersion),
        fileSize: stat?.size ?? null,
        releaseDate: stat?.mtime?.toISOString() ?? null,
        status: 'ok',
      };
    })
  );
}

async function checkSoftwareList(list, options = { persist: false }) {
  const results = await Promise.all(
    list.map(async (item) => {
      const updated = await checkSoftwareItem(item);
      if (options.persist && updated.status === 'ok') {
        return {
          ...item,
          currentVersion: updated.currentVersion,
          latestVersion: updated.latestVersion,
          hasNewerVersion: updated.hasNewerVersion,
          resolvedUrl: updated.resolvedUrl,
          localFileName: item.localFileName,
          localUrl: item.localUrl,
          fileSize: updated.fileSize
        };
      }
      return updated;
    })
  );

  return results;
}

async function ensureDownloadDir() {
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
}

function safeFileName(value) {
  return value
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 200);
}

async function getLocalFileStat(localDir, localFileName) {
  if (!localDir || !localFileName) return null;
  try {
    return await fs.stat(path.join(DOWNLOAD_DIR, localDir, localFileName));
  } catch {
    return null;
  }
}

async function getLocalFileSize(localDir, localFileName) {
  const stat = await getLocalFileStat(localDir, localFileName);
  return stat?.size ?? null;
}

async function downloadSoftware(item) {
  const url = await resolveDownloadUrl(item);

  // Follow redirects to get the real filename and version (e.g. Mozilla's latest-ssl redirect)
  let finalUrl = url;
  let remoteSize = null;
  try {
    const meta = await fetchUrlMetadata(url);
    finalUrl = getFinalUrl(meta, url);
    remoteSize = getRemoteSize(meta.headers);
  } catch {
    // keep original url
  }

  const targetName = deriveTargetName(item, finalUrl);

  const softwareDir = path.join(DOWNLOAD_DIR, safeFileName(item.softwareName));
  await fs.mkdir(softwareDir, { recursive: true });

  const filePath = path.join(softwareDir, targetName);
  const localUrl = `/files/${encodeURIComponent(safeFileName(item.softwareName))}/${encodeURIComponent(targetName)}`;

  try {
    const dir = safeFileName(item.softwareName);

    if (await fileExists(filePath)) {
      const existingSize = await getLocalFileSize(dir, targetName);
      // Only treat it as already-downloaded if the bytes on disk match what the
      // website serves; otherwise the local copy is stale/corrupt — re-fetch it.
      if (remoteSize == null || Number(existingSize) === Number(remoteSize)) {
        return {
          message: 'Already downloaded',
          localFileName: targetName,
          localDir: dir,
          localUrl,
          fileSize: existingSize,
        };
      }
    }

    const response = await axios.get(url, {
      responseType: 'stream',
      maxRedirects: 10,
      // Binaries can be large (e.g. Acrobat ~800 MB); allow plenty of time so
      // the stream isn't aborted mid-transfer on slower connections.
      timeout: 1200000
    });

    await pipelineStream(response.data, filePath);

    return {
      message: 'Downloaded successfully',
      localFileName: targetName,
      localDir: dir,
      localUrl,
      fileSize: await getLocalFileSize(dir, targetName),
    };
  } catch (error) {
    // Remove any partial/corrupt file so the next run re-downloads cleanly.
    await fs.rm(filePath, { force: true }).catch(() => {});
    throw new Error(`Download failed: ${error.message}`);
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function pipelineStream(stream, filePath) {
  return new Promise((resolve, reject) => {
    const writeStream = require('fs').createWriteStream(filePath);
    stream.pipe(writeStream);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
    stream.on('error', reject);
  });
}

module.exports = {
  DATA_FILE,
  DOWNLOAD_DIR,
  loadLinkJson,
  saveLinkJson,
  listSoftwaresFast,
  checkSoftwareList,
  checkSoftwareItem,
  downloadSoftware,
  ensureDownloadDir,
  fileExists,
  getLocalFileSize,
  deriveTargetName
};
