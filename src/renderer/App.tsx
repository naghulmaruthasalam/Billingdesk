import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useTheme } from './hooks/useTheme';
import { AppShell } from './components/layout/AppShell';
import { LoginPage, RecoveryCodeScreen } from './pages/LoginPage';
import { PosPage } from './pages/pos/PosPage';
import { DashboardPage } from './pages/reports/DashboardPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { ExpensesPage } from './pages/reports/ExpensesPage';
import { SalesPage } from './pages/sales/SalesPage';
import { ReturnsPage } from './pages/sales/ReturnsPage';
import { ProductsPage } from './pages/products/ProductsPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { PurchasesPage } from './pages/inventory/PurchasesPage';
import { CustomersPage } from './pages/CustomersPage';
import { StaffPage } from './pages/StaffPage';
import { SettingsPage } from './pages/SettingsPage';
import { BackupPage } from './pages/BackupPage';
import { Loading, Notice } from './components/ui/misc';
import type { Permission } from '@shared/permissions';

function Guard({ any, children }: { any: Permission[]; children: React.ReactNode }) {
  const { canAny } = useAuth();
  if (!canAny(...any)) return <Notice tone="red">You do not have permission to open this section.</Notice>;
  return <>{children}</>;
}

export function App() {
  const { loading, user, needsSetup, settings, canAny, recoveryCode } = useAuth();
  useTheme(settings?.['ui.theme']);
  if (loading) return <Loading label="Starting…" />;
  if (recoveryCode) return <RecoveryCodeScreen />;
  if (needsSetup || !user) return <LoginPage />;
  const home = canAny('billing.create') ? '/pos' : canAny('reports.view') ? '/dashboard' : canAny('products.view') ? '/products' : '/sales';
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/pos" element={<Guard any={['billing.create']}><PosPage /></Guard>} />
        <Route path="/dashboard" element={<Guard any={['reports.view']}><DashboardPage /></Guard>} />
        <Route path="/sales" element={<Guard any={['sales.view']}><SalesPage /></Guard>} />
        <Route path="/products" element={<Guard any={['products.view']}><ProductsPage /></Guard>} />
        <Route path="/inventory" element={<Guard any={['inventory.view']}><InventoryPage /></Guard>} />
        <Route path="/purchases" element={<Guard any={['purchases.manage']}><PurchasesPage /></Guard>} />
        <Route path="/returns" element={<Guard any={['sales.view']}><ReturnsPage /></Guard>} />
        <Route path="/customers" element={<Guard any={['customers.manage']}><CustomersPage /></Guard>} />
        <Route path="/reports" element={<Guard any={['reports.view']}><ReportsPage /></Guard>} />
        <Route path="/expenses" element={<Guard any={['expenses.manage']}><ExpensesPage /></Guard>} />
        <Route path="/staff" element={<Guard any={['users.manage', 'audit.view']}><StaffPage /></Guard>} />
        <Route path="/settings" element={<Guard any={['settings.manage']}><SettingsPage /></Guard>} />
        <Route path="/backup" element={<Guard any={['backup.manage']}><BackupPage /></Guard>} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
