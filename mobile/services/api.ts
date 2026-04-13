import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// DEV: your PC's LAN IP so physical Android devices can reach the backend.
// If testing on the Android emulator only, you can use 10.0.2.2:8000 instead.
export const API_BASE = __DEV__
  ? 'http://192.168.1.67:8000'
  : 'http://173.212.220.11/translan_data';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

// Attach JWT token to every request
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authAPI = {
  register: (data: { email: string; username: string; password: string; full_name?: string }) =>
    api.post('/api/auth/register', data),

  login: async (email: string, password: string) => {
    const form = new FormData();
    form.append('username', email);
    form.append('password', password);
    return api.post('/api/auth/login', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  getMe: () => api.get('/api/auth/me'),
  updateMe: (data: object) => api.put('/api/auth/me', data),
};

// ── Query / RAG ───────────────────────────────────────────────────────────────

export const queryAPI = {
  run: (text: string, top_k = 5) => api.post('/api/query', { text, top_k }),
  history: (limit = 20) => api.get(`/api/query/history?limit=${limit}`),
  deleteHistory: (id: number) => api.delete(`/api/query/history/${id}`),
};

// ── Knowledge ─────────────────────────────────────────────────────────────────

export const knowledgeAPI = {
  list: (params?: object) => api.get('/api/knowledge', { params }),
  create: (data: object) => api.post('/api/knowledge', data),
  get: (id: number) => api.get(`/api/knowledge/${id}`),
  update: (id: number, data: object) => api.put(`/api/knowledge/${id}`, data),
  delete: (id: number) => api.delete(`/api/knowledge/${id}`),
  publish: (id: number, price = 0) =>
    api.post(`/api/knowledge/${id}/publish?price=${price}`),
  getLinks: (id: number) => api.get(`/api/knowledge/${id}/links`),
  addLink: (id: number, target_id: number, label = '') =>
    api.post(`/api/knowledge/${id}/links?target_id=${target_id}&label=${label}`),
  suggestLinks: (id: number) => api.post(`/api/knowledge/${id}/suggest-links`),
};

// ── Files ─────────────────────────────────────────────────────────────────────

export const filesAPI = {
  upload: (formData: FormData) =>
    api.post('/api/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  scrapeUrl: (url: string) => api.post('/api/files/scrape', { url }),
  listLocal: (path = '.') => api.get(`/api/files/list-local?path=${path}`),
};

// ── Marketplace ───────────────────────────────────────────────────────────────

export const marketplaceAPI = {
  browse: (params?: object) => api.get('/api/marketplace', { params }),
  rate: (id: number, stars: number) =>
    api.post(`/api/marketplace/${id}/rate?stars=${stars}`),
  purchase: (id: number) => api.post(`/api/marketplace/${id}/purchase`),
};

// ── Modules ───────────────────────────────────────────────────────────────────

export const modulesAPI = {
  list: () => api.get('/api/modules'),
  create: (data: object) => api.post('/api/modules', data),
  get: (id: number) => api.get(`/api/modules/${id}`),
  delete: (id: number) => api.delete(`/api/modules/${id}`),
  addRow: (moduleId: number, data: object) =>
    api.post(`/api/modules/${moduleId}/rows`, data),
  updateRow: (moduleId: number, rowId: number, data: object) =>
    api.put(`/api/modules/${moduleId}/rows/${rowId}`, data),
  deleteRow: (moduleId: number, rowId: number) =>
    api.delete(`/api/modules/${moduleId}/rows/${rowId}`),
  // ── AI endpoints ────────────────────────────────────────────────────────────
  aiGenerateRows: (moduleId: number, prompt: string, count: number) =>
    api.post(`/api/modules/${moduleId}/ai/generate-rows`, { prompt, count }),
  aiSuggestLinks: (moduleId: number) =>
    api.post(`/api/modules/${moduleId}/ai/suggest-links`),
  aiFillRow: (moduleId: number, rowId: number) =>
    api.post(`/api/modules/${moduleId}/ai/fill-row/${rowId}`),
  aiCreate: (prompt: string) =>
    api.post('/api/modules/ai/create', { prompt }),
};

export default api;
