import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { User, UserRole } from '@eduscope/shared';

interface AuthValue {
  readonly user: User | null;
  readonly role: UserRole | null;
  /** INV-U-3: while true, every surface except S-02 and getMe is unreachable. */
  readonly mustResetPassword: boolean;
  setUser(user: User | null): void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({
  children,
  initialUser = null,
}: {
  children: ReactNode;
  initialUser?: User | null;
}) {
  const [user, setUser] = useState<User | null>(initialUser);
  const value = useMemo<AuthValue>(
    () => ({
      user,
      role: user?.role ?? null,
      mustResetPassword: user?.mustResetPassword ?? false,
      setUser,
    }),
    [user],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
