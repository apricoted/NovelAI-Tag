const FAVORITES_KEY = 'community-favorites-v1';

let favorites = loadFavorites();

function loadFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
}

export function favoriteKey(entry) {
  if (entry?.id) return String(entry.id);
  const category = entry?.category?.[0] || '';
  const title = entry?.title || '';
  const prompt = String(entry?.prompt || '').slice(0, 80);
  return `${category}:${title}:${prompt}`;
}

export function isFavorite(entry) {
  return favorites.has(favoriteKey(entry));
}

export function toggleFavorite(entry) {
  const key = favoriteKey(entry);
  if (favorites.has(key)) {
    favorites.delete(key);
    saveFavorites();
    return false;
  }
  favorites.add(key);
  saveFavorites();
  return true;
}

export function favoriteCountForEntries(entries) {
  return (entries || []).filter(isFavorite).length;
}
