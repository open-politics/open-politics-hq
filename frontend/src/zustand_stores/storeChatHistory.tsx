import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChatConversationMessage {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  message_metadata?: Record<string, unknown>;
  tool_calls?: Array<Record<string, unknown>>;
  tool_executions?: Array<Record<string, unknown>>;
  thinking_trace?: string;
  model_used?: string;
  usage?: Record<string, unknown>;
  created_at: string;
}

export interface ChatConversation {
  id: number;
  uuid: string;
  title: string;
  description?: string;
  infospace_id: number;
  user_id: number;
  model_name?: string;
  temperature?: number;
  conversation_metadata?: Record<string, unknown>;
  is_archived: boolean;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  last_message_at?: string;
  message_count?: number;
}

export interface ChatConversationWithMessages extends ChatConversation {
  messages: ChatConversationMessage[];
}

interface ChatHistoryState {
  // State
  conversations: ChatConversation[];
  activeConversationId: number | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setConversations: (conversations: ChatConversation[]) => void;
  addConversation: (conversation: ChatConversation) => void;
  updateConversation: (id: number, updates: Partial<ChatConversation>) => void;
  removeConversation: (id: number) => void;
  setActiveConversation: (id: number | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearConversations: () => void;
  
  // Pin/Archive actions
  togglePinConversation: (id: number) => void;
  toggleArchiveConversation: (id: number) => void;
}

// Helper function to sort conversations: pinned first, then by last activity (newest first)
const sortConversations = (conversations: ChatConversation[]): ChatConversation[] => {
  return [...conversations].sort((a, b) => {
    // Pinned conversations always come first
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    
    // Sort by last_message_at (most recent first)
    const aTime = a.last_message_at || a.updated_at || a.created_at;
    const bTime = b.last_message_at || b.updated_at || b.created_at;
    
    if (!aTime && !bTime) return 0;
    if (!aTime) return 1;
    if (!bTime) return -1;
    
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });
};

export const useChatHistoryStore = create<ChatHistoryState>()(
  persist(
    (set, get) => ({
      // Initial state
      conversations: [],
      activeConversationId: null,
      isLoading: false,
      error: null,

      // Actions
      setConversations: (conversations) => {
        set({ conversations: sortConversations(conversations), error: null });
      },

      addConversation: (conversation) => {
        set((state) => ({
          conversations: sortConversations([conversation, ...state.conversations]),
          error: null,
        }));
      },

      updateConversation: (id, updates) => {
        set((state) => ({
          conversations: sortConversations(
            state.conversations.map((conv) =>
              conv.id === id ? { ...conv, ...updates } : conv
            )
          ),
          error: null,
        }));
      },

      removeConversation: (id) => {
        set((state) => ({
          conversations: state.conversations.filter((conv) => conv.id !== id),
          activeConversationId:
            state.activeConversationId === id ? null : state.activeConversationId,
          error: null,
        }));
      },

      setActiveConversation: (id) => {
        set({ activeConversationId: id });
      },

      setLoading: (loading) => {
        set({ isLoading: loading });
      },

      setError: (error) => {
        set({ error });
      },

      clearConversations: () => {
        set({
          conversations: [],
          activeConversationId: null,
          error: null,
        });
      },

      togglePinConversation: (id) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === id ? { ...conv, is_pinned: !conv.is_pinned } : conv
          ),
        }));
      },

      toggleArchiveConversation: (id) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === id ? { ...conv, is_archived: !conv.is_archived } : conv
          ),
        }));
      },
    }),
    {
      name: 'chat-history-storage',
      partialize: (state) => ({
        activeConversationId: state.activeConversationId,
        // Don't persist conversations - fetch fresh from server
      }),
    }
  )
);


