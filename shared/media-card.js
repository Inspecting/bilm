(function initBilmMediaCard(global) {
  const NO_IMAGE = 'https://via.placeholder.com/140x210?text=No+Image';
  const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
  const certificationCache = new Map();
  const certificationPending = new Map();

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
    const certification = formatCertification(item?.certification);
    return [year, type, certification].filter(Boolean).join(' • ');
  }

  function formatCertification(value) {
    const normalized = String(value || '').trim();
    return normalized || 'N/A';
  }

  function getCertificationKey(item) {
    if (item?.source !== 'TMDB') return '';
    const mediaType = item?.type === 'movie' || item?.type === 'tv' ? item.type : '';
    const tmdbId = item?.tmdbId || item?.id;
    if (!mediaType || !tmdbId) return '';
    return `${mediaType}:${tmdbId}`;
  }

  function pickMovieCertification(items) {
    const list = Array.isArray(items) ? items : [];
    const us = list.find((entry) => entry?.iso_3166_1 === 'US');
    const fromUs = us?.release_dates?.find((entry) => String(entry?.certification || '').trim())?.certification;
    if (String(fromUs || '').trim()) return String(fromUs).trim();

    for (const entry of list) {
      const value = entry?.release_dates?.find((row) => String(row?.certification || '').trim())?.certification;
      if (String(value || '').trim()) return String(value).trim();
    }
    return '';
  }

  function pickTvCertification(items) {
    const list = Array.isArray(items) ? items : [];
    const us = list.find((entry) => entry?.iso_3166_1 === 'US');
    const fromUs = String(us?.rating || '').trim();
    if (fromUs) return fromUs;

    for (const entry of list) {
      const value = String(entry?.rating || '').trim();
      if (value) return value;
    }
    return '';
  }

  async function fetchTmdbCertification(item) {
    const key = getCertificationKey(item);
    if (!key) return '';
    if (certificationCache.has(key)) return certificationCache.get(key);
    if (certificationPending.has(key)) return certificationPending.get(key);

    const request = (async () => {
      try {
        const [mediaType, mediaId] = key.split(':');
        const endpoint = mediaType === 'movie' ? 'release_dates' : 'content_ratings';
        const response = await fetch(`https://api.themoviedb.org/3/${mediaType}/${encodeURIComponent(mediaId)}/${endpoint}?api_key=${TMDB_API_KEY}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const certification = mediaType === 'movie'
          ? pickMovieCertification(data?.results)
          : pickTvCertification(data?.results);
        certificationCache.set(key, certification);
        return certification;
      } catch {
        certificationCache.set(key, '');
        return '';
      } finally {
        certificationPending.delete(key);
      }
    })();

    certificationPending.set(key, request);
    return request;
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

    if (!subtitleText && !String(item?.certification || '').trim() && getCertificationKey(item)) {
      fetchTmdbCertification(item).then((certification) => {
        item.certification = certification;
        subtitle.textContent = buildSubtitle(item);
      });
    }

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
