import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../api';

const Home = () => {
    const navigate = useNavigate();
    const { user, token, logout } = useAuth();

    const [roomName, setRoomName] = useState('');
    const [roomPassword, setRoomPassword] = useState('');
    const [joinId, setJoinId] = useState('');
    const [joinPassword, setJoinPassword] = useState('');
    const [myRooms, setMyRooms] = useState([]);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        apiFetch('/api/rooms', { token })
            .then((data) => setMyRooms(data.rooms))
            .catch(() => {});
    }, [token]);

    const createRoom = async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            const data = await apiFetch('/api/rooms', {
                method: 'POST',
                token,
                body: JSON.stringify({ name: roomName, password: roomPassword || undefined }),
            });
            toast.success('Room created');
            navigate(`/editor/${data.room.id}`, {
                state: { password: roomPassword || undefined },
            });
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(false);
        }
    };

    const joinRoom = (e) => {
        e.preventDefault();
        const id = joinId.trim();
        if (!id) {
            toast.error('Paste a room ID to join');
            return;
        }
        navigate(`/editor/${id}`, {
            state: { password: joinPassword || undefined },
        });
    };

    const copyId = async (id) => {
        try {
            await navigator.clipboard.writeText(id);
            toast.success('Room ID copied');
        } catch {
            toast.error('Could not copy the Room ID');
        }
    };

    return (
        <div className="vscode-home">
            <header className="vscode-home-topbar">
                <div className="vscode-home-brand">
                    <img src="/code-sync.png" alt="" />
                    <strong>Code Sync</strong>
                </div>
                <div className="vscode-home-user">
                    <span className="vs-avatar">{user.name.charAt(0).toUpperCase()}</span>
                    <span className="vscode-home-username">{user.name}</span>
                    <button className="vscode-btn-ghost" onClick={logout}>Sign out</button>
                </div>
            </header>

            <main className="vscode-home-main">
                <div className="vscode-home-cards">
                    <section className="vscode-card">
                        <h2>New room</h2>
                        <p>Create a room and share its ID. Add a password to keep it private.</p>
                        <form onSubmit={createRoom}>
                            <label>
                                <span>Room name <em>(optional)</em></span>
                                <input
                                    value={roomName}
                                    onChange={(e) => setRoomName(e.target.value)}
                                    placeholder="Weekend hackathon"
                                    maxLength={60}
                                />
                            </label>
                            <label>
                                <span>Password <em>(optional)</em></span>
                                <input
                                    type="password"
                                    value={roomPassword}
                                    onChange={(e) => setRoomPassword(e.target.value)}
                                    placeholder="Leave empty for an open room"
                                    autoComplete="new-password"
                                />
                            </label>
                            <button className="vscode-btn-primary" type="submit" disabled={busy}>
                                {busy ? 'Creating…' : 'Create room'}
                            </button>
                        </form>
                    </section>

                    <section className="vscode-card">
                        <h2>Join room</h2>
                        <p>Got an invite? Paste the room ID below.</p>
                        <form onSubmit={joinRoom}>
                            <label>
                                <span>Room ID</span>
                                <input
                                    value={joinId}
                                    onChange={(e) => setJoinId(e.target.value)}
                                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                                />
                            </label>
                            <label>
                                <span>Password <em>(if the room has one)</em></span>
                                <input
                                    type="password"
                                    value={joinPassword}
                                    onChange={(e) => setJoinPassword(e.target.value)}
                                    placeholder="Room password"
                                    autoComplete="off"
                                />
                            </label>
                            <button className="vscode-btn-primary" type="submit">Join room</button>
                        </form>
                    </section>
                </div>

                <section className="vscode-card vscode-rooms-list">
                    <h2>My rooms</h2>
                    {myRooms.length === 0 ? (
                        <p className="vscode-muted">Rooms you create will show up here.</p>
                    ) : (
                        <ul>
                            {myRooms.map((room) => (
                                <li key={room.id}>
                                    <div className="vscode-room-meta">
                                        <strong>{room.name || 'Untitled room'}</strong>
                                        <span className="vscode-muted">
                                            {room.hasPassword ? '🔒 password protected' : '🌐 open'} ·{' '}
                                            {new Date(room.createdAt).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <div className="vscode-room-actions">
                                        <button
                                            className="vscode-btn-ghost"
                                            onClick={() => copyId(room.id)}
                                        >
                                            Copy ID
                                        </button>
                                        <button
                                            className="vscode-btn-primary"
                                            onClick={() => navigate(`/editor/${room.id}`)}
                                        >
                                            Open
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </main>
        </div>
    );
};

export default Home;
