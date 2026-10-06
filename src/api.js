// Base URL of the backend. Empty string = same origin (production build,
// or dev via the vite proxy). Set VITE_BACKEND_URL only when the frontend
// is served from a different host than the API in development.
export const API_BASE = import.meta.env.VITE_BACKEND_URL || '';

export async function apiFetch(path, { token, ...options } = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const error = new Error(data.error || `Request failed (${res.status})`);
        error.status = res.status;
        throw error;
    }
    return data;
}
