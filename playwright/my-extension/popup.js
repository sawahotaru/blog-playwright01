document.getElementById('open-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://playwright.dev' });
});

document.getElementById('close-btn').addEventListener('click', () => {
  window.close();
});
