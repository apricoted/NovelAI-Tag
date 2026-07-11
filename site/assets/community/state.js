export const state = {
  collection: null,
  features: { likes: false },
  entries: [],
  filtered: [],
  activeCategory: null,
  query: '',
  showNSFW: localStorage.getItem('strings-nsfw') === 'true',
  onlyFavorites: localStorage.getItem('community-only-favorites') === 'true',
  loading: true,
};
