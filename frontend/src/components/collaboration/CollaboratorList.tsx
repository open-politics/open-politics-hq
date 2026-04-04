'use client';

import { useEffect } from 'react';
import { Crown, X, Clock, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useCollaborationStore } from '@/zustand_stores/storeCollaboration';
import { InviteCollaboratorModal } from './InviteCollaboratorModal';

interface Props {
  infospaceId: number;
  isOwner: boolean;
}

export function CollaboratorList({ infospaceId, isOwner }: Props) {
  const {
    collaborators, infospaceInvitations,
    fetchCollaborators, fetchInfospaceInvitations,
    changeRole, removeCollaborator, revokeInvitation,
    leaveInfospace,
  } = useCollaborationStore();

  useEffect(() => {
    fetchCollaborators(infospaceId);
    if (isOwner) fetchInfospaceInvitations(infospaceId);
  }, [infospaceId, isOwner, fetchCollaborators, fetchInfospaceInvitations]);

  const pendingInvitations = infospaceInvitations.filter((i) => i.status === 'pending');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Team</h3>
        {isOwner && <InviteCollaboratorModal infospaceId={infospaceId} />}
      </div>

      {/* Active collaborators */}
      <div className="space-y-2">
        {collaborators.map((c) => (
          <div key={c.user_id} className="flex items-center gap-3 py-2">
            <Avatar className="h-8 w-8">
              <AvatarImage src={c.profile_picture_url || undefined} />
              <AvatarFallback className="text-xs">
                {(c.handle || c.full_name || '?').charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">
                  {c.handle ? `@${c.handle}` : c.full_name || 'Unknown'}
                </span>
                {c.is_owner && <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
              </div>
              {c.handle && c.full_name && (
                <p className="text-xs text-muted-foreground truncate">{c.full_name}</p>
              )}
            </div>
            {c.is_owner ? (
              <Badge variant="outline" className="text-xs shrink-0">Owner</Badge>
            ) : isOwner ? (
              <div className="flex items-center gap-1 shrink-0">
                <Select
                  value={c.role}
                  onValueChange={(val) => changeRole(infospaceId, c.user_id, val)}
                >
                  <SelectTrigger className="h-7 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="analyst">Analyst</SelectItem>
                    <SelectItem value="curator">Curator</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-red-600"
                  onClick={() => removeCollaborator(infospaceId, c.user_id)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Badge variant="secondary" className="text-xs capitalize shrink-0">{c.role}</Badge>
            )}
          </div>
        ))}
      </div>

      {/* Pending invitations (owner only) */}
      {isOwner && pendingInvitations.length > 0 && (
        <div className="space-y-2 pt-2 border-t">
          <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
            <Clock className="h-3 w-3" /> Pending
          </p>
          {pendingInvitations.map((inv) => (
            <div key={inv.id} className="flex items-center gap-3 py-1.5">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-xs">
                  {(inv.invitee_handle || inv.invitee_email || '?').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <span className="text-sm truncate">
                  {inv.invitee_handle ? `@${inv.invitee_handle}` : inv.invitee_email}
                </span>
                <Badge variant="secondary" className="ml-2 text-xs capitalize">{inv.role}</Badge>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-muted-foreground hover:text-red-600"
                onClick={() => revokeInvitation(infospaceId, inv.id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Self-removal for non-owners */}
      {!isOwner && (
        <div className="pt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-red-600"
            onClick={() => leaveInfospace(infospaceId)}
          >
            <UserMinus className="h-4 w-4 mr-2" />
            Leave infospace
          </Button>
        </div>
      )}
    </div>
  );
}
