import { KEY } from './state.js';

export function token() {
  return localStorage.getItem(KEY) || '';
}

export function setToken(value) {
  localStorage.setItem(KEY, value || '');
}

export function clearToken() {
  localStorage.removeItem(KEY);
}

export async function adminApi(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      authorization: 'Bearer ' + token(),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    clearToken();
    const error = new Error(data.error || '管理口令错误或已失效');
    error.unauthorized = true;
    throw error;
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

export function getCommunity(status) {
  return adminApi('/api/admin/community?status=' + encodeURIComponent(status));
}

export function getStats() {
  return adminApi('/api/admin/community/stats');
}

export function mutateCommunity(action, body = {}) {
  return adminApi('/api/admin/community/' + encodeURIComponent(action), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getFeedback(status) {
  return adminApi('/api/admin/feedback?status=' + encodeURIComponent(status));
}

export function decideFeedback(id, action) {
  return adminApi('/api/admin/feedback-decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, action }),
  });
}

export function deleteFeedback(id, status) {
  return adminApi('/api/admin/feedback-delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, status }),
  });
}
