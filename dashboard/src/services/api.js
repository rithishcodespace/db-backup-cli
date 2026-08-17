// dashboard/src/services/api.js

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export let lastSuccessfulUpdate = null;
export let isBackendConnected = true;

async function fetchJSON(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  try {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.error || `HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    lastSuccessfulUpdate = new Date();
    isBackendConnected = true;
    return data;
  } catch (error) {
    isBackendConnected = false;
    throw error;
  }
}

export const dashboardApi = {
  getSummary: () => fetchJSON('/api/dashboard/summary'),
  getActiveBackups: () => fetchJSON('/api/dashboard/backups/active'),
  getQueues: () => fetchJSON('/api/dashboard/queues'),
  getBackups: (params = {}) => {
    const searchParams = new URLSearchParams();
    if (params.status) searchParams.set('status', params.status);
    if (params.dbType) searchParams.set('dbType', params.dbType);
    if (params.search) searchParams.set('search', params.search);
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.page) searchParams.set('page', String(params.page));
    const queryStr = searchParams.toString();
    return fetchJSON(`/api/dashboard/backups${queryStr ? `?${queryStr}` : ''}`);
  },
  getLogs: (params = {}) => {
    const searchParams = new URLSearchParams();
    if (params.level) searchParams.set('level', params.level);
    if (params.jobId) searchParams.set('jobId', params.jobId);
    if (params.search) searchParams.set('search', params.search);
    if (params.limit) searchParams.set('limit', String(params.limit));
    const queryStr = searchParams.toString();
    return fetchJSON(`/api/dashboard/logs${queryStr ? `?${queryStr}` : ''}`);
  },
  getAlerts: () => fetchJSON('/api/dashboard/alerts'),
  getHealth: () => fetchJSON('/api/dashboard/health'),
  cancelWaitingJob: (id) =>
    fetchJSON(`/api/dashboard/backups/${id}/cancel-waiting`, {
      method: 'POST',
    }),
};
