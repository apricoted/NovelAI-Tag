import { state } from './state.js?v=20260623-cache1';
import { esc } from './utils.js?v=20260623-cache1';
import { entryImages, hasEntryImage } from './media.js?v=20260623-cache1';
import { isFav } from './favorites.js?v=20260623-cache1';

export function searchableText(e) {
  return [e.title, e.tags, e.negative, e.note, e.rawTags, ...(e.path || [])]
    .join('\n')
    .toLowerCase();
}

export function parseSearchQuery(raw) {
  const input = String(raw || '').trim();
  if (!input) return { raw: '', isSyntax: false, text: '', highlightTerms: [] };
  const tokens = splitQueryTokens(input);
  const plan = {
    raw: input,
    isSyntax: false,
    text: '',
    path: null,
    hasImage: null,
    fav: null,
    author: '',
    highlightTerms: [],
  };
  const terms = [];
  let invalidSyntax = false;

  for (const token of tokens) {
    const match = token.match(/^(path|has|fav|author):(.+)$/i);
    if (!match) {
      terms.push(token);
      continue;
    }
    plan.isSyntax = true;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (!value) {
      invalidSyntax = true;
      break;
    }
    if (key === 'path') {
      const path = value.split('/').map(seg => seg.trim()).filter(Boolean);
      if (!path.length) invalidSyntax = true;
      else plan.path = path;
    } else if (key === 'has') {
      const v = value.toLowerCase();
      if (['image', 'img', 'true', 'yes', '有图'].includes(v)) plan.hasImage = true;
      else if (['noimage', 'none', 'false', 'no', '无图'].includes(v)) plan.hasImage = false;
      else invalidSyntax = true;
    } else if (key === 'fav') {
      const v = value.toLowerCase();
      if (['true', '1', 'yes', '收藏'].includes(v)) plan.fav = true;
      else if (['false', '0', 'no', '未收藏'].includes(v)) plan.fav = false;
      else invalidSyntax = true;
    } else if (key === 'author') {
      plan.author = value.toLowerCase();
    }
    if (invalidSyntax) break;
  }

  if (invalidSyntax) {
    return {
      raw: input,
      isSyntax: false,
      text: input.toLowerCase(),
      highlightTerms: highlightTermsFromText(input),
    };
  }

  plan.text = terms.join(' ').trim().toLowerCase();
  plan.highlightTerms = highlightTermsFromText(terms.join(' '));
  if (!plan.isSyntax) {
    plan.text = input.toLowerCase();
    plan.highlightTerms = highlightTermsFromText(input);
  }
  return plan;
}

export function splitQueryTokens(input) {
  const tokens = [];
  let buf = '';
  let quote = '';
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = '';
      else buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (buf) {
        tokens.push(buf);
        buf = '';
      }
      continue;
    }
    buf += ch;
  }
  if (buf) tokens.push(buf);
  return tokens;
}

export function matchSearchPlan(e, plan) {
  if (!plan.isSyntax) return searchableText(e).includes(plan.text);
  if (plan.text && !searchableText(e).includes(plan.text)) return false;
  if (plan.path && !pathMatchesQuery(e.path || [], plan.path)) return false;
  if (plan.hasImage !== null && hasEntryImage(e) !== plan.hasImage) return false;
  if (plan.fav !== null && isFav(e) !== plan.fav) return false;
  if (plan.author && !entryAuthorText(e).includes(plan.author)) return false;
  return true;
}

export function pathMatchesQuery(path, queryPath) {
  if (!queryPath.length) return true;
  const joined = path.join('/').toLowerCase();
  const qJoined = queryPath.join('/').toLowerCase();
  if (joined.includes(qJoined)) return true;
  return queryPath.every(seg => path.some(p => String(p).toLowerCase().includes(seg.toLowerCase())));
}

export function entryAuthorText(e) {
  const imageAuthors = entryImages(e).flatMap(img => [img.author, img.credit]);
  const contributors = Array.isArray(state.codex?.contributors) ? state.codex.contributors.map(p => typeof p === 'string' ? p : `${p.name || ''} ${p.role || ''}`) : [];
  return [state.codex?.author, state.codex?.source, e.author, e.credit, ...imageAuthors, ...contributors]
    .join('\n')
    .toLowerCase();
}

export function highlightTermsFromText(text) {
  const terms = String(text || '')
    .split(/[\s,，、]+/)
    .map(s => s.trim())
    .filter(Boolean);
  return [...new Set(terms.map(s => s.toLowerCase()))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 10);
}

export function currentHighlightTerms() {
  return state.searchPlan?.highlightTerms || [];
}

export function renderHighlightedText(el, text, terms = []) {
  if (!el) return;
  const raw = String(text || '');
  const needles = terms.filter(Boolean);
  if (!needles.length) {
    el.textContent = raw;
    return;
  }
  const lower = raw.toLowerCase();
  const frag = document.createDocumentFragment();
  let pos = 0;
  while (pos < raw.length) {
    let bestIndex = -1;
    let bestTerm = '';
    for (const term of needles) {
      const index = lower.indexOf(term, pos);
      if (index === -1) continue;
      if (bestIndex === -1 || index < bestIndex || (index === bestIndex && term.length > bestTerm.length)) {
        bestIndex = index;
        bestTerm = term;
      }
    }
    if (bestIndex === -1) {
      frag.appendChild(document.createTextNode(raw.slice(pos)));
      break;
    }
    if (bestIndex > pos) frag.appendChild(document.createTextNode(raw.slice(pos, bestIndex)));
    const mark = document.createElement('mark');
    mark.textContent = raw.slice(bestIndex, bestIndex + bestTerm.length);
    frag.appendChild(mark);
    pos = bestIndex + bestTerm.length;
  }
  el.replaceChildren(frag);
}
