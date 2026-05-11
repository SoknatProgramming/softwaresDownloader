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
  const normalizedMatches = matches
    .map((item) => normalizeVersion(item))
    .filter(Boolean);

  if (normalizedMatches.length > 0) {
    return normalizedMatches.sort(semver.rcompare)[0];
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
    const normalized = attempts
      .map((item) => normalizeVersion(item))
      .filter(Boolean);
    if (normalized.length > 0) {
      return normalized.sort(semver.rcompare)[0];
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
  return response.data;
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

function isNewerVersion(current, latest) {
  const currentNormalized = normalizeVersion(current);
  const latestNormalized = normalizeVersion(latest);

  if (currentNormalized && latestNormalized) {
    return semver.gt(latestNormalized, currentNormalized);
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
    return {
      ...item,
      currentVersion,
      latestVersion,
      resolvedUrl,
      downloadUrl,
      hasNewerVersion: false,
      status: 'error',
      error: error.message
    };
  }

  const hasNewerVersion = isNewerVersion(currentVersion, latestVersion);

  return {
    ...item,
    currentVersion,
    latestVersion,
    hasNewerVersion,
    resolvedUrl,
    downloadUrl,
    status: 'ok'
  };
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
          localUrl: item.localUrl
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

async function downloadSoftware(item) {
  const url = await resolveDownloadUrl(item);

  // Follow redirects to get the real filename and version (e.g. Mozilla's latest-ssl redirect)
  let finalUrl = url;
  try {
    const meta = await fetchUrlMetadata(url);
    finalUrl = getFinalUrl(meta, url);
  } catch {
    // keep original url
  }

  const parsed = new URL(finalUrl);
  const nameFromUrl = path.basename(decodeURIComponent(parsed.pathname));
  const ext =
    path.extname(nameFromUrl).replace('.', '') ||
    item.linkType ||
    'bin';
  const version = item.latestVersion || item.currentVersion || extractVersion(finalUrl) || Date.now();
  const targetName = safeFileName(`${item.softwareName}-V${version}`) + `.${ext}`;

  const softwareDir = path.join(DOWNLOAD_DIR, safeFileName(item.softwareName));
  await fs.mkdir(softwareDir, { recursive: true });

  const filePath = path.join(softwareDir, targetName);
  const localUrl = `/files/${encodeURIComponent(safeFileName(item.softwareName))}/${encodeURIComponent(targetName)}`;

  try {
    if (await fileExists(filePath)) {
      return {
        message: 'Already downloaded',
        localFileName: targetName,
        localDir: safeFileName(item.softwareName),
        localUrl
      };
    }

    const isSourceForge = url.includes('sourceforge.net');
    const response = await axios.get(url, {
      responseType: 'stream',
      maxRedirects: 10,
      timeout: isSourceForge ? 120000 : 60000
    });

    await pipelineStream(response.data, filePath);

    return {
      message: 'Downloaded successfully',
      localFileName: targetName,
      localDir: safeFileName(item.softwareName),
      localUrl
    };
  } catch (error) {
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
  checkSoftwareList,
  checkSoftwareItem,
  downloadSoftware,
  ensureDownloadDir
};
