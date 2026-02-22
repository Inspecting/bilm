(function initBilmMediaCard(global) {
  const NO_IMAGE = 'https://via.placeholder.com/140x210?text=No+Image';

  function hasUsableImage(imageUrl) {
    if (!imageUrl) return false;
    const normalized = String(imageUrl).trim();
    if (!normalized || normalized === 'N/A') return false;
    return normalized !== NO_IMAGE;
  }

  function getTypeLabel(type) {
    if (type === 'movie') return 'Movie';
    if (type === 'tv') return 'TV Show';
    return 'Unknown';
  }

  function buildSubtitle(item, explicitSubtitle) {
    if (explicitSubtitle) return explicitSubtitle;
    const year = item?.year || 'N/A';
    const type = getTypeLabel(item?.type);
    return `${year} • ${type}`;
  }

  function buildRating(item) {
    const raw = item?.rating;
    const numeric = Number.parseFloat(String(raw ?? '').replace(/[^\d.]/g, ''));
    if (Number.isFinite(numeric) && numeric > 0) {
      return `${numeric.toFixed(1)}/10`;
    }
    return 'N/A';
  }

  function createMediaCard(config) {
    const {
      item,
      className = 'card',
      imageClassName = '',
      metaClassName = 'card-meta',
      titleClassName = 'card-title',
      subtitleClassName = 'card-subtitle',
      badgeClassName = 'source-badge-overlay',
      subtitleText,
      onClick,
      dataset = {}
    } = config || {};

    if (!item) {
      throw new Error('createMediaCard requires an item');
    }

    if (!hasUsableImage(item.img)) {
      return document.createDocumentFragment();
    }

    const card = document.createElement('div');
    card.className = className;

    const img = document.createElement('img');
    if (imageClassName) img.className = imageClassName;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = item.img;
    img.alt = item.title || 'Untitled';
    img.onerror = () => {
      card.remove();
    };

    const sourceBadge = document.createElement('span');
    sourceBadge.className = badgeClassName;
    sourceBadge.textContent = item.source || 'Unknown';

    const ratingBadge = document.createElement('span');
    ratingBadge.className = 'rating-badge-overlay';
    ratingBadge.textContent = buildRating(item);

    const badgeStack = document.createElement('div');
    badgeStack.className = 'card-badge-stack';
    badgeStack.appendChild(sourceBadge);
    badgeStack.appendChild(ratingBadge);

    const cardMeta = document.createElement('div');
    cardMeta.className = metaClassName;

    const title = document.createElement('p');
    title.className = titleClassName;
    title.textContent = item.title || 'Untitled';

    const subtitle = document.createElement('p');
    subtitle.className = subtitleClassName;
    subtitle.textContent = buildSubtitle(item, subtitleText);

    cardMeta.appendChild(title);
    cardMeta.appendChild(subtitle);

    card.appendChild(img);
    card.appendChild(badgeStack);
    card.appendChild(cardMeta);

    if (item.link || onClick) {
      card.onclick = onClick || (() => {
        window.location.href = item.link;
      });
    }

    Object.entries(dataset).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        card.dataset[key] = value;
      }
    });

    return card;
  }

  global.BilmMediaCard = {
    createMediaCard
  };
})(window);
