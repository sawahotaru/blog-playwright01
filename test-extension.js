const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const extensionPath = path.join(__dirname, 'my-extension');

  const context = await chromium.launchPersistentContext('', {
    headless: false, // 拡張はheadlessでは不安定なのでfalse
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

  console.log('popup opened. try clicking the buttons!');
})();
