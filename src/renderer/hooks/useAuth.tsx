import * as React from 'react';
import { call } from '@/lib/api';
import type { SessionUser, AllSettings } from '@/lib/types';
import type { Permission } from '@shared/permissions';

interface AuthState {
  loading: boolean;
  needsSetup: boolean;
  user: SessionUser | null;
  settings: AllSettings | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setupOwner: (input: { username: string; displayName: string; password: string }) => Promise<void>;
  /** One-time owner recovery code that must be acknowledged before the app opens. */
  recoveryCode: string | null;
  ackRecoveryCode: () => void;
  refresh: () => Promise<void>;
  reloadSettings: () => Promise<void>;
  can: (p: Permission) => boolean;
  canAny: (...p: Permission[]) => boolean;
}

const Ctx = React.createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = React.useState(true);
  const [needsSetup, setNeedsSetup] = React.useState(false);
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [settings, setSettings] = React.useState<AllSettings | null>(null);
  const [recoveryCode, setRecoveryCode] = React.useState<string | null>(null);

  const reloadSettings = React.useCallback(async () => {
    setSettings(await call<AllSettings>('settings:get'));
  }, []);

  const refresh = React.useCallback(async () => {
    const st = await call<{ needsSetup: boolean; user: SessionUser | null }>('auth:status');
    setNeedsSetup(st.needsSetup);
    setUser(st.user);
    if (st.user) await reloadSettings();
    else setSettings(null);
  }, [reloadSettings]);

  React.useEffect(() => {
    refresh()
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [refresh]);

  const value = React.useMemo<AuthState>(
    () => ({
      loading,
      needsSetup,
      user,
      settings,
      refresh,
      reloadSettings,
      signIn: async (username, password) => {
        const u = await call<SessionUser>('auth:login', { username, password });
        setUser(u);
        await reloadSettings();
      },
      signOut: async () => {
        await call('auth:logout');
        setUser(null);
        setSettings(null);
      },
      setupOwner: async (input) => {
        const r = await call<{ user: SessionUser; recoveryCode: string }>('auth:setup', input);
        setRecoveryCode(r.recoveryCode);
        setNeedsSetup(false);
        setUser(r.user);
        await reloadSettings();
      },
      recoveryCode,
      ackRecoveryCode: () => setRecoveryCode(null),
      can: (p) => !!user?.permissions.includes(p),
      canAny: (...p) => p.some((x) => !!user?.permissions.includes(x)),
    }),
    [loading, needsSetup, user, settings, recoveryCode, refresh, reloadSettings],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}
