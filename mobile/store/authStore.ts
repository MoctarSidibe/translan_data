import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { authAPI } from '../services/api';

interface User {
  id: number;
  email: string;
  username: string;
  full_name: string;
  is_premium: boolean;
  language: string;
  font_size: number;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; username: string; password: string; full_name?: string }) => Promise<void>;
  logout: () => Promise<void>;
  loadToken: () => Promise<void>;
  updateUser: (data: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isLoading: true,

  loadToken: async () => {
    // ── DEV BYPASS: auto-login so the app can be tested without a login screen ──
    // Remove this block and uncomment the real token logic below when ready.
    try {
      const { data } = await authAPI.login('test@translan.com', 'test1234');
      await SecureStore.setItemAsync('access_token', data.access_token);
      const me = await authAPI.getMe();
      set({ token: data.access_token, user: me.data, isLoading: false });
      return;
    } catch {
      // If auto-login fails (user not created yet), fall through to normal flow
    }
    // ── REAL TOKEN LOGIC (activate when login screen is ready) ──
    const token = await SecureStore.getItemAsync('access_token');
    if (token) {
      try {
        const { data } = await authAPI.getMe();
        set({ user: data, token, isLoading: false });
      } catch {
        await SecureStore.deleteItemAsync('access_token');
        set({ user: null, token: null, isLoading: false });
      }
    } else {
      set({ isLoading: false });
    }
  },

  login: async (email, password) => {
    const { data } = await authAPI.login(email, password);
    await SecureStore.setItemAsync('access_token', data.access_token);
    const me = await authAPI.getMe();
    set({ token: data.access_token, user: me.data });
  },

  register: async (payload) => {
    const { data } = await authAPI.register(payload);
    await SecureStore.setItemAsync('access_token', data.access_token);
    const me = await authAPI.getMe();
    set({ token: data.access_token, user: me.data });
  },

  logout: async () => {
    await SecureStore.deleteItemAsync('access_token');
    set({ user: null, token: null });
  },

  updateUser: (data) => {
    const current = get().user;
    if (current) set({ user: { ...current, ...data } });
  },
}));
