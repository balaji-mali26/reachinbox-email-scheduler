import axios from 'axios';

// Ensure browser API requests strictly use same-origin /api so Nginx reverse-proxies
// all requests and cookies are handled as first-party
const resolveApiBase = (): string => {
  // In the browser, always use relative /api to route through the Nginx reverse proxy
  // This guarantees cookies remain first-party and avoids cross-origin stripping
  if (typeof window !== 'undefined') {
    return '/api';
  }
  return import.meta.env.VITE_API_URL || '/api';
};

export const API_BASE_URL = resolveApiBase();

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Standardize error message extraction
    const message =
      error.response?.data?.error?.message ||
      error.message ||
      'An unexpected error occurred';
    return Promise.reject(new Error(message));
  }
);
