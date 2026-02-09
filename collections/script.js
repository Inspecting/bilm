const STORAGE_KEY = 'bilm-collections';

function loadCollections() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCollections(collections) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collections));
}

function renderCollections() {
  const list = document.getElementById('collectionsList');
  if (!list) return;
  list.innerHTML = '';

  const collections = loadCollections();
  if (!collections.length) {
    const empty = document.createElement('div');
    empty.className = 'card';
    empty.textContent = 'No collections yet. Create one above to get started.';
    list.appendChild(empty);
    return;
  }

  collections.forEach((collection, index) => {
    const card = document.createElement('div');
    card.className = 'card collection-card';

    const header = document.createElement('div');
    header.className = 'card-header';

    const title = document.createElement('h3');
    title.className = 'card-title';
    title.textContent = collection.name;

    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `${collection.items.length} items`;

    header.appendChild(title);
    header.appendChild(tag);

    const items = document.createElement('div');
    items.className = 'collection-items';
    if (!collection.items.length) {
      const emptyItem = document.createElement('span');
      emptyItem.textContent = 'Add a title below to start building this list.';
      items.appendChild(emptyItem);
    } else {
      collection.items.forEach(item => {
        const span = document.createElement('span');
        span.textContent = `${item.title} · ${item.type}`;
        items.appendChild(span);
      });
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Add a title (e.g., Dune, Movie)';

    const actions = document.createElement('div');
    actions.className = 'collection-actions';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-soft';
    addBtn.type = 'button';
    addBtn.textContent = 'Add item';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-outline';
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove list';

    addBtn.addEventListener('click', () => {
      const value = input.value.trim();
      if (!value) return;
      const parts = value.split(',');
      const titleValue = parts[0].trim();
      const typeValue = parts[1]?.trim() || 'Movie/TV';
      const next = loadCollections();
      next[index].items.push({ title: titleValue, type: typeValue });
      saveCollections(next);
      renderCollections();
    });

    removeBtn.addEventListener('click', () => {
      if (!confirm('Remove this collection?')) return;
      const next = loadCollections();
      next.splice(index, 1);
      saveCollections(next);
      renderCollections();
    });

    actions.appendChild(addBtn);
    actions.appendChild(removeBtn);

    card.appendChild(header);
    card.appendChild(items);
    card.appendChild(input);
    card.appendChild(actions);

    list.appendChild(card);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('collectionForm');
  const input = document.getElementById('collectionName');

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    const collections = loadCollections();
    collections.push({ name, items: [] });
    saveCollections(collections);
    input.value = '';
    renderCollections();
  });

  renderCollections();
});
