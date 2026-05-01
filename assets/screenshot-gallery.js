(function () {
  async function loadScreenshots() {
    try {
      const response = await fetch('./screenshots/screenshots.json', { cache: 'no-store' });
      if (!response.ok) return [];
      const data = await response.json();
      const items = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(items)) return [];
      return items
        .filter(item => item && item.src)
        .map(item => ({
          title: String(item.title || item.alt || 'スクリーンショット'),
          alt: String(item.alt || item.title || 'スクリーンショット'),
          src: String(item.src),
          thumb: String(item.thumb || item.src),
        }));
    } catch (_) {
      return [];
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildDialog() {
    const dialog = document.createElement('dialog');
    dialog.className = 'screenshot-dialog';
    dialog.innerHTML = `
      <div class="screenshot-dialog-header">
        <p class="screenshot-dialog-title"></p>
        <button class="screenshot-dialog-close" type="button" aria-label="閉じる">&times;</button>
      </div>
      <div class="screenshot-dialog-body">
        <img alt="">
      </div>
    `;
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
    dialog.querySelector('.screenshot-dialog-close').addEventListener('click', () => dialog.close());
    document.body.appendChild(dialog);
    return dialog;
  }

  async function init() {
    const hero = document.querySelector('.hero');
    const sub = hero?.querySelector('.sub');
    if (!hero || !sub) return;

    const screenshots = await loadScreenshots();
    if (screenshots.length === 0) return;

    const gallery = document.createElement('div');
    gallery.className = 'screenshot-gallery';
    gallery.innerHTML = `
      <p class="screenshot-gallery-title">画面プレビュー</p>
      <div class="screenshot-strip"></div>
    `;

    const strip = gallery.querySelector('.screenshot-strip');
    for (const shot of screenshots) {
      const button = document.createElement('button');
      button.className = 'screenshot-thumb';
      button.type = 'button';
      button.innerHTML = `
        <img src="${escapeHtml(shot.thumb)}" alt="${escapeHtml(shot.alt)}" loading="lazy">
        <span>${escapeHtml(shot.title)}</span>
      `;
      button.addEventListener('click', () => {
        const dialog = document.querySelector('.screenshot-dialog') || buildDialog();
        dialog.querySelector('.screenshot-dialog-title').textContent = shot.title;
        const image = dialog.querySelector('img');
        image.src = shot.src;
        image.alt = shot.alt;
        if (!dialog.open) dialog.showModal();
      });
      strip.appendChild(button);
    }

    sub.insertAdjacentElement('afterend', gallery);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
