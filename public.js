(function () {
  const config = window.PAPERTRAIL_CONFIG || {}; const pdf = config.publicPdf || {}; const $ = (id) => document.getElementById(id);
  $('public-title').textContent = pdf.title || 'PDF resource'; $('public-subject').textContent = pdf.subject || 'General'; $('public-description').textContent = pdf.description || 'A helpful resource from the academy library.'; $('public-size').textContent = formatBytes(pdf.sizeBytes); $('public-view').href = pdf.viewUrl || '#'; $('public-download').href = pdf.downloadUrl || pdf.viewUrl || '#';
  function formatBytes(bytes) { const value = Number(bytes) || 0; if (!value) return 'Size not provided'; if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
}());
