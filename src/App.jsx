import './vscode.css';
import './workbench.css';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import AuthPage from './pages/AuthPage';
import EditorPage from './pages/EditorPage';

// Already signed in? The login page is a dead end for them — bounce to home.
const LoginRoute = () => {
    const { user, loading } = useAuth();
    const location = useLocation();
    if (loading) return null;
    if (user) return <Navigate to={location.state?.from || '/'} replace />;
    return <AuthPage />;
};

const EditorRoute = () => {
    const { roomId } = useParams();
    return <EditorPage key={roomId} />;
};

function App() {
    return (
        <>
            <Toaster
                position="top-right"
                toastOptions={{
                    style: {
                        background: '#1b293b',
                        color: '#dbe7f9',
                        border: '1px solid #b5ccea22',
                        borderRadius: '10px',
                        fontSize: '12px',
                        boxShadow: '0 12px 32px #00000030',
                    },
                    success: { iconTheme: { primary: '#8cddbe', secondary: '#1b293b' } },
                    error: { iconTheme: { primary: '#ffa796', secondary: '#1b293b' } },
                }}
            />
            <BrowserRouter>
                <AuthProvider>
                    <Routes>
                        <Route path="/login" element={<LoginRoute />} />
                        <Route
                            path="/"
                            element={
                                <ProtectedRoute>
                                    <Home />
                                </ProtectedRoute>
                            }
                        />
                        <Route
                            path="/editor/:roomId"
                            element={
                                <ProtectedRoute>
                                    <EditorRoute />
                                </ProtectedRoute>
                            }
                        />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </AuthProvider>
            </BrowserRouter>
        </>
    );
}

export default App;
