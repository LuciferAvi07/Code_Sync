import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const AuthPage = () => {
    const { login, register } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [mode, setMode] = useState('login'); // 'login' | 'register'
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
            if (mode === 'login') {
                await login(email.trim(), password);
            } else {
                await register(name.trim(), email.trim(), password);
            }
            navigate(location.state?.from || '/', { replace: true });
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="vscode-auth-wrap">
            <div className="vscode-auth-card">
                <img className="vscode-auth-logo" src="/code-sync.png" alt="Code Sync" />
                <h1>Code Sync</h1>
                <p className="vscode-auth-sub">Real-time collaborative code editing</p>

                <div className="vscode-auth-tabs" role="tablist">
                    <button
                        role="tab"
                        aria-selected={mode === 'login'}
                        className={mode === 'login' ? 'active' : ''}
                        onClick={() => { setMode('login'); setError(''); }}
                    >
                        Sign in
                    </button>
                    <button
                        role="tab"
                        aria-selected={mode === 'register'}
                        className={mode === 'register' ? 'active' : ''}
                        onClick={() => { setMode('register'); setError(''); }}
                    >
                        Create account
                    </button>
                </div>

                <form onSubmit={submit} className="vscode-auth-form">
                    {mode === 'register' && (
                        <label>
                            <span>Display name</span>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Ada Lovelace"
                                autoComplete="name"
                                required
                                minLength={2}
                                maxLength={30}
                            />
                        </label>
                    )}
                    <label>
                        <span>Email</span>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            autoComplete="email"
                            required
                        />
                    </label>
                    <label>
                        <span>Password {mode === 'register' && <em>(min 8 characters)</em>}</span>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                            required
                            minLength={8}
                        />
                    </label>
                    {error && <div className="vscode-auth-error" role="alert">{error}</div>}
                    <button type="submit" className="vscode-btn-primary" disabled={busy}>
                        {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
                    </button>
                </form>

                <p className="vscode-auth-foot">
                    {mode === 'login' ? (
                        <>New here? <button className="vscode-link" onClick={() => setMode('register')}>Create an account</button></>
                    ) : (
                        <>Already have an account? <button className="vscode-link" onClick={() => setMode('login')}>Sign in</button></>
                    )}
                </p>
                <Link className="vscode-auth-back" to="/">← back</Link>
            </div>
        </div>
    );
};

export default AuthPage;
