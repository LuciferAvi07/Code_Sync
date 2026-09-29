import './vscode.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import AuthPage from './pages/AuthPage';
import EditorPage from './pages/EditorPage';

function App() {
    return (
        <>
            <Toaster
                position="top-right"
                toastOptions={{
                    success: { theme: { primary: '#4aed88' } },
                }}
            />
            <BrowserRouter>
                <AuthProvider>
                    <Routes>
                        <Route path="/login" element={<AuthPage />} />
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
                                    <EditorPage />
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
