import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { UsersService } from '@/client';
import type { ProviderDefaults, ProviderSelection as BackendProviderSelection } from '@/client';

// Provider types match backend capabilities
export type ProviderCapability = 'llm' | 'embedding' | 'logic' | 'web_search' | 'geocoding' | 'ocr' | 'annotation';

// Mirrors CatalogModel / CatalogProvider from the generated client. Kept as an
// interface rather than importing the generated type so the store's own shape
// stays explicit, but every field below exists on the wire — see
// GET /providers/{infospace_id}/catalog.
export interface ProviderModelSpec {
  name: string;
  description?: string;
  /** "curated" — declared in the backend catalog. "live" — reported by the endpoint. */
  source?: string;
  supports_tools?: boolean | null;
  supports_streaming?: boolean | null;
  supports_thinking?: boolean | null;
  supports_multimodal?: boolean | null;
  supports_structured_output?: boolean | null;
  supports_prompt_caching?: boolean | null;
  max_tokens?: number | null;
  context_length?: number | null;
  dimension?: number | null;
  max_sequence_length?: number | null;
}

export interface ProviderMetadata {
  id: string;
  name: string;
  description: string;
  requires_api_key: boolean;
  api_key_name?: string;
  api_key_url?: string;
  is_local: boolean;
  has_env_fallback: boolean;
  features: string[];
  /** Whether this endpoint manages its own model inventory. Ask this, never the id. */
  pullable?: boolean;
  /** Reports its inventory live. Not the same as pullable: llama.cpp lists
   *  the one GGUF it serves but cannot install another. */
  listable?: boolean;
  /** The wire it speaks. Two providers sharing one share a wire. */
  dialect?: string;
  /** True when the provider requires an explicit model_name for save-validation to pass. */
  model_required?: boolean;
  /** Curated models. Empty for endpoints whose inventory is runtime-discovered. */
  models?: ProviderModelSpec[];
}

//: Backend domain name → the store's capability key. Only 'language' differs;
//: the UI has always called it 'llm'. Everything else is identity, so a new
//: backend domain appears under its own name without an edit here.
export const DOMAIN_TO_CAPABILITY: Record<string, ProviderCapability> = {
  language: 'llm',
};

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
  syncToBackend: () => void;
  hydrateFromProfile: (providerDefaults: ProviderDefaults | null | undefined) => void;

  // Helpers
  // Accept null: every caller reads a selection that may not be made yet, and
  // all three already answer "not found" for an unknown id.
  getProvider: (providerId: string | null | undefined) => ProviderMetadata | undefined;
  getApiKey: (providerId: string) => string | undefined;
  hasApiKey: (providerId: string | null | undefined) => boolean;
  needsApiKey: (providerId: string | null | undefined) => boolean;
}

export const useProvidersStore = create<ProvidersState>()(
  persist(
    (set, get) => ({
      providers: {
        llm: [],
        embedding: [],
        logic: [],
        web_search: [],
        geocoding: [],
        ocr: [],
        annotation: [],
      },

      apiKeys: {},

      // Seeded empty on purpose. Hardcoding provider ids here is what rotted:
      // 'gemini' no longer exists at all, 'ollama_embeddings' and
      // 'nominatim_local' are ids the backend has never emitted. A selection is
      // only ever valid against the live catalog, so it starts absent and every
      // consumer already reads it with `selections[cap]?.providerId`.
      selections: {
        llm: {} as ProviderSelection,
        embedding: {} as ProviderSelection,
        logic: {} as ProviderSelection,
        web_search: {} as ProviderSelection,
        geocoding: {} as ProviderSelection,
        ocr: {} as ProviderSelection,
        annotation: {} as ProviderSelection,
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

      syncToBackend: () => {
        const { selections } = get();
        const toSel = (s: ProviderSelection | undefined): BackendProviderSelection | null =>
          s?.providerId ? { provider_key: s.providerId, model_name: s.modelId || null } : null;
        const defaults: ProviderDefaults = {
          language: {
            default: toSel(selections.llm),
            chat: toSel(selections.llm),
            annotation: toSel(selections.annotation),
          },
          embedding: toSel(selections.embedding),
          // Decisions: one selection, no context split. A logic endpoint serves
          // the checkpoint it loaded, so model_name rides along as provenance
          // only — the picker shows what is answering, it does not choose it.
          logic: toSel(selections.logic),
          web_search: toSel(selections.web_search),
          ocr: toSel(selections.ocr),
          geocoding: toSel(selections.geocoding),
        };
        UsersService.updateUserMe({ requestBody: { provider_defaults: defaults } })
          .catch((e) => console.warn('Failed to sync provider defaults:', e));
      },

      hydrateFromProfile: (providerDefaults: ProviderDefaults | null | undefined) => {
        if (!providerDefaults) return;
        const fromSel = (sel: BackendProviderSelection | null | undefined): ProviderSelection | undefined =>
          sel?.provider_key ? { providerId: sel.provider_key, modelId: sel.model_name || undefined } : undefined;

        set((state) => {
          const next = { ...state.selections };
          if (providerDefaults.language?.default) {
            next.llm = fromSel(providerDefaults.language.default) || next.llm;
          }
          if (providerDefaults.language?.annotation) {
            next.annotation = fromSel(providerDefaults.language.annotation) || next.annotation;
          }
          if (providerDefaults.embedding) {
            next.embedding = fromSel(providerDefaults.embedding) || next.embedding;
          }
          if (providerDefaults.logic) {
            next.logic = fromSel(providerDefaults.logic) || next.logic;
          }
          if (providerDefaults.web_search) {
            next.web_search = fromSel(providerDefaults.web_search) || next.web_search;
          }
          if (providerDefaults.ocr) {
            next.ocr = fromSel(providerDefaults.ocr) || next.ocr;
          }
          if (providerDefaults.geocoding) {
            next.geocoding = fromSel(providerDefaults.geocoding) || next.geocoding;
          }
          return { selections: next };
        });
      },

      // Helpers
      getProvider: (providerId) => {
        if (!providerId) return undefined;
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
        return !!providerId && !!get().apiKeys[providerId];
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
      // v2 drops persisted selections. Browsers still hold the old seeds, and
      // those ids ('gemini', 'ollama_embeddings', 'nominatim_local') name
      // providers this backend cannot resolve — a stale pick fails at run time
      // with a confusing error rather than falling back. API keys are kept.
      version: 2,
      migrate: (persisted: any, version: number) => {
        if (version >= 2) return persisted;
        return { ...persisted, selections: {} };
      },
    }
  )
);

