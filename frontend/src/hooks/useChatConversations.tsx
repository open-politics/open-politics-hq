import { useCallback } from 'react';
import { toast } from 'sonner';
import { useChatHistoryStore, ChatConversation, ChatConversationWithMessages } from '@/zustand_stores/storeChatHistory';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { OpenAPI } from '@/client/core/OpenAPI';

export function useChatConversations() {
  const { 
    conversations, 
    activeConversationId,
    isLoading,
    error,
    setConversations,
    addConversation,
    updateConversation,
    removeConversation,
    setActiveConversation,
    setLoading,
    setError,
    togglePinConversation,
    toggleArchiveConversation,
  } = useChatHistoryStore();

  const { activeInfospace } = useInfospaceStore();

  const getHeaders = useCallback(async () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const maybeHeaders = (OpenAPI.HEADERS as any);
      const resolved = typeof maybeHeaders === 'function' ? await maybeHeaders({} as any) : maybeHeaders;
      if (resolved && typeof resolved === 'object') {
        Object.assign(headers, resolved);
      }
      if (!headers['Authorization'] && typeof window !== 'undefined') {
        const token = localStorage.getItem('access_token');
        if (token) headers['Authorization'] = `Bearer ${token}`;
      }
    } catch {}
    return headers;
  }, []);

  const fetchConversations = useCallback(async (infospaceId?: number, includeArchived = false) => {
    setLoading(true);
    setError(null);
    
    try {
      const targetInfospaceId = infospaceId || activeInfospace?.id;
      if (!targetInfospaceId) {
        throw new Error('No infospace selected');
      }

      const headers = await getHeaders();
      const params = new URLSearchParams({
        ...(targetInfospaceId && { infospace_id: targetInfospaceId.toString() }),
        include_archived: includeArchived.toString(),
        limit: '50',
      });

      const response = await fetch(`/api/v1/chat/conversations?${params}`, {
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch conversations: ${response.status}`);
      }

      const data = await response.json();
      setConversations(data.data || []);
      return data.data;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch conversations';
      setError(errorMessage);
      toast.error(errorMessage);
      return [];
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, setConversations, setLoading, setError, getHeaders]);

  const createConversation = useCallback(async (
    title: string,
    description?: string,
    model_name?: string,
    temperature?: number
  ): Promise<ChatConversation | null> => {
    if (!activeInfospace?.id) {
      toast.error('Please select an active infospace');
      return null;
    }

    setLoading(true);
    try {
      const headers = await getHeaders();
      const response = await fetch('/api/v1/chat/conversations', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          title,
          description,
          infospace_id: activeInfospace.id,
          model_name,
          temperature,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create conversation: ${response.status}`);
      }

      const conversation = await response.json();
      addConversation(conversation);
      toast.success('Conversation created');
      return conversation;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to create conversation';
      toast.error(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, addConversation, setLoading, getHeaders]);

  const getConversation = useCallback(async (conversationId: number): Promise<ChatConversationWithMessages | null> => {
    setLoading(true);
    try {
      const headers = await getHeaders();
      const response = await fetch(`/api/v1/chat/conversations/${conversationId}`, {
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch conversation: ${response.status}`);
      }

      const conversation = await response.json();
      return conversation;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch conversation';
      toast.error(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, [setLoading, getHeaders]);

  const updateConversationDetails = useCallback(async (
    conversationId: number,
    updates: {
      title?: string;
      description?: string;
      model_name?: string;
      temperature?: number;
      is_archived?: boolean;
      is_pinned?: boolean;
    }
  ): Promise<boolean> => {
    setLoading(true);
    try {
      const headers = await getHeaders();
      const response = await fetch(`/api/v1/chat/conversations/${conversationId}`, {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error(`Failed to update conversation: ${response.status}`);
      }

      const conversation = await response.json();
      updateConversation(conversationId, conversation);
      toast.success('Conversation updated');
      return true;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to update conversation';
      toast.error(errorMessage);
      return false;
    } finally {
      setLoading(false);
    }
  }, [updateConversation, setLoading, getHeaders]);

  const deleteConversation = useCallback(async (conversationId: number): Promise<boolean> => {
    setLoading(true);
    try {
      const headers = await getHeaders();
      const response = await fetch(`/api/v1/chat/conversations/${conversationId}`, {
        method: 'DELETE',
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed to delete conversation: ${response.status}`);
      }

      removeConversation(conversationId);
      toast.success('Conversation deleted');
      return true;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to delete conversation';
      toast.error(errorMessage);
      return false;
    } finally {
      setLoading(false);
    }
  }, [removeConversation, setLoading, getHeaders]);

  const pinConversation = useCallback(async (conversationId: number): Promise<boolean> => {
    const conversation = conversations.find(c => c.id === conversationId);
    if (!conversation) return false;
    
    const success = await updateConversationDetails(conversationId, {
      is_pinned: !conversation.is_pinned
    });
    
    if (success) {
      togglePinConversation(conversationId);
    }
    
    return success;
  }, [conversations, updateConversationDetails, togglePinConversation]);

  const archiveConversation = useCallback(async (conversationId: number): Promise<boolean> => {
    const conversation = conversations.find(c => c.id === conversationId);
    if (!conversation) return false;
    
    const success = await updateConversationDetails(conversationId, {
      is_archived: !conversation.is_archived
    });
    
    if (success) {
      toggleArchiveConversation(conversationId);
    }
    
    return success;
  }, [conversations, updateConversationDetails, toggleArchiveConversation]);

  return {
    // State
    conversations,
    activeConversationId,
    isLoading,
    error,

    // Actions
    fetchConversations,
    createConversation,
    getConversation,
    updateConversationDetails,
    deleteConversation,
    setActiveConversation,
    pinConversation,
    archiveConversation,
  };
}


