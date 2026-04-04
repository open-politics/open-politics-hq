'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useCollaborationStore, type UserSearchResult } from '@/zustand_stores/storeCollaboration';

interface Props {
  infospaceId: number;
}

export function InviteCollaboratorModal({ infospaceId }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [selected, setSelected] = useState<string>(''); // handle or email
  const [role, setRole] = useState('viewer');
  const [sending, setSending] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const { searchUsers, inviteCollaborator } = useCollaborationStore();

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const r = await searchUsers(query);
      setResults(r);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, searchUsers]);

  const handleSelect = useCallback((user: UserSearchResult) => {
    setSelected(user.handle || '');
    setQuery(user.handle ? `@${user.handle}` : '');
    setResults([]);
  }, []);

  const handleSend = useCallback(async () => {
    const identifier = selected || query.trim();
    if (!identifier) return;
    setSending(true);
    try {
      await inviteCollaborator(infospaceId, identifier.replace(/^@/, ''), role);
      setOpen(false);
      setQuery('');
      setSelected('');
      setRole('viewer');
    } catch {
      // error toast handled by store
    } finally {
      setSending(false);
    }
  }, [selected, query, role, infospaceId, inviteCollaborator]);

  const isEmailFallback = query.includes('@') && query.includes('.') && results.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <UserPlus className="h-4 w-4 mr-2" />
          Invite
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite collaborator</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Search input */}
          <div className="space-y-2">
            <Label>Handle or email</Label>
            <Input
              placeholder="Search by @handle or enter email..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected('');
              }}
              autoFocus
            />
            {/* Autocomplete results */}
            {results.length > 0 && (
              <div className="border rounded-md max-h-48 overflow-y-auto">
                {results.map((u) => (
                  <button
                    key={u.id}
                    className="flex items-center gap-3 w-full px-3 py-2 hover:bg-muted text-left"
                    onClick={() => handleSelect(u)}
                  >
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={u.profile_picture_url || undefined} />
                      <AvatarFallback className="text-xs">
                        {(u.handle || u.full_name || '?').charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {u.handle ? `@${u.handle}` : u.full_name}
                      </p>
                      {u.handle && u.full_name && (
                        <p className="text-xs text-muted-foreground truncate">{u.full_name}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {isEmailFallback && (
              <p className="text-xs text-muted-foreground">
                No user found — will send email invitation to {query.trim()}
              </p>
            )}
          </div>

          {/* Role selector */}
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="analyst">Analyst — full working access</SelectItem>
                <SelectItem value="curator">Curator — organize only</SelectItem>
                <SelectItem value="viewer">Viewer — read only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Send */}
          <Button
            className="w-full"
            onClick={handleSend}
            disabled={sending || (!selected && !query.trim())}
          >
            {sending ? 'Sending...' : 'Send invitation'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
