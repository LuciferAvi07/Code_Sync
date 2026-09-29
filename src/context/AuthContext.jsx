import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch } from '../api';

const AuthContext = createContext(null);
const TOKEN_KEY = 'code-sync-token';

export function AuthProvider({ children }) {
    const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // On boot, validate any stored token against the server.
    useEffect(() => {
        if (!token) {
            setLoading(false);
            return;
        }
        apiFetch('/api/auth/me', { token })
            .then((data) => setUser(data.user))
            .catch(() => {
                localStorage.removeItem(TOKEN_KEY);
                setToken(null);
            })
            .finally(() => setLoading(false));
    }, []);

    const saveSession = (data) => {
        localStorage.setItem(TOKEN_KEY, data.token);
        setToken(data.token);
        setUser(data.user);
    };

    const login = async (email, password) => {
        const data = await apiFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
        saveSession(data);
    };

    const register = async (name, email, password) => {
        const data = await apiFetch('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ name, email, password }),
        });
        saveSession(data);
    };

    const logout = () => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
