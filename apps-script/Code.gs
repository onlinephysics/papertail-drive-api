/**
 * Papertrail PDF Drive API
 *
 * Deploy this script as a Web app from the unused Google account that owns
 * the destination Drive folder. The demo configuration below is filled in
 * for the Test-API folder. It stays server-side and is never shipped to the
 * browser.
 *
 * You can edit DEMO_CONFIG directly, or override any value later with a
 * Script property of the same name (DRIVE_FOLDER_ID, ADMIN_PIN,
 * MAX_FILE_SIZE_MB).
 */

const INDEX_PROPERTY = 'PAPERTRAIL_PDF_INDEX';
const DEMO_CONFIG = {
  // Google Drive: My Drive > Test-API
  DRIVE_FOLDER_ID: 'XXXXXXXXXXXXXXXXXXXX',
  ADMIN_PIN: '0000',
  MAX_FILE_SIZE_MB: 50
};

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'health';
  try {
    if (action === 'health') return json_({ ok: true, service: 'papertrail-drive-api', configured: isConfigured_() });
    if (action === 'list') {
      requirePin_(e && e.parameter ? e.parameter.pin : '');
      return listFiles_();
    }
    return json_({ ok: false, error: 'Unknown action. Use health or list.' });
  } catch (error) {
    return errorResponse_(error);
  }
}

function doPost(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = String(params.action || '').toLowerCase();
    if (action === 'health') return json_({ ok: true, service: 'papertrail-drive-api', configured: isConfigured_() });
    requirePin_(params.pin);
    if (action === 'upload') return uploadFile_(params);
    if (action === 'list') return listFiles_();
    if (action === 'delete') return deleteFile_(params.fileId);
    if (action === 'setaccess') return setAccess_(params);
    return json_({ ok: false, error: 'Unknown action. Use upload, list, or delete.' });
  } catch (error) {
    return errorResponse_(error);
  }
}

function uploadFile_(params) {
  const fileName = cleanFileName_(params.fileName);
  const mimeType = String(params.mimeType || 'application/pdf').toLowerCase();
  const encodedData = String(params.fileData || '');
  const accessMode = normalizeAccessMode_(params.accessMode || 'private');
  const allowlist = parseEmails_(params.allowlist || '');
  if (!fileName) throw new Error('A file name is required.');
  if (mimeType !== 'application/pdf' && !fileName.toLowerCase().endsWith('.pdf')) throw new Error('Only PDF files are accepted.');
  if (!fileName.toLowerCase().endsWith('.pdf')) throw new Error('The file name must end with .pdf.');
  if (!encodedData) throw new Error('No file data was received.');

  const config = getConfig_();
  const bytes = Utilities.base64Decode(encodedData);
  const sizeBytes = bytes.length;
  const maxBytes = config.maxFileSizeMb * 1024 * 1024;
  if (sizeBytes > maxBytes) throw new Error(`The PDF is too large. Maximum size is ${config.maxFileSizeMb} MB.`);
  if (!looksLikePdf_(bytes)) throw new Error('The uploaded content is not a valid PDF file.');

  const blob = Utilities.newBlob(bytes, 'application/pdf', fileName);
  const driveFile = config.folder.createFile(blob);
  applyAccess_(driveFile, accessMode, allowlist);
  const now = new Date().toISOString();
  const metadata = makeMetadata_(driveFile, now, sizeBytes, accessMode, allowlist);
  const index = readIndex_();
  index[driveFile.getId()] = metadata;
  writeIndex_(index);
  driveFile.setDescription(`Papertrail metadata\n${JSON.stringify(metadata)}`);
  return json_({ ok: true, file: metadata });
}

function listFiles_() {
  const config = getConfig_();
  const index = readIndex_();
  const files = [];
  const iterator = config.folder.getFiles();
  while (iterator.hasNext()) {
    const file = iterator.next();
    if (file.getMimeType() !== MimeType.PDF) continue;
    const id = file.getId();
    const saved = index[id] || {};
    files.push({
      id: id,
      name: file.getName(),
      mimeType: file.getMimeType(),
      sizeBytes: file.getSize(),
      uploadedAt: saved.uploadedAt || file.getDateCreated().toISOString(),
      accessMode: saved.accessMode || 'private',
      allowlist: saved.allowlist || [],
      viewUrl: `https://drive.google.com/file/d/${id}/view`,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${id}`
    });
  }
  files.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  return json_({ ok: true, files: files });
}

function setAccess_(params) {
  const scope = String(params.scope || '').toLowerCase();
  const accessMode = normalizeAccessMode_(params.accessMode || 'private');
  const allowlist = parseEmails_(params.allowlist || '');
  const config = getConfig_();
  const files = [];
  const iterator = config.folder.getFiles();
  const requestedIds = String(params.fileIds || '').split(',').map(function (id) { return id.trim(); }).filter(Boolean);
  const requestedId = String(params.fileId || '').trim();

  while (iterator.hasNext()) {
    const file = iterator.next();
    if (file.getMimeType() !== MimeType.PDF) continue;
    if (scope === 'all' || (scope === 'selected' && requestedIds.indexOf(file.getId()) !== -1) || (scope === 'file' && file.getId() === requestedId)) files.push(file);
  }
  if (!files.length) throw new Error('No PDF files matched this access scope.');

  const index = readIndex_();
  const failures = [];
  files.forEach(function (file) {
    try {
      applyAccess_(file, accessMode, allowlist);
      const saved = index[file.getId()] || makeMetadata_(file, new Date().toISOString(), file.getSize(), accessMode, allowlist);
      saved.accessMode = accessMode;
      saved.allowlist = allowlist;
      index[file.getId()] = saved;
    } catch (error) {
      failures.push(`${file.getName()}: ${error.message}`);
    }
  });
  writeIndex_(index);
  if (failures.length) throw new Error(`Some permissions could not be updated. ${failures.join(' | ')}`);
  return json_({ ok: true, updated: files.map(function (file) { return file.getId(); }), accessMode: accessMode, allowlist: allowlist });
}

function deleteFile_(fileId) {
  const id = String(fileId || '').trim();
  if (!id) throw new Error('A file ID is required.');
  const config = getConfig_();
  const file = DriveApp.getFileById(id);
  const parents = file.getParents();
  let belongsToFolder = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === config.folder.getId()) belongsToFolder = true;
  }
  if (!belongsToFolder) throw new Error('That file is not in the configured PDF folder.');
  file.setTrashed(true);
  const index = readIndex_();
  delete index[id];
  writeIndex_(index);
  return json_({ ok: true, deletedId: id });
}

function makeMetadata_(file, uploadedAt, sizeBytes, accessMode, allowlist) {
  const id = file.getId();
  return {
    id: id,
    name: file.getName(),
    mimeType: 'application/pdf',
    sizeBytes: sizeBytes,
    uploadedAt: uploadedAt,
    accessMode: accessMode || 'private',
    allowlist: allowlist || [],
    viewUrl: `https://drive.google.com/file/d/${id}/view`,
    downloadUrl: `https://drive.google.com/uc?export=download&id=${id}`
  };
}

function normalizeAccessMode_(value) {
  const mode = String(value || 'private').toLowerCase();
  if (mode !== 'public' && mode !== 'private') throw new Error('Access mode must be public or private.');
  return mode;
}

function parseEmails_(value) {
  const raw = String(value || '').split(/[\s,;]+/).map(function (email) { return email.trim().toLowerCase(); }).filter(Boolean);
  const unique = raw.filter(function (email, index) { return raw.indexOf(email) === index; });
  const invalid = unique.filter(function (email) { return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); });
  if (invalid.length) throw new Error(`Invalid email address: ${invalid[0]}`);
  if (unique.length > 100) throw new Error('A maximum of 100 whitelist addresses is allowed.');
  return unique;
}

function applyAccess_(file, accessMode, allowlist) {
  if (accessMode === 'public') {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return;
  }
  // PRIVATE removes link-based access; VIEW is the required companion enum
  // for File.setSharing (Permission.NONE cannot be set with Access.PRIVATE).
  file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
  // Remove existing direct collaborators so the supplied whitelist is exact.
  file.getViewers().forEach(function (user) {
    try { file.removeViewer(user.getEmail()); } catch (_) {}
  });
  file.getEditors().forEach(function (user) {
    try { file.removeEditor(user.getEmail()); } catch (_) {}
  });
  allowlist.forEach(function (email) { file.addViewer(email); });
}

function looksLikePdf_(bytes) {
  if (!bytes || bytes.length < 5) return false;
  return bytes.slice(0, 5).map(function (value) { return value < 0 ? value + 256 : value; }).join(',') === '37,80,68,70,45';
}

function getConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const folderId = String(properties.getProperty('DRIVE_FOLDER_ID') || DEMO_CONFIG.DRIVE_FOLDER_ID).trim();
  const adminPin = String(properties.getProperty('ADMIN_PIN') || DEMO_CONFIG.ADMIN_PIN).trim();
  const maxFileSizeMb = Number(properties.getProperty('MAX_FILE_SIZE_MB') || DEMO_CONFIG.MAX_FILE_SIZE_MB);
  if (!folderId) throw new Error('Server is not configured: add DRIVE_FOLDER_ID in Script properties.');
  if (!adminPin) throw new Error('Server is not configured: add ADMIN_PIN in Script properties.');
  if (!Number.isFinite(maxFileSizeMb) || maxFileSizeMb <= 0 || maxFileSizeMb > 50) throw new Error('MAX_FILE_SIZE_MB must be between 1 and 50.');
  let folder;
  try { folder = DriveApp.getFolderById(folderId); } catch (_) { throw new Error('The configured Drive folder could not be opened. Check its ID and account.'); }
  return { folder: folder, adminPin: adminPin, maxFileSizeMb: maxFileSizeMb };
}

function isConfigured_() {
  const properties = PropertiesService.getScriptProperties();
  return Boolean(
    properties.getProperty('DRIVE_FOLDER_ID') || DEMO_CONFIG.DRIVE_FOLDER_ID
  ) && Boolean(
    properties.getProperty('ADMIN_PIN') || DEMO_CONFIG.ADMIN_PIN
  );
}

function requirePin_(providedPin) {
  const config = getConfig_();
  if (!providedPin || String(providedPin) !== config.adminPin) throw new Error('Incorrect admin PIN.');
}

function cleanFileName_(value) {
  return String(value || '').replace(/[\\/:*?"<>|\x00-\x1F]/g, '-').trim().slice(0, 180);
}

function readIndex_() {
  const raw = PropertiesService.getScriptProperties().getProperty(INDEX_PROPERTY);
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch (_) { return {}; }
}

function writeIndex_(index) {
  PropertiesService.getScriptProperties().setProperty(INDEX_PROPERTY, JSON.stringify(index));
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function errorResponse_(error) {
  return json_({ ok: false, error: error && error.message ? error.message : 'Unexpected server error.' });
}
