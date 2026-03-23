# playwright-extension-sample

PlaywrightでChrome拡張を読み込み、ポップアップからPlaywright公式サイトを開くサンプルです。

## 構成

```
.
├── my-extension/
│   ├── manifest.json
│   ├── background.js
│   ├── popup.html
│   └── popup.js
├── test-extension.js
└── package.json
```

## 前提

- Node.js がインストールされていること

## セットアップ

```bash
npm install
npx playwright install chromium
```

`npm install` でライブラリが入りますが、ブラウザ本体は別途ダウンロードが必要です。  
`npx playwright install chromium` を忘れると `Executable doesn't exist` エラーになります。

## 実行

```bash
node test-extension.js
```

Chromiumが起動し、拡張のポップアップが表示されます。

- **「Playwright公式を開く」** → 新しいタブで [playwright.dev](https://playwright.dev) が開きます
- **「閉じる」** → ポップアップが閉じます

## 注意点

Google Chrome / Microsoft Edge では拡張のサイドロードに必要なフラグが使えないため、Playwright同梱の Chromium を使っています。

## 参考

- [Playwright 公式ドキュメント - Chrome extensions](https://playwright.dev/docs/chrome-extensions)
