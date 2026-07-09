export const state = {
  collection: null,
  entries: [],
  filtered: [],
  activeCategory: null,
  query: '',
  showNSFW: localStorage.getItem('strings-nsfw') === 'true',
  loading: true,
};
