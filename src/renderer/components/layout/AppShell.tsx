import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BarChart3, Boxes, ClipboardList, FileClock, History, LayoutDashboard, LogOut, Package, Receipt, Settings, ShoppingCart, ShieldCheck, Truck, Undo2, Users, Wallet, DatabaseBackup, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn, fmtDate, todayIST } from '@/lib/utils';
import type { Permission } from '@shared/permissions';
import { Badge } from '@/components/ui/misc';
import { useAsync } from '@/hooks/useApi';
import { call } from '@/lib/api';
import type { CatalogueStatus } from '@/lib/types';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  perm?: Permission[];
}

const NAV: NavItem[] = [
  { to: '/pos', label: 'New Bill', icon: ShoppingCart, perm: ['billing.create'] },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: ['reports.view'] },
  { to: '/sales', label: 'Sales History', icon: History, perm: ['sales.view'] },
  { to: '/products', label: 'Products', icon: Package, perm: ['products.view'] },
  { to: '/inventory', label: 'Inventory', icon: Boxes, perm: ['inventory.view'] },
  { to: '/purchases', label: 'Stock Purchases', icon: Truck, perm: ['purchases.manage'] },
  { to: '/returns', label: 'Returns & Cancellations', icon: Undo2, perm: ['sales.view'] },
  { to: '/customers', label: 'Customers', icon: Users, perm: ['customers.manage'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, perm: ['reports.view'] },
  { to: '/expenses', label: 'Expenses', icon: Wallet, perm: ['expenses.manage'] },
  { to: '/staff', label: 'Staff & Permissions', icon: ShieldCheck, perm: ['users.manage', 'audit.view'] },
  { to: '/settings', label: 'Settings', icon: Settings, perm: ['settings.manage'] },
  { to: '/backup', label: 'Backup & Restore', icon: DatabaseBackup, perm: ['backup.manage'] },
];

export function AppShell() {
  const { user, signOut, canAny, settings } = useAuth();
  const nav = useNavigate();
  const status = useAsync(() => call<CatalogueStatus>('catalogue:status'), []);
  const items = NAV.filter((n) => !n.perm || canAny(...n.perm));
  const st = status.data;
  const needsSetup = st && (!st.approved || !st.addressConfirmed);

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground" aria-label="Main navigation">
        <div className="border-b border-white/10 px-4 py-3">
          <div className="text-sm font-semibold leading-tight">{settings?.['shop.name_en'] ?? 'Sri Krishna Pattasu Kadai'}</div>
          <div className="ta text-xs text-sidebar-muted">{settings?.['shop.name_ta']}</div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => cn('mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm', isActive ? 'bg-sidebar-active font-medium text-white' : 'text-sidebar-foreground/85 hover:bg-white/10')}>
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 px-3 py-2 text-xs text-sidebar-muted">Offline - data stays on this computer</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <FileClock className="h-4 w-4" />
            <span>{fmtDate(todayIST())}</span>
            {needsSetup && (
              <button onClick={() => nav('/products?tab=review')} className="flex items-center gap-1.5 rounded bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning hover:opacity-80">
                <AlertTriangle className="h-3.5 w-3.5" />
                {!st?.approved ? 'Catalogue not approved - billing locked' : 'Shop address not confirmed - printing locked'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-sm font-medium">{user?.displayName}</div>
              <div className="text-xs text-muted-foreground">{user?.roleLabel}</div>
            </div>
            <Badge tone="green">
              <ClipboardList className="h-3 w-3" /> {user?.username}
            </Badge>
            <button
              className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={async () => {
                await signOut();
                nav('/');
              }}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto bg-background p-4">
          <Outlet context={{ refreshStatus: status.reload }} />
        </main>
      </div>
      <span className="sr-only">
        <Receipt />
      </span>
    </div>
  );
}
