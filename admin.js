(function () {
  'use strict';

  const config = window.PAPERTRAIL_CONFIG || {};
  const endpoint = String(config.appsScriptUrl || '').trim();
  const maxBytes = (Number(config.maxFileSizeMb) || 10) * 1024 * 1024;
  const demoKey = 'papertrail-demo-files';
  const state = { files: [], selectedFile: null, deletingId: null, busy: false };
  const $ = (id) => document.getElementById(id);

  const elements = {
    fileInput: $('file-input'), dropZone: $('drop-zone'), chooseFile: $('choose-file'), clearFile: $('clear-file'), selectedFile: $('selected-file'), selectedName: $('selected-name'), selectedSize: $('selected-size'), fileHint: $('file-hint'), pin: $('admin-pin'), upload: $('upload-button'), uploadAccess: $('upload-access-mode'), progress: $('progress-wrap'), progressFill: $('progress-fill'), progressLabel: $('progress-label'), progressValue: $('progress-value'), status: $('status-message'), list: $('file-list'), empty: $('empty-state'), refresh: $('refresh-button'), count: $('file-count'), navCount: $('nav-count'), storageUsed: $('storage-used'), storageFill: $('storage-meter-fill'), statFiles: $('stat-files'), statStorage: $('stat-storage'), statLast: $('stat-last'), libraryStatus: $('library-status'), connection: $('connection-pill'), backdrop: $('modal-backdrop'), modalCopy: $('modal-copy'), modalClose: $('modal-close'), modalCancel: $('modal-cancel'), modalConfirm: $('modal-confirm'), accessTabs: document.querySelectorAll('[data-access-scope]'), accessViewTabs: document.querySelectorAll('[data-access-view]'), accessRulesView: $('access-rules-view'), recordsView: $('records-view'), suggestionsView: $('suggestions-view'), recordsCount: $('records-count'), suggestionsCount: $('suggestions-count'), recordsList: $('records-list'), recordsEmpty: $('records-empty'), recordsStatus: $('records-status'), recordsRefresh: $('records-refresh'), suggestionsList: $('suggestions-list'), suggestionsEmpty: $('suggestions-empty'), suggestionsStatus: $('suggestions-status'), accessTitle: $('access-scope-title'), accessCopy: $('access-scope-copy'), accessMode: $('access-mode'), allowlist: $('allowlist-emails'), accessFilePicker: $('access-file-picker'), accessFileId: $('access-file-id'), accessSelectedList: $('access-selected-list'), applyAccess: $('apply-access'), accessStatus: $('access-status')
  };

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (!value) return '0 KB';
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
    return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  }
  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
  function setStatus(message, type) { elements.status.textContent = message || ''; elements.status.className = `status-message${type ? ` ${type}` : ''}`; }
  function setConnection(label, connected) { elements.connection.innerHTML = `<i></i> ${escapeHtml(label)}`; elements.connection.classList.toggle('connected', Boolean(connected)); }
  function localFiles() { try { return JSON.parse(localStorage.getItem(demoKey) || '[]'); } catch (_) { return []; } }
  function saveLocalFiles() { localStorage.setItem(demoKey, JSON.stringify(state.files)); }

  async function api(action, data = {}) {
    if (!endpoint) throw new Error('Apps Script endpoint is not configured. The page is in local preview mode.');
    const body = new URLSearchParams({ action, ...data });
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function render() {
    const totalBytes = state.files.reduce((sum, file) => sum + (Number(file.sizeBytes || file.size) || 0), 0);
    elements.count.textContent = state.files.length; elements.navCount.textContent = state.files.length; elements.statFiles.textContent = state.files.length; elements.storageUsed.textContent = formatBytes(totalBytes); elements.statStorage.innerHTML = `${(totalBytes / 1024 / 1024).toFixed(1)} <small>MB</small>`; elements.storageFill.style.width = `${Math.min(100, totalBytes / (100 * 1024 * 1024) * 100)}%`;
    elements.statLast.textContent = state.files[0] ? formatDate(state.files[0].uploadedAt || state.files[0].createdAt) : '—'; elements.libraryStatus.textContent = state.files.length ? `${state.files.length} PDF${state.files.length === 1 ? '' : 's'} ready to share` : 'Ready for your first upload';
    elements.empty.hidden = state.files.length > 0;
    elements.list.innerHTML = state.files.map((file) => `<div class="file-row"><div class="file-name-cell"><span class="file-badge">PDF</span><div><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><small>${escapeHtml(file.mimeType || 'application/pdf')} · <span class="access-badge ${file.accessMode === 'public' ? 'public' : 'private'}">${file.accessMode === 'public' ? 'Public link' : 'Private'}</span></small></div></div><span class="file-size">${formatBytes(file.sizeBytes || file.size)}</span><span class="file-date">${formatDate(file.uploadedAt || file.createdAt)}</span><div class="row-actions"><a class="row-button view" href="${escapeHtml(file.viewUrl || '#')}" target="_blank" rel="noopener">View <span>↗</span></a><a class="row-button download" href="${escapeHtml(file.downloadUrl || file.viewUrl || '#')}" target="_blank" rel="noopener" download>↓</a><button class="row-button delete" data-delete-id="${escapeHtml(file.id)}" type="button" aria-label="Delete ${escapeHtml(file.name)}">×</button></div></div>`).join('');
    elements.list.querySelectorAll('[data-delete-id]').forEach((button) => button.addEventListener('click', () => openDelete(button.dataset.deleteId)));
    renderAccessChoices();
  }

  async function loadFiles() {
    setConnection(endpoint ? 'Connecting to Drive' : 'Local preview mode', Boolean(endpoint));
    if (!endpoint) { state.files = localFiles(); render(); return; }
    if (!getPin()) { setConnection('PIN required', false); state.files = []; render(); setStatus('Enter the admin PIN, then refresh the library.', ''); return; }
    try { const result = await api('list', { pin: getPin() }); state.files = result.files || []; setConnection('Drive connected', true); render(); setStatus(''); }
    catch (error) { setConnection('Connection needs setup', false); state.files = []; render(); setStatus(error.message, 'error'); }
  }
  function getPin() { return elements.pin.value.trim() || sessionStorage.getItem('papertrail-admin-pin') || ''; }
  function validateFile(file) {
    if (!file) return 'Choose a PDF file first.';
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return 'Only PDF files are accepted.';
    if (file.size > maxBytes) return `This file is ${formatBytes(file.size)}. The limit is ${config.maxFileSizeMb || 10} MB.`;
    return '';
  }
  function choose(file) {
    const error = validateFile(file); if (error) { setStatus(error, 'error'); return; }
    state.selectedFile = file; elements.selectedName.textContent = file.name; elements.selectedSize.textContent = formatBytes(file.size); elements.selectedFile.hidden = false; elements.dropZone.classList.add('has-file'); elements.upload.disabled = false; elements.fileHint.textContent = 'Ready to upload'; setStatus('');
  }
  function clearSelected() { state.selectedFile = null; elements.fileInput.value = ''; elements.selectedFile.hidden = true; elements.dropZone.classList.remove('has-file'); elements.upload.disabled = true; elements.fileHint.textContent = `Only PDF files are accepted · Max ${config.maxFileSizeMb || 10} MB`; }
  function toBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('Could not read this file.')); reader.readAsDataURL(file); }); }
  async function uploadFile() {
    const file = state.selectedFile; const validation = validateFile(file); if (validation) { setStatus(validation, 'error'); return; }
    const pin = getPin(); if (!pin) { setStatus('Enter the admin PIN to continue.', 'error'); elements.pin.focus(); return; }
    state.busy = true; elements.upload.disabled = true; elements.progress.hidden = false; elements.progressFill.style.width = '12%'; elements.progressValue.textContent = '12%'; elements.progressLabel.textContent = 'Preparing PDF…'; setStatus('');
    try {
      const base64 = await toBase64(file); elements.progressFill.style.width = '48%'; elements.progressValue.textContent = '48%'; elements.progressLabel.textContent = 'Sending to Drive…';
      if (!endpoint) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const now = new Date().toISOString(); state.files.unshift({ id: `demo-${Date.now()}`, name: file.name, mimeType: 'application/pdf', sizeBytes: file.size, uploadedAt: now, accessMode: elements.uploadAccess.value, allowlist: [], viewUrl: URL.createObjectURL(file), downloadUrl: URL.createObjectURL(file) }); saveLocalFiles();
      } else { const result = await api('upload', { pin, fileName: file.name, mimeType: 'application/pdf', accessMode: elements.uploadAccess.value, allowlist: '', fileData: base64 }); state.files.unshift(result.file); sessionStorage.setItem('papertrail-admin-pin', pin); }
      elements.progressFill.style.width = '100%'; elements.progressValue.textContent = '100%'; elements.progressLabel.textContent = 'Uploaded'; render(); clearSelected(); setStatus(`${file.name} is now in your Drive folder.`, 'success');
    } catch (error) { setStatus(error.message, 'error'); } finally { state.busy = false; setTimeout(() => { elements.progress.hidden = true; elements.progressFill.style.width = '0%'; }, 900); elements.upload.disabled = !state.selectedFile; }
  }
  function openDelete(id) { const file = state.files.find((item) => item.id === id); if (!file) return; state.deletingId = id; elements.modalCopy.textContent = `“${file.name}” will be removed from your Drive folder. This action cannot be undone.`; elements.backdrop.hidden = false; elements.modalConfirm.focus(); }
  function closeDelete() { elements.backdrop.hidden = true; state.deletingId = null; }
  async function deleteFile() { const id = state.deletingId; if (!id) return; const file = state.files.find((item) => item.id === id); elements.modalConfirm.disabled = true; try { if (endpoint) await api('delete', { pin: getPin(), fileId: id }); state.files = state.files.filter((item) => item.id !== id); if (!endpoint) saveLocalFiles(); closeDelete(); render(); setStatus(`${file ? file.name : 'File'} deleted.`, 'success'); } catch (error) { setStatus(error.message, 'error'); } finally { elements.modalConfirm.disabled = false; } }

  const accessCopy = { all: ['For all PDFs', 'Choose who can open every PDF currently in your Test-API folder.'], selected: ['For selected PDFs', 'Choose several files below, then apply one sharing rule to them.'], file: ['For this PDF', 'Change the sharing rule for one specific PDF.'] };
  let accessScope = 'all';
  function renderAccessChoices() {
    const detail = accessCopy[accessScope]; elements.accessTitle.textContent = detail[0]; elements.accessCopy.textContent = detail[1];
    elements.accessFilePicker.hidden = accessScope !== 'file'; elements.accessSelectedList.hidden = accessScope !== 'selected';
    elements.accessFileId.innerHTML = state.files.length ? state.files.map((file) => `<option value="${escapeHtml(file.id)}">${escapeHtml(file.name)}</option>`).join('') : '<option value="">No PDFs uploaded yet</option>';
    elements.accessSelectedList.innerHTML = state.files.length ? state.files.map((file) => `<label class="access-file-check"><input type="checkbox" value="${escapeHtml(file.id)}" checked /><span title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span></label>`).join('') : '<span class="access-empty">Upload a PDF before choosing selected access.</span>';
    syncSelectedAccessDetails();
  }
  function syncSelectedAccessDetails() { if (accessScope !== 'file') return; const file = state.files.find((item) => item.id === elements.accessFileId.value); if (file) { elements.accessMode.value = file.accessMode || 'private'; elements.allowlist.value = (file.allowlist || []).join('\n'); } }
  function selectAccessScope(scope) { accessScope = scope; elements.accessTabs.forEach((tab) => { const active = tab.dataset.accessScope === scope; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', active ? 'true' : 'false'); }); renderAccessChoices(); }
  function setAccessStatus(message, type) { elements.accessStatus.textContent = message || ''; elements.accessStatus.className = `status-message${type ? ` ${type}` : ''}`; }
  async function applyAccessRule() {
    const pin = getPin(); if (!pin) { setAccessStatus('Enter the admin PIN before changing sharing rules.', 'error'); elements.pin.focus(); return; }
    const fileIds = accessScope === 'selected' ? Array.from(elements.accessSelectedList.querySelectorAll('input:checked')).map((input) => input.value) : [];
    const fileId = accessScope === 'file' ? elements.accessFileId.value : '';
    if (accessScope === 'selected' && !fileIds.length) { setAccessStatus('Select at least one PDF.', 'error'); return; }
    if (accessScope === 'file' && !fileId) { setAccessStatus('Choose a PDF first.', 'error'); return; }
    const allowlist = elements.allowlist.value;
    elements.applyAccess.disabled = true; setAccessStatus('Applying Drive permissions…');
    try {
      if (endpoint) await api('setaccess', { pin, scope: accessScope, accessMode: elements.accessMode.value, allowlist, fileIds: fileIds.join(','), fileId });
      else {
        const targets = accessScope === 'all' ? state.files : state.files.filter((file) => accessScope === 'file' ? file.id === fileId : fileIds.indexOf(file.id) !== -1);
        targets.forEach((file) => { file.accessMode = elements.accessMode.value; file.allowlist = allowlist.split(/[\s,;]+/).map((email) => email.trim()).filter(Boolean); }); saveLocalFiles();
      }
      sessionStorage.setItem('papertrail-admin-pin', pin); await loadFiles(); setAccessStatus(`Access updated for ${accessScope === 'all' ? 'all PDFs' : accessScope === 'file' ? 'this PDF' : 'selected PDFs'}.`, 'success');
    } catch (error) { setAccessStatus(error.message, 'error'); } finally { elements.applyAccess.disabled = false; }
  }

  let accessView = 'rules';
  function setAccessView(view) {
    accessView = view;
    elements.accessViewTabs.forEach((tab) => { const active = tab.dataset.accessView === view; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', active ? 'true' : 'false'); });
    elements.accessRulesView.hidden = view !== 'rules'; elements.recordsView.hidden = view !== 'records'; elements.suggestionsView.hidden = view !== 'suggestions';
    if (view === 'records') renderRecords();
    if (view === 'suggestions') renderSuggestions();
  }
  function accessLabel(file) { return file.accessMode === 'public' ? 'Public link' : 'Private'; }
  function emailsLabel(file) { const emails = file.allowlist || []; return emails.length ? emails.join(', ') : 'Owner only'; }
  function renderRecords() {
    elements.recordsCount.textContent = state.files.length;
    elements.recordsEmpty.hidden = state.files.length > 0;
    elements.recordsList.innerHTML = state.files.map((file) => `<div class="record-row"><div class="record-file"><span class="file-badge">PDF</span><div><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><small>${formatBytes(file.sizeBytes || file.size)} · ${formatDate(file.uploadedAt || file.createdAt)}</small></div></div><span class="record-visibility ${file.accessMode === 'public' ? 'public' : 'private'}">${accessLabel(file)}</span><span class="record-viewers" title="${escapeHtml(emailsLabel(file))}">${escapeHtml(emailsLabel(file))}</span><button class="row-button" data-edit-record="${escapeHtml(file.id)}" type="button">Edit</button></div>`).join('');
    elements.recordsList.querySelectorAll('[data-edit-record]').forEach((button) => button.addEventListener('click', () => editRecord(button.dataset.editRecord)));
  }
  function editRecord(id) {
    setAccessView('rules'); selectAccessScope('file'); elements.accessFileId.value = id; syncSelectedAccessDetails(); document.getElementById('access').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function recordKey(name) { return String(name || '').toLowerCase().replace(/\.pdf$/i, '').replace(/\b(copy|final|v\d+|version\s*\d+)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function getSuggestions() { const groups = {}; state.files.forEach((file) => { const key = recordKey(file.name); if (key) (groups[key] ||= []).push(file); }); return Object.entries(groups).filter((entry) => entry[1].length > 1).map(([key, files]) => ({ key, files })); }
  function renderSuggestions() {
    const suggestions = getSuggestions(); elements.suggestionsCount.textContent = suggestions.length; elements.suggestionsEmpty.hidden = suggestions.length > 0;
    elements.suggestionsList.innerHTML = suggestions.map((suggestion, index) => { const [first, second] = suggestion.files; const combined = [...new Set([...(first.allowlist || []), ...(second.allowlist || [])])]; return `<div class="suggestion-card"><div class="suggestion-copy"><span class="section-kicker">SUGGESTION ${String(index + 1).padStart(2, '0')}</span><h4>Similar records: ${escapeHtml(suggestion.key)}</h4><p>${suggestion.files.length} PDFs share a similar name. Their combined whitelist contains ${combined.length} viewer${combined.length === 1 ? '' : 's'}.</p><div class="suggestion-files">${suggestion.files.map((file) => `<span><b>PDF</b>${escapeHtml(file.name)}</span>`).join('')}</div></div><button class="secondary-button" data-merge-suggestion="${escapeHtml(suggestion.files.map((file) => file.id).join(','))}" type="button">Merge access rules</button></div>`; }).join('');
    elements.suggestionsList.querySelectorAll('[data-merge-suggestion]').forEach((button) => button.addEventListener('click', () => mergeSuggestion(button.dataset.mergeSuggestion.split(','))));
  }
  async function mergeSuggestion(ids) {
    const files = state.files.filter((file) => ids.indexOf(file.id) !== -1); const allowlist = [...new Set(files.flatMap((file) => file.allowlist || []))]; if (files.length < 2) return;
    elements.suggestionsStatus.textContent = 'Merging access rules…';
    try {
      if (endpoint) await api('setaccess', { pin: getPin(), scope: 'selected', accessMode: 'private', allowlist: allowlist.join(','), fileIds: ids.join(',') });
      else { files.forEach((file) => { file.accessMode = 'private'; file.allowlist = allowlist; }); saveLocalFiles(); }
      await loadFiles(); renderSuggestions(); elements.suggestionsStatus.className = 'status-message success'; elements.suggestionsStatus.textContent = 'Access rules merged. The original PDFs remain separate.';
    } catch (error) { elements.suggestionsStatus.className = 'status-message error'; elements.suggestionsStatus.textContent = error.message; }
  }

  elements.chooseFile.addEventListener('click', () => elements.fileInput.click()); elements.dropZone.addEventListener('click', (event) => { if (event.target.closest('button')) return; elements.fileInput.click(); }); elements.dropZone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); elements.fileInput.click(); } }); elements.fileInput.addEventListener('change', () => choose(elements.fileInput.files[0])); elements.clearFile.addEventListener('click', clearSelected); elements.upload.addEventListener('click', uploadFile); elements.refresh.addEventListener('click', loadFiles); elements.modalClose.addEventListener('click', closeDelete); elements.modalCancel.addEventListener('click', closeDelete); elements.modalConfirm.addEventListener('click', deleteFile); elements.backdrop.addEventListener('click', (event) => { if (event.target === elements.backdrop) closeDelete(); }); elements.pin.addEventListener('input', () => { if (elements.pin.value) setStatus(''); }); elements.pin.addEventListener('change', () => { if (endpoint && elements.pin.value.trim()) loadFiles(); }); elements.accessTabs.forEach((tab) => tab.addEventListener('click', () => selectAccessScope(tab.dataset.accessScope))); elements.accessFileId.addEventListener('change', syncSelectedAccessDetails); elements.applyAccess.addEventListener('click', applyAccessRule); elements.accessViewTabs.forEach((tab) => tab.addEventListener('click', () => setAccessView(tab.dataset.accessView))); elements.recordsRefresh.addEventListener('click', loadFiles);
  ['dragenter', 'dragover'].forEach((eventName) => elements.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); elements.dropZone.classList.add('dragging'); })); ['dragleave', 'drop'].forEach((eventName) => elements.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); elements.dropZone.classList.remove('dragging'); })); elements.dropZone.addEventListener('drop', (event) => choose(event.dataTransfer.files[0]));
  selectAccessScope('all'); loadFiles();
}());
