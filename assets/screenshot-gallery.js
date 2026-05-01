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
        <button class="screenshot-dialog-nav screenshot-dialog-prev" type="button" aria-label="前の画像へ">&#8249;</button>
        <img alt="">
        <button class="screenshot-dialog-nav screenshot-dialog-next" type="button" aria-label="次の画像へ">&#8250;</button>
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

    let currentIndex = 0;
    let dialog = null;
    const move = offset => {
      openAt(currentIndex + offset);
    };
    const openAt = index => {
      currentIndex = (index + screenshots.length) % screenshots.length;
      const shot = screenshots[currentIndex];
      if (!dialog) {
        dialog = buildDialog();
        dialog.querySelector('.screenshot-dialog-prev').addEventListener('click', event => {
          event.stopPropagation();
          move(-1);
        });
        dialog.querySelector('.screenshot-dialog-next').addEventListener('click', event => {
          event.stopPropagation();
          move(1);
        });
        dialog.querySelector('img').addEventListener('click', () => {
          if (screenshots.length > 1) move(1);
        });
        dialog.addEventListener('keydown', event => {
          if (event.key === 'ArrowLeft') move(-1);
          if (event.key === 'ArrowRight') move(1);
        });
      }

      dialog.querySelector('.screenshot-dialog-title').textContent =
        `${shot.title} (${currentIndex + 1}/${screenshots.length})`;
      const image = dialog.querySelector('img');
      image.src = shot.src;
      image.alt = shot.alt;
      dialog.querySelectorAll('.screenshot-dialog-nav').forEach(button => {
        button.hidden = screenshots.length < 2;
      });
      if (!dialog.open) dialog.showModal();
    };

    const gallery = document.createElement('div');
    gallery.className = 'screenshot-gallery';
    gallery.innerHTML = `
      <p class="screenshot-gallery-title">画面プレビュー</p>
      <div class="screenshot-strip"></div>
    `;

    const strip = gallery.querySelector('.screenshot-strip');
    for (const [index, shot] of screenshots.entries()) {
      const button = document.createElement('button');
      button.className = 'screenshot-thumb';
      button.type = 'button';
      button.innerHTML = `
        <img src="${escapeHtml(shot.thumb)}" alt="${escapeHtml(shot.alt)}" loading="lazy">
        <span>${escapeHtml(shot.title)}</span>
      `;
      button.addEventListener('click', () => openAt(index));
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
