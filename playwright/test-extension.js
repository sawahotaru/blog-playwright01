const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const extensionPath = path.join(__dirname, 'my-extension');

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const serviceWorker =
    context.serviceWorkers()[0] ||
    await context.waitForEvent('serviceworker');

  // 拡張IDをservice worker URLから取得
  const extensionId = serviceWorker.url().split('/')[2];
  console.log('extension id:', extensionId);

  // ポップアップを開く
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  // 「Playwright公式を開く」ボタンを待つだけで、操作はしない
  // ブラウザ上で手動で触ってみてください
  console.log('popup opened. try clicking the buttons!');
})();
