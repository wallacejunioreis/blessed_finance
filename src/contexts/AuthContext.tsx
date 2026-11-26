import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, apiRequest, setMemoryAuthToken } from '../services/api';
import { Family, FamilyMember, FamilyRole, UserProfile } from '../types/finance';

const SESSION_INACTIVITY_MS = 30 * 60 * 1000; // 30 minutes inactivity lock

interface AuthResponsePayload {
  user: UserProfile | null;
  family: Family | null;
  members: FamilyMember[];
  token?: string;
  recoveryCode?: string;
}

interface AuthContextValue {
  user: UserProfile | null;
  authReady: boolean;
  profile: UserProfile | null;
  profileLoading: boolean;
  family: Family | null;
  members: FamilyMember[];
  pendingInviteCode: string;
  setPendingInviteCode: (code: string) => void;
  pendingRecoveryCode: string;
  dismissRecoveryCode: () => void;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (params: {
    name: string;
    email: string;
    password: string;
    role: FamilyRole;
  }) => Promise<void>;
  resetPasswordWithRecoveryCode: (params: {
    email: string;
    recoveryCode: string;
    newPassword: string;
  }) => Promise<void>;
  reauthenticateUser: (currentPassword: string) => Promise<void>;
  changeUserPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSessionState: () => Promise<void>;
  createFamily: (params: {
    familyName: string;
    displayName: string;
    role: FamilyRole;
  }) => Promise<string>;
  joinFamilyByCode: (params: {
    inviteCode: string;
    displayName: string;
    role: FamilyRole;
  }) => Promise<void>;
  updateMyProfile: (params: { displayName: string; role: FamilyRole }) => Promise<void>;
  updateFamilyName: (name: string) => Promise<void>;
  regenerateInviteCode: (currentPassword: string) => Promise<string>;
  removeFamilyMember: (memberUid: string, currentPassword: string) => Promise<void>;
  completeOnboarding: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function translateAuthError(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) {
    return err.message || 'Não foi possível concluir a autenticação. Tente novamente.';
  }
  return 'Não foi possível concluir a autenticação. Tente novamente.';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [family, setFamily] = useState<Family | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState('');
  const [pendingInviteCode, setPendingInviteCode] = useState<string>(() => {
    try {
      const url = new URL(window.location.href);
      const raw = (url.searchParams.get('convite') || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 16);
      if (raw) {
        url.searchParams.delete('convite');
        window.history.replaceState({}, document.title, url.pathname + url.search);
      }
      return raw;
    } catch {
      return '';
    }
  });

  const applySessionPayload = useCallback((data: AuthResponsePayload) => {
    if (data.token) {
      setMemoryAuthToken(data.token);
    }
    setUser(data.user);
    setFamily(data.family);
    setMembers(data.members || []);
  }, []);

  const refreshSessionState = useCallback(async () => {
    try {
      const data = await apiRequest<AuthResponsePayload>('/api/auth/me');
      if (!data.user) {
        setMemoryAuthToken(null);
      }
      setUser(data.user);
      setFamily(data.family);
      setMembers(data.members || []);
    } catch {
      // keep current state on transient network errors
    } finally {
      setAuthReady(true);
    }
  }, []);

  useEffect(() => {
    void refreshSessionState();
  }, [refreshSessionState]);

  const signOut = useCallback(async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore logout network errors
    }
    setMemoryAuthToken(null);
    setUser(null);
    setFamily(null);
    setMembers([]);
    setPendingRecoveryCode('');
    try {
      sessionStorage.clear();
    } catch {
      // ignore storage errors
    }
  }, []);

  // Automatic inactivity session timeout
  useEffect(() => {
    if (!user) return;
    let timer = setTimeout(() => {
      void signOut();
    }, SESSION_INACTIVITY_MS);

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void signOut();
      }, SESSION_INACTIVITY_MS);
    };

    const events: (keyof WindowEventMap)[] = ['mousedown', 'keydown', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));

    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [user, signOut]);

  const signInWithEmail = async (email: string, password: string) => {
    const data = await apiRequest<AuthResponsePayload>('/api/auth/login', {
      method: 'POST',
      body: { email: email.trim(), password },
    });
    applySessionPayload(data);
  };

  const signUpWithEmail = async ({
    name,
    email,
    password,
    role,
  }: {
    name: string;
    email: string;
    password: string;
    role: FamilyRole;
  }) => {
    const data = await apiRequest<AuthResponsePayload>('/api/auth/register', {
      method: 'POST',
      body: { name: name.trim(), email: email.trim(), password, role },
    });
    if (data.recoveryCode) {
      setPendingRecoveryCode(data.recoveryCode);
    }
    applySessionPayload(data);
  };

  const dismissRecoveryCode = () => {
    setPendingRecoveryCode('');
  };

  const resetPasswordWithRecoveryCode = async ({
    email,
    recoveryCode,
    newPassword,
  }: {
    email: string;
    recoveryCode: string;
    newPassword: string;
  }) => {
    await apiRequest('/api/auth/reset-password', {
      method: 'POST',
      body: { email: email.trim(), recoveryCode: recoveryCode.trim(), newPassword },
    });
  };

  const reauthenticateUser = async (currentPassword: string) => {
    await apiRequest('/api/auth/reauthenticate', {
      method: 'POST',
      body: { currentPassword },
    });
  };

  const changeUserPassword = async (currentPassword: string, newPassword: string) => {
    const data = await apiRequest<{ ok: boolean; token?: string }>('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
    if (data.token) {
      setMemoryAuthToken(data.token);
    }
  };

  const createFamily = async ({
    familyName,
    displayName,
    role,
  }: {
    familyName: string;
    displayName: string;
    role: FamilyRole;
  }): Promise<string> => {
    const data = await apiRequest<AuthResponsePayload>('/api/family/create', {
      method: 'POST',
      body: { familyName, displayName, role },
    });
    applySessionPayload(data);
    return data.family?.id || '';
  };

  const joinFamilyByCode = async ({
    inviteCode,
    displayName,
    role,
  }: {
    inviteCode: string;
    displayName: string;
    role: FamilyRole;
  }) => {
    const data = await apiRequest<AuthResponsePayload>('/api/family/join', {
      method: 'POST',
      body: { inviteCode, displayName, role },
    });
    applySessionPayload(data);
    setPendingInviteCode('');
  };

  const updateMyProfile = async ({
    displayName,
    role,
  }: {
    displayName: string;
    role: FamilyRole;
  }) => {
    const data = await apiRequest<AuthResponsePayload>('/api/family/profile', {
      method: 'PATCH',
      body: { displayName, role },
    });
    applySessionPayload(data);
  };

  const updateFamilyName = async (name: string) => {
    const data = await apiRequest<{ family: Family; members: FamilyMember[] }>('/api/family/name', {
      method: 'PATCH',
      body: { name },
    });
    setFamily(data.family);
    setMembers(data.members);
  };

  const regenerateInviteCode = async (currentPassword: string): Promise<string> => {
    const data = await apiRequest<{
      inviteCode: string;
      family: Family;
      members: FamilyMember[];
    }>('/api/family/regenerate-invite', {
      method: 'POST',
      body: { currentPassword },
    });
    setFamily(data.family);
    setMembers(data.members);
    return data.inviteCode;
  };

  const removeFamilyMember = async (memberUid: string, currentPassword: string) => {
    const data = await apiRequest<{ family: Family; members: FamilyMember[] }>(
      `/api/family/members/${encodeURIComponent(memberUid)}`,
      {
        method: 'DELETE',
        body: { currentPassword },
      }
    );
    setFamily(data.family);
    setMembers(data.members);
  };

  const completeOnboarding = async () => {
    const data = await apiRequest<{ user: UserProfile }>('/api/family/complete-onboarding', {
      method: 'POST',
    });
    setUser(data.user);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        profile: user,
        profileLoading: !authReady,
        family,
        members,
        pendingInviteCode,
        setPendingInviteCode,
        pendingRecoveryCode,
        dismissRecoveryCode,
        signInWithEmail,
        signUpWithEmail,
        resetPasswordWithRecoveryCode,
        reauthenticateUser,
        changeUserPassword,
        signOut,
        refreshSessionState,
        createFamily,
        joinFamilyByCode,
        updateMyProfile,
        updateFamilyName,
        regenerateInviteCode,
        removeFamilyMember,
        completeOnboarding,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  return ctx;
}
