import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  clearEncryptedSessionToken,
  loadEncryptedSessionToken,
  saveEncryptedSessionToken,
} from '../db/sessionVault';
import { ApiError, apiRequest, setMemoryAuthToken } from '../services/api';
import { Family, FamilyMember, FamilyRole, UserProfile } from '../types/finance';

const SESSION_INACTIVITY_MS = 30 * 60 * 1000; // 30 minutes inactivity lock

interface AuthResponsePayload {
  user: UserProfile | null;
  family: Family | null;
  members: FamilyMember[];
  token?: string;
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
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (params: {
    name: string;
    email: string;
    password: string;
    role: FamilyRole;
  }) => Promise<void>;
  requestRecoveryCode: (email: string) => Promise<void>;
  verifyRecoveryCode: (email: string, code: string) => Promise<void>;
  completePasswordReset: (params: { email: string; newPassword: string }) => Promise<void>;
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
  const [pendingResetToken, setPendingResetToken] = useState('');
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

  const applySessionPayload = useCallback(async (data: AuthResponsePayload) => {
    if (data.token) {
      setMemoryAuthToken(data.token);
      await saveEncryptedSessionToken(data.token);
    }
    setUser(data.user);
    setFamily(data.family);
    setMembers(data.members || []);
  }, []);

  const refreshSessionState = useCallback(async () => {
    try {
      const storedToken = await loadEncryptedSessionToken();
      if (storedToken) {
        setMemoryAuthToken(storedToken);
      }
      const data = await apiRequest<AuthResponsePayload>('/api/auth/me');
      if (!data.user) {
        setMemoryAuthToken(null);
        await clearEncryptedSessionToken();
      }
      setUser(data.user);
      setFamily(data.family);
      setMembers(data.members || []);
    } catch {
      // keep current state on transient network error
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
    await clearEncryptedSessionToken();
    setUser(null);
    setFamily(null);
    setMembers([]);
    setPendingResetToken('');
    try {
      sessionStorage.clear();
    } catch {
      // ignore
    }
  }, []);

  // Automatic inactivity lock
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
    await applySessionPayload(data);
  };

  const signUpWithEmail = async (params: {
    name: string;
    email: string;
    password: string;
    role: FamilyRole;
  }) => {
    const data = await apiRequest<AuthResponsePayload>('/api/auth/register', {
      method: 'POST',
      body: {
        name: params.name.trim(),
        email: params.email.trim(),
        password: params.password,
        role: params.role,
      },
    });
    await applySessionPayload(data);
  };

  const requestRecoveryCode = async (email: string) => {
    setPendingResetToken('');
    await apiRequest('/api/recovery/request-code', {
      method: 'POST',
      body: { email: email.trim() },
    });
  };

  const verifyRecoveryCode = async (email: string, code: string) => {
    const res = await apiRequest<{ ok: boolean; resetToken: string }>('/api/recovery/verify-code', {
      method: 'POST',
      body: { email: email.trim(), code: code.replace(/\D/g, '') },
    });
    setPendingResetToken(res.resetToken || '');
  };

  const completePasswordReset = async ({
    email,
    newPassword,
  }: {
    email: string;
    newPassword: string;
  }) => {
    if (!pendingResetToken) {
      throw new Error('Valide o código de verificação primeiro.');
    }
    await apiRequest('/api/recovery/reset-password', {
      method: 'POST',
      body: {
        email: email.trim(),
        resetToken: pendingResetToken,
        newPassword,
      },
    });
    setPendingResetToken('');
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
      await saveEncryptedSessionToken(data.token);
    }
  };

  const createFamily = async (params: {
    familyName: string;
    displayName: string;
    role: FamilyRole;
  }): Promise<string> => {
    const data = await apiRequest<AuthResponsePayload>('/api/family/create', {
      method: 'POST',
      body: params,
    });
    await applySessionPayload(data);
    return data.family?.id || '';
  };

  const joinFamilyByCode = async (params: {
    inviteCode: string;
    displayName: string;
    role: FamilyRole;
  }) => {
    const data = await apiRequest<AuthResponsePayload>('/api/family/join', {
      method: 'POST',
      body: params,
    });
    await applySessionPayload(data);
    setPendingInviteCode('');
  };

  const updateMyProfile = async (params: { displayName: string; role: FamilyRole }) => {
    const data = await apiRequest<AuthResponsePayload>('/api/family/profile', {
      method: 'PATCH',
      body: params,
    });
    await applySessionPayload(data);
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
        signInWithEmail,
        signUpWithEmail,
        requestRecoveryCode,
        verifyRecoveryCode,
        completePasswordReset,
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
