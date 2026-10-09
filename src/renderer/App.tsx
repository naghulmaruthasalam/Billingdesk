import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useTheme } from './hooks/useTheme';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { PosPage } from './pages/pos/PosPage';
import { Loading } from './components/ui/misc';

export function App() {
  const { loading, user, needsSetup, settings, canAny } = useAuth();
  useTheme(settings?.['ui.theme']);
  if (loading) return <Loading label="Starting…" />;
  if (needsSetup || !user) return <LoginPage />;
  const home = canAny('billing.create') ? '/pos' : canAny('reports.view') ? '/dashboard' : canAny('products.view') ? '/products' : '/sales';
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/pos" element={<PosPage />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
