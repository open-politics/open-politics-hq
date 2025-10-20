import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Provider types match backend capabilities
export type ProviderCapability = 'llm' | 'embedding' | 'search' | 'geocoding';

export interface ProviderMetadata {
  id: string;
  name: string;
  description: string;
  requires_api_key: boolean;
  api_key_name?: string;
  api_key_url?: string;
  is_local: boolean;
  is_oss: boolean;      // Open source
  is_free: boolean;     // Free tier available
  has_env_fallback: boolean;
  features: string[];
  rate_limited?: boolean;
  rate_limit_info?: string;
}

export interface ProviderSelection {
  providerId: string;
  modelId?: string; // For LLM and embedding providers
}

interface ProvidersState {
  // Provider metadata (fetched from backend)
  providers: Record<ProviderCapability, ProviderMetadata[]>;
  
  // API Keys (user-provided, stored locally)
  apiKeys: Record<string, string>; // provider_id -> api_key
  
  // Active selections per capability
  selections: Record<ProviderCapability, ProviderSelection>;
  
  // Actions
  setProviders: (capability: ProviderCapability, providers: ProviderMetadata[]) => void;
  setApiKey: (providerId: string, key: string) => void;
  removeApiKey: (providerId: string) => void;
  setSelection: (capability: ProviderCapability, selection: ProviderSelection) => void;
  clearAllKeys: () => void;
  
  // Helpers
  getProvider: (providerId: string) => ProviderMetadata | undefined;
  getApiKey: (providerId: string) => string | undefined;
  hasApiKey: (providerId: string) => boolean;
  needsApiKey: (providerId: string) => boolean;
}

export const useProvidersStore = create<ProvidersState>()(
  persist(
    (set, get) => ({
      providers: {
        llm: [],
        embedding: [],
        search: [],
        geocoding: [],
      },
      
      apiKeys: {},
      
      selections: {
        llm: { providerId: 'gemini' },
        embedding: { providerId: 'ollama_embeddings' },
        search: { providerId: 'tavily' },
        geocoding: { providerId: 'nominatim_local' },
      },
      
      setProviders: (capability, providers) =>
        set((state) => ({
          providers: {
            ...state.providers,
            [capability]: providers,
          },
        })),
      
      setApiKey: (providerId, key) =>
        set((state) => ({
          apiKeys: { ...state.apiKeys, [providerId]: key },
        })),
      
      removeApiKey: (providerId) =>
        set((state) => {
          const { [providerId]: _, ...rest } = state.apiKeys;
          return { apiKeys: rest };
        }),
      
      setSelection: (capability, selection) =>
        set((state) => ({
          selections: {
            ...state.selections,
            [capability]: selection,
          },
        })),
      
      clearAllKeys: () =>
        set({
          apiKeys: {},
        }),
      
      // Helpers
      getProvider: (providerId) => {
        const state = get();
        for (const capability of Object.keys(state.providers) as ProviderCapability[]) {
          const provider = state.providers[capability].find(p => p.id === providerId);
          if (provider) return provider;
        }
        return undefined;
      },
      
      getApiKey: (providerId) => {
        return get().apiKeys[providerId];
      },
      
      hasApiKey: (providerId) => {
        return !!get().apiKeys[providerId];
      },
      
      needsApiKey: (providerId) => {
        const provider = get().getProvider(providerId);
        if (!provider) return false;
        return provider.requires_api_key && !provider.has_env_fallback;
      },
    }),
    {
      name: 'providers-storage',
      // Only persist API keys and selections, not provider metadata
      partialize: (state) => ({
        apiKeys: state.apiKeys,
        selections: state.selections,
      }),
    }
  )
);

