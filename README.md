# Download Softwares Checker API

A Node.js + Express service that checks remote download links for software versions, detects newer releases, and downloads installers into a shared `Softwares` folder for distribution.

## Install

```bash
npm install
```

## Run

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

## API

- `GET /api/softwares` - list all software entries with version metadata
- `GET /api/softwares/:name` - inspect a single software item
- `POST /api/softwares/:name/download` - download the named software into `Softwares`
- `POST /api/refresh` - refresh version metadata and persist it to `link.json`
- `GET /api/version-history` - get full version history for all software
- `GET /api/version-history/:name` - get version history for a specific software
- `GET /api/comparison-report` - get a detailed comparison report between current and latest versions
- `GET /files/:filename` - download a previously fetched file


## Usage

1. Add or update software entries in `link.json` with `softwareName`, `linkType`, and `linkUrl`.
2. Optionally add `downloadUrl` when the direct installer URL is different from the product page.
3. Optionally add `productPageUrl` and `versionRegex` to detect versions from the vendor's website page.
4. Call `GET /api/softwares` to see current and resolved version information.
5. Call `POST /api/refresh` to persist version detection back into `link.json` and record version history.
6. Call `GET /api/version-history` to view all recorded version history.
7. Call `GET /api/comparison-report` to generate a detailed comparison between current and latest versions.
8. Call `POST /api/softwares/<name>/download` to fetch the installer into `Softwares`.
9. Serve the file to others via `GET /files/<filename>`.

## Version History Tracking

The API automatically tracks all detected software versions in `version-history.json`. This allows you to:
- View the complete version history of each software
- Compare old versions with current stable versions
- Generate reports showing which software has updates available
- Track when each version was first detected

Example comparison report output:
```json
{
  "Chrome": {
    "currentVersion": "147.0.7727.138",
    "latestVersion": "147.0.7727.138",
    "hasNewerVersion": false,
    "totalVersionsRecorded": 3,
    "versionHistory": [
      {
        "version": "147.0.7727.138",
        "detectedAt": "2026-05-04T10:30:00Z"
      },
      {
        "version": "146.0.7612.200",
        "detectedAt": "2026-05-01T08:15:00Z"
      }
    ]
  }
}
```


## Example entry

```json
{
  "softwareName": "Firefox",
  "linkType": "exe",
  "linkUrl": "https://download-installer.cdn.mozilla.net/pub/firefox/releases/150.0.1/win64/en-US/Firefox Setup 150.0.1.exe",
  "productPageUrl": "https://www.mozilla.org/en-US/firefox/new/",
  "versionRegex": "Firefox\s+([0-9]+\.[0-9]+\.[0-9]+)"
}
```

> Note: `productPageUrl` and `versionRegex` are optional. They help the checker validate the latest release from the real vendor page, instead of only using the download URL metadata.
For Chrome MSI downloads, the URL `https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi` always points to the latest stable version. Use the Chrome releases blog (`https://chromereleases.googleblog.com/`) for version detection.
For Firefox, use the official releases page (`https://www.firefox.com/en-US/releases/`) for accurate version information.
For Adobe Acrobat, use the official release notes (`https://www.adobe.com/devnet-docs/acrobatetk/tools/ReleaseNotesDC/index.html`) for version detection.
## Notes

- The service uses URL parsing, HTTP metadata, and optional vendor page version regexes to detect versions.
- When multiple version-like values are found, it chooses the highest semver match to reduce false positives from older page snippets.
- If `link.json` contains a newer URL or version, the refresh endpoint will save status flags back to the file.
- The `Softwares` directory is served statically from `/files`.
