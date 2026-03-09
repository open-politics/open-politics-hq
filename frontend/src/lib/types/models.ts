export interface Model {
  id: string
  name: string
  provider: string
  providerId: string
}

export const models: Model[] = [
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    provider: 'OpenAI',
    providerId: 'openai'
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 mini',
    provider: 'OpenAI',
    providerId: 'openai'
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    providerId: 'anthropic'
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'Anthropic',
    providerId: 'anthropic'
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    provider: 'Google Generative AI',
    providerId: 'google'
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'Google Generative AI',
    providerId: 'google'
  },
  {
    id: 'llama3-groq-8b-8192-tool-use-preview',
    name: 'LLama 3 Groq 8B Tool Use',
    provider: 'Groq',
    providerId: 'groq'
  },
  {
    id: 'qwen2.5',
    name: 'Qwen 2.5',
    provider: 'Ollama',
    providerId: 'ollama'
  },
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    provider: 'Azure',
    providerId: 'azure'
  },
  {
    id: process.env.NEXT_PUBLIC_OPENAI_COMPATIBLE_MODEL || 'undefined',
    name: process.env.NEXT_PUBLIC_OPENAI_COMPATIBLE_MODEL || 'Undefined',
    provider: 'OpenAI Compatible',
    providerId: 'openai-compatible'
  }
]
