from pathlib import Path
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).parent
fixture = ROOT / "smoke-fixture.pdf"
fixture.write_bytes(b"%PDF-1.4\n% papertrail smoke fixture\n")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.add_init_script("""
        (() => {
          const files = [];
          window.fetch = async (_url, options = {}) => {
            const params = new URLSearchParams(options.body || '');
            const action = params.get('action');
            if (action === 'upload') {
              const file = { id: 'mock-1', name: params.get('fileName'), mimeType: 'application/pdf', sizeBytes: 38, uploadedAt: new Date().toISOString(), accessMode: params.get('accessMode') || 'private', allowlist: [], viewUrl: '#', downloadUrl: '#' };
              files.unshift(file);
              return { ok: true, json: async () => ({ ok: true, file }) };
            }
            if (action === 'setaccess') {
              files.forEach((file) => { file.accessMode = params.get('accessMode'); });
              return { ok: true, json: async () => ({ ok: true }) };
            }
            return { ok: true, json: async () => ({ ok: true, files }) };
          };
        })();
    """)
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.goto((ROOT / "index.html").as_uri())
    page.wait_for_load_state("networkidle")
    assert "Papertrail" in page.title()
    assert page.locator("text=Drive connected").count() == 1
    assert page.locator("#empty-state").is_visible()
    page.locator("#file-input").set_input_files(str(fixture))
    assert page.locator("#selected-file").is_visible()
    assert page.locator("#upload-button").is_enabled()
    page.locator("#admin-pin").fill("demo")
    page.locator("#upload-button").click()
    page.wait_for_timeout(900)
    assert page.locator("#file-list .file-row").count() >= 1
    assert page.locator("#file-list").inner_text().find("smoke-fixture.pdf") >= 0
    page.locator("[data-access-scope='selected']").click()
    assert page.locator("text=For selected PDFs").count() >= 1
    page.locator("#access-mode").select_option("public")
    page.locator("#apply-access").click()
    page.wait_for_timeout(300)
    assert page.locator("#access-status").inner_text().find("Access updated") >= 0
    page.locator("[data-access-view='records']").click()
    assert page.locator("#records-list .record-row").count() >= 1
    page.locator("[data-access-view='suggestions']").click()
    assert page.locator("text=No merge suggestions.").count() == 1

    public = browser.new_page(viewport={"width": 1280, "height": 900})
    public.goto((ROOT / "public.html").as_uri())
    public.wait_for_load_state("networkidle")
    assert "Northstar Academy" in public.title()
    assert public.locator("text=View PDF").count() == 1
    assert public.locator("text=Admin sign in").count() == 1
    assert public.locator("text=Admin PIN").count() == 0
    browser.close()

if errors:
    raise AssertionError(f"Console errors: {errors}")
print("Smoke test passed")
