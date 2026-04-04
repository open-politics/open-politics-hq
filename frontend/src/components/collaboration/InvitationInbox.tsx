'use client';

import { useEffect, useCallback } from 'react';
import { Bell, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useCollaborationStore } from '@/zustand_stores/storeCollaboration';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

export function InvitationInbox() {
  const {
    pendingInvitations, pendingCount,
    fetchPendingInvitations, fetchPendingCount,
    acceptInvitation, declineInvitation,
  } = useCollaborationStore();
  const { fetchInfospaces, setActiveInfospace } = useInfospaceStore();

  // Poll for count on mount + interval
  useEffect(() => {
    fetchPendingCount();
    const interval = setInterval(fetchPendingCount, 30_000);
    return () => clearInterval(interval);
  }, [fetchPendingCount]);

  const handleAccept = useCallback(async (id: number) => {
    const infospaceId = await acceptInvitation(id);
    await fetchInfospaces(); // refresh sidebar
    if (infospaceId) setActiveInfospace(infospaceId); // auto-switch to the accepted infospace
  }, [acceptInvitation, fetchInfospaces, setActiveInfospace]);

  if (pendingCount === 0) {
    return (
      <Button variant="ghost" size="icon" className="relative h-8 w-8 text-muted-foreground">
        <Bell className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <Popover onOpenChange={(open) => { if (open) fetchPendingInvitations(); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8">
          <Bell className="h-4 w-4" />
          <Badge
            variant="destructive"
            className="absolute -right-1 -top-1 h-4 min-w-4 px-1 text-[10px] leading-none"
          >
            {pendingCount}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">Invitations</p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {pendingInvitations.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No pending invitations</p>
          ) : (
            pendingInvitations.map((inv) => (
              <div key={inv.id} className="flex items-start gap-3 border-b px-4 py-3 last:border-0">
                <Avatar className="h-8 w-8 mt-0.5">
                  <AvatarFallback className="text-xs">
                    {inv.infospace_name?.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{inv.infospace_name}</p>
                  <p className="text-xs text-muted-foreground">
                    by {inv.inviter_handle ? `@${inv.inviter_handle}` : inv.inviter_name || 'Unknown'}
                    {' as '}
                    <span className="capitalize">{inv.role}</span>
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
                    onClick={() => handleAccept(inv.id)}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => declineInvitation(inv.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
