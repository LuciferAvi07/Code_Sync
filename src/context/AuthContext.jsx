import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch } from '../api';

const AuthContext = createContext(null);
const TOKEN_KEY = 'code-sync-token';

export function AuthProvider({ children }) {
    const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [sessionError, setSessionError] = useState('');
    const [retry, setRetry] = useState(0);

    // On boot, validate any stored token against the server.
    useEffect(() => {
        let cancelled = false;
        if (!token) {
            setLoading(false);
            return;
        }
        setLoading(true);
        setSessionError('');
        apiFetch('/api/auth/me', { token })
            .then((data) => { if (!cancelled) setUser(data.user); })
            .catch((error) => {
                if (cancelled) return;
                if (error.status === 401) {
                    localStorage.removeItem(TOKEN_KEY);
                    setToken(null);
                    setUser(null);
                } else {
                    setSessionError('Could not connect to the server. Please try again.');
                }
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [retry]);

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
        setSessionError('');
    };

    return (
        <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
            {sessionError ? (
                <div className="vscode-boot" role="alert">
                    <span>{sessionError}</span>
                    <button className="vscode-btn-primary" onClick={() => setRetry((value) => value + 1)}>Retry</button>
                    <button className="vscode-btn-ghost" onClick={logout}>Sign out</button>
                </div>
            ) : children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
