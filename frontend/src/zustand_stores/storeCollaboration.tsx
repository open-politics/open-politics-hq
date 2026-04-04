import { create } from 'zustand';
import { OpenAPI } from '@/client';
import { toast } from 'sonner';

// ─── Types ───

export interface InvitationOut {
  id: number;
  infospace_id: number;
  infospace_name: string;
  inviter_name: string | null;
  inviter_handle: string | null;
  invitee_user_id: number | null;
  invitee_handle: string | null;
  invitee_email: string | null;
  role: string;
  status: string;
  created_at: string;
}

export interface CollaboratorOut {
  user_id: number;
  handle: string | null;
  full_name: string | null;
  profile_picture_url: string | null;
  role: string;
  is_owner: boolean;
}

export interface UserSearchResult {
  id: number;
  handle: string | null;
  full_name: string | null;
  profile_picture_url: string | null;
}

// ─── API helpers ───

async function authHeaders(): Promise<Record<string, string>> {
  const base = OpenAPI.HEADERS;
  if (typeof base === 'function') return await base({} as any);
  return base ?? {};
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${OpenAPI.BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...headers, ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ─── Store ───

interface CollaborationState {
  // Inbox
  pendingInvitations: InvitationOut[];
  pendingCount: number;
  fetchPendingInvitations: () => Promise<void>;
  fetchPendingCount: () => Promise<void>;
  acceptInvitation: (id: number) => Promise<number | null>;
  declineInvitation: (id: number) => Promise<void>;

  // Infospace collaborators
  collaborators: CollaboratorOut[];
  infospaceInvitations: InvitationOut[];
  fetchCollaborators: (infospaceId: number) => Promise<void>;
  fetchInfospaceInvitations: (infospaceId: number) => Promise<void>;
  inviteCollaborator: (infospaceId: number, identifier: string, role: string) => Promise<void>;
  revokeInvitation: (infospaceId: number, invitationId: number) => Promise<void>;
  changeRole: (infospaceId: number, userId: number, role: string) => Promise<void>;
  removeCollaborator: (infospaceId: number, userId: number) => Promise<void>;
  leaveInfospace: (infospaceId: number) => Promise<void>;

  // User search
  searchUsers: (query: string) => Promise<UserSearchResult[]>;
}

export const useCollaborationStore = create<CollaborationState>()((set, get) => ({
  pendingInvitations: [],
  pendingCount: 0,
  collaborators: [],
  infospaceInvitations: [],

  // ─── Inbox ───

  fetchPendingInvitations: async () => {
    try {
      const data = await apiFetch<InvitationOut[]>('/api/v1/users/me/invitations');
      set({ pendingInvitations: data, pendingCount: data.length });
    } catch (e: any) {
      console.error('Failed to fetch invitations:', e);
    }
  },

  fetchPendingCount: async () => {
    try {
      const data = await apiFetch<{ count: number }>('/api/v1/users/me/invitations/count');
      set({ pendingCount: data.count });
    } catch (e: any) {
      console.error('Failed to fetch invitation count:', e);
    }
  },

  acceptInvitation: async (id: number): Promise<number | null> => {
    try {
      const data = await apiFetch<{ message: string; infospace_id: number; role: string }>(
        `/api/v1/users/me/invitations/${id}/accept`, { method: 'POST' }
      );
      toast.success('Invitation accepted');
      await get().fetchPendingInvitations();
      return data.infospace_id;
    } catch (e: any) {
      toast.error(e.message || 'Failed to accept invitation');
      return null;
    }
  },

  declineInvitation: async (id: number) => {
    try {
      await apiFetch(`/api/v1/users/me/invitations/${id}/decline`, { method: 'POST' });
      toast.success('Invitation declined');
      await get().fetchPendingInvitations();
    } catch (e: any) {
      toast.error(e.message || 'Failed to decline invitation');
    }
  },

  // ─── Infospace collaborators ───

  fetchCollaborators: async (infospaceId: number) => {
    try {
      const data = await apiFetch<CollaboratorOut[]>(`/api/v1/infospaces/${infospaceId}/collaborators`);
      set({ collaborators: data });
    } catch (e: any) {
      console.error('Failed to fetch collaborators:', e);
    }
  },

  fetchInfospaceInvitations: async (infospaceId: number) => {
    try {
      const data = await apiFetch<InvitationOut[]>(`/api/v1/infospaces/${infospaceId}/invitations`);
      set({ infospaceInvitations: data });
    } catch (e: any) {
      console.error('Failed to fetch infospace invitations:', e);
    }
  },

  inviteCollaborator: async (infospaceId: number, identifier: string, role: string) => {
    try {
      await apiFetch(`/api/v1/infospaces/${infospaceId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ identifier, role }),
      });
      toast.success('Invitation sent');
      await get().fetchInfospaceInvitations(infospaceId);
    } catch (e: any) {
      toast.error(e.message || 'Failed to send invitation');
      throw e;
    }
  },

  revokeInvitation: async (infospaceId: number, invitationId: number) => {
    try {
      await apiFetch(`/api/v1/infospaces/${infospaceId}/invitations/${invitationId}`, {
        method: 'DELETE',
      });
      toast.success('Invitation revoked');
      await get().fetchInfospaceInvitations(infospaceId);
    } catch (e: any) {
      toast.error(e.message || 'Failed to revoke invitation');
    }
  },

  changeRole: async (infospaceId: number, userId: number, role: string) => {
    try {
      await apiFetch(`/api/v1/infospaces/${infospaceId}/collaborators/${userId}/role?role=${role}`, {
        method: 'PATCH',
      });
      toast.success('Role updated');
      await get().fetchCollaborators(infospaceId);
    } catch (e: any) {
      toast.error(e.message || 'Failed to change role');
    }
  },

  removeCollaborator: async (infospaceId: number, userId: number) => {
    try {
      await apiFetch(`/api/v1/infospaces/${infospaceId}/collaborators/${userId}`, {
        method: 'DELETE',
      });
      toast.success('Collaborator removed');
      await get().fetchCollaborators(infospaceId);
    } catch (e: any) {
      toast.error(e.message || 'Failed to remove collaborator');
    }
  },

  leaveInfospace: async (infospaceId: number) => {
    try {
      await apiFetch(`/api/v1/infospaces/${infospaceId}/collaborators/me`, {
        method: 'DELETE',
      });
      toast.success('Left infospace');
    } catch (e: any) {
      toast.error(e.message || 'Failed to leave infospace');
    }
  },

  // ─── User search ───

  searchUsers: async (query: string) => {
    if (!query.trim()) return [];
    try {
      return await apiFetch<UserSearchResult[]>(
        `/api/v1/users/handles/search?q=${encodeURIComponent(query)}&limit=10`
      );
    } catch {
      return [];
    }
  },
}));
