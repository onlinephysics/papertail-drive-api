# Papertrail PDF upload demo

This is a lightweight admin-only PDF library demo. The static website talks to a Google Apps Script web app, and that script stores PDFs in a folder belonging to a separate Google account. There is no Google OAuth in the browser and no Google credential in the frontend.

## Project files

- `index.html`, `admin.js`, `styles.css` — admin dashboard with picker, drag/drop, progress, list, view/download, delete, and refresh.
- The admin dashboard also includes upload-time visibility and an Access tab for all PDFs, selected PDFs, or one PDF. Private files can be shared with a whitelist of viewer email addresses.
- The Access tab includes Records (one editable access record per PDF) and Merge suggestions. Suggestions are filename-based and merge access rules only; the source PDF files remain separate.
- `public.html`, `public.js` — small read-only example showing how one stored PDF can appear on a normal website.
- `config.js` — public-only configuration (Apps Script URL and example public PDF links).
- `apps-script/Code.gs` — the complete Google Apps Script Drive API.
- `apps-script/appsscript.json` — Apps Script runtime settings.

## 1. Prepare the unused Google account

1. Sign in to the separate Google account that should own these PDFs.
2. Create a Drive folder, for example `Northstar Academy PDFs`.
3. Open the folder and copy its ID from the URL: `https://drive.google.com/drive/folders/<FOLDER_ID>`.
4. Open [script.google.com](https://script.google.com) while signed into that account and create a new standalone project.
5. Paste `apps-script/Code.gs` into the editor. In **Project Settings → General settings**, set the time zone to match your site. The included `appsscript.json` is the equivalent manifest if you use clasp.
6. The current `Code.gs` is already filled with the `Test-API` folder ID and PIN `0000`, so Script properties are optional. For a safer deployment, you can override those values in **Project Settings → Script properties**:

   | Property | Value |
   | --- | --- |
   | `DRIVE_FOLDER_ID` | The folder ID copied above |
   | `ADMIN_PIN` | A private demo PIN, such as `482913` |
   | `MAX_FILE_SIZE_MB` | `50` (optional; allowed range is 1–50) |

7. Click **Deploy → New deployment**. Select **Web app**, set **Execute as** to **Me** (the unused account), set **Who has access** to **Anyone**, then deploy and approve the Google permission prompts.
8. Copy the deployment URL ending in `/exec`. Do not use the `/dev` test URL.

The web app must run as the unused account so `DriveApp.getFolderById()` writes into that account's Drive. “Anyone” means the endpoint is reachable, but every write/list/delete request still needs the PIN checked by the script.

## 2. Connect the static frontend

Open `config.js` and set only the public endpoint:

```js
window.PAPERTRAIL_CONFIG = {
  appsScriptUrl: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
  maxFileSizeMb: 50,
  publicPdf: {
    title: 'Algebra · Linear equations',
    subject: 'Mathematics',
    description: 'A compact guide to balancing equations, spotting patterns, and showing your working clearly.',
    sizeBytes: 2480000,
    viewUrl: 'https://drive.google.com/file/d/FILE_ID/view',
    downloadUrl: 'https://drive.google.com/uc?export=download&id=FILE_ID'
  }
};
```

The admin enters the PIN in the dashboard at upload time. It is kept only in `sessionStorage` for the current browser tab; it is not in `config.js`. Replace the public PDF values after an upload if you want the public example to point at a real file. Make the Drive file viewable to the intended audience when publishing it; the script itself does not change file sharing permissions.

## 3. Run the demo locally

No Node.js, npm, database, or paid server is required. With Python installed, run from this folder:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/index.html`. With an empty `appsScriptUrl`, the dashboard uses local browser storage and temporary object URLs so the UI can be tried safely. Once the `/exec` URL is configured, uploads and metadata go to Drive.

## API examples

The browser uses URL-encoded POST requests (not JSON preflight) so it can call the Apps Script web app directly.

Health check:

```http
GET https://script.google.com/macros/s/DEPLOYMENT_ID/exec?action=health
```

Upload (the file is base64-encoded in `fileData`):

```http
POST /exec
Content-Type: application/x-www-form-urlencoded

action=upload&pin=482913&fileName=algebra.pdf&mimeType=application%2Fpdf&fileData=JVBERi0xLjQK...
```

Success response:

```json
{
  "ok": true,
  "file": {
    "id": "1AbC...",
    "name": "algebra.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 2480000,
    "uploadedAt": "2026-08-16T09:30:00.000Z",
    "viewUrl": "https://drive.google.com/file/d/1AbC.../view",
    "downloadUrl": "https://drive.google.com/uc?export=download&id=1AbC..."
  }
}
```

Other actions use the same POST shape: `action=list&pin=...` and `action=delete&pin=...&fileId=...`. Errors are always JSON, for example `{ "ok": false, "error": "Incorrect admin PIN." }`.

Access control uses `action=setaccess` with `scope=all`, `scope=selected` plus comma-separated `fileIds`, or `scope=file` plus one `fileId`. Set `accessMode=public` to use Drive's “Anyone with the link / Viewer” permission. Set `accessMode=private` with `allowlist=teacher@example.com,student@example.com` to remove link access and add only those people as Drive viewers. The same access fields are accepted by `action=upload`; a new upload defaults to private.

## Security and production notes

This PIN is intentionally a demo-level control, not a full identity system. Keep the deployment URL out of search results, use a long random PIN, and rotate it in Script properties. For a production system, replace the PIN check with your site's authenticated backend or an identity provider, add rate limiting, and move the metadata index from Script Properties to Firestore. The browser never receives Google credentials, OAuth tokens, or API keys.
