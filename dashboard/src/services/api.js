// dashboard/src/services/api.js

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export let lastSuccessfulUpdate = null;
export let isBackendConnected = true;
export let lastApiError = null;

async function fetchJSON(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  try {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': 'dashboard-admin-ui',
        ...options.headers,
      },
      ...options,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const errorMessage = errData.message || errData.error || `HTTP ${res.status}: ${res.statusText}`;
      const apiError = new Error(errorMessage);
      apiError.status = res.status;
      apiError.isApiError = true;

      isBackendConnected = true; // Server responded (HTTP status 4xx/5xx means server is reachable)
      lastApiError = errorMessage;
      throw apiError;
    }

    const data = await res.json();
    lastSuccessfulUpdate = new Date();
    isBackendConnected = true;
    lastApiError = null;
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      // AbortError is an intentional cancellation - do not alter connection/error states
      throw error;
    }

    // Network / fetch level failures (e.g. Failed to fetch, Connection Refused)
    if (!error.isApiError) {
      isBackendConnected = false;
      lastApiError = error.message || 'Network error: Unable to reach backend';
    }
    throw error;
  }
}

export const dashboardApi = {
  getSummary: (options = {}) => fetchJSON('/api/dashboard/summary', options),
  getActiveBackups: (options = {}) => fetchJSON('/api/dashboard/backups/active', options),
  getQueues: (options = {}) => fetchJSON('/api/dashboard/queues', options),
  getBackups: (params = {}, options = {}) => {
    const searchParams = new URLSearchParams();
    if (params.status) searchParams.set('status', params.status);
    if (params.dbType) searchParams.set('dbType', params.dbType);
    if (params.search) searchParams.set('search', params.search);
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.page) searchParams.set('page', String(params.page));
    const queryStr = searchParams.toString();
    return fetchJSON(`/api/dashboard/backups${queryStr ? `?${queryStr}` : ''}`, options);
  },
  getHistory: (params = {}, options = {}) => dashboardApi.getBackups(params, options),
  getLogs: (params = {}, options = {}) => {
    const searchParams = new URLSearchParams();
    if (params.level) searchParams.set('level', params.level);
    if (params.jobId) searchParams.set('jobId', params.jobId);
    if (params.search) searchParams.set('search', params.search);
    if (params.limit) searchParams.set('limit', String(params.limit));
    const queryStr = searchParams.toString();
    return fetchJSON(`/api/dashboard/logs${queryStr ? `?${queryStr}` : ''}`, options);
  },
  getAlerts: (options = {}) => fetchJSON('/api/dashboard/alerts', options),
  getHealth: (options = {}) => fetchJSON('/api/dashboard/health', options),
  cancelWaitingJob: (id, options = {}) =>
    fetchJSON(`/api/dashboard/backups/${id}/cancel-waiting`, {
      method: 'POST',
      ...options,
    }),
  triggerBackup: (payload, options = {}) =>
    fetchJSON('/api/dashboard/trigger-backup', {
      method: 'POST',
      body: JSON.stringify(payload),
      ...options,
    }),
};

