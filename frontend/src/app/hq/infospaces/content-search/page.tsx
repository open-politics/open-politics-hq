'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Search,
  Send,
  Loader2,
  Brain,
  MessageCircle,
  Settings,
  RefreshCw,
  AlertCircle,
  Lightbulb,
  Bot,
  User,
  Copy,
} from 'lucide-react';
import { OpenAPI } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useProvidersStore } from '@/zustand_stores/storeProviders';
import { toast } from 'sonner';

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  metadata?: {
    model?: string;
    sources?: Array<{
      asset_id: number;
      title: string;
      score: number;
      snippet: string;
    }>;
    processing_time?: number;
  };
}

interface SearchConfig {
  model: string;
  providerName: string;
  enableThinking: boolean;
  temperature: number;
  topK: number;
}

const suggestedQuestions = [
  "What are the main themes discussed in these documents?",
  "Can you summarize the key findings?",
  "Who are the important people mentioned?",
  "What organizations are involved?",
  "What locations are referenced?",
  "What events took place and when?",
  "Are there any contradictions between sources?",
  "What questions remain unanswered?",
];

export default function ContentSearchPage() {
  const { activeInfospace } = useInfospaceStore();
  const { selections } = useProvidersStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Derive defaults from the global provider store
  const defaultModel = selections.llm?.modelId || '';
  const defaultProvider = selections.llm?.providerId || '';

  const [config, setConfig] = useState<SearchConfig>({
    model: defaultModel,
    providerName: defaultProvider,
    enableThinking: false,
    temperature: 0.1,
    topK: 5,
  });

  // Sync config when provider store selections change
  React.useEffect(() => {
    setConfig(prev => ({
      ...prev,
      model: prev.model || selections.llm?.modelId || '',
      providerName: prev.providerName || selections.llm?.providerId || '',
    }));
  }, [selections.llm?.modelId, selections.llm?.providerId]);

  const canSearch = !!activeInfospace?.id && (!!config.providerName || !!defaultProvider);

  const handleSearch = async (question: string = inputValue) => {
    if (!question.trim()) {
      toast.error('Please enter a question');
      return;
    }
    if (!activeInfospace?.id) {
      toast.error('No active infospace selected');
      return;
    }

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: question.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const providerName = config.providerName || defaultProvider;
      const modelName = config.model || defaultModel;

      const requestBody = {
        question: question.trim(),
        model: modelName || undefined,
        provider_name: providerName || undefined,
        enable_thinking: config.enableThinking,
        temperature: config.temperature,
        top_k: config.topK,
      };

      // Resolve auth headers from the OpenAPI config
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (OpenAPI.HEADERS) {
        const resolved = typeof OpenAPI.HEADERS === 'function' ? await OpenAPI.HEADERS({} as any) : OpenAPI.HEADERS;
        headers = { ...headers, ...resolved };
      }

      const startTime = Date.now();
      const res = await fetch(
        `${OpenAPI.BASE}/api/v1/infospaces/${activeInfospace.id}/rag`,
        {
          method: 'POST',
          headers,
          credentials: OpenAPI.WITH_CREDENTIALS ? 'include' : 'same-origin',
          body: JSON.stringify(requestBody),
        },
      );

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(errorBody.detail || `Request failed (${res.status})`);
      }

      const response = await res.json();
      const processingTime = response.processing_time_ms || (Date.now() - startTime);

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: response.answer || 'No answer generated',
        timestamp: new Date(),
        metadata: {
          model: response.model || modelName,
          sources: response.sources || [],
          processing_time: processingTime,
        },
      };

      setMessages(prev => [...prev, assistantMessage]);
      toast.success(`Answer generated in ${(processingTime / 1000).toFixed(1)}s`);
    } catch (error: any) {
      console.error('Search error:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: `Error: ${error.message || 'Failed to generate answer'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
      toast.error('Failed to search content');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  const clearChat = () => {
    setMessages([]);
    toast.success('Chat cleared');
  };

  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
    toast.success('Copied to clipboard');
  };

  return (
    <div className="h-full flex flex-col min-h-[91svh] md:min-h-[92.75svh] max-h-[92.75svh] w-full max-w-full overflow-y-auto scrollbar-hide">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Search className="h-6 w-6" />
            Content Search
          </h1>
          <p className="text-muted-foreground">
            Ask questions about your assets using AI-powered retrieval
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
          {messages.length > 0 && (
            <Button variant="outline" size="sm" onClick={clearChat}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Clear Chat
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-0">
        {/* Settings Panel */}
        {showSettings && (
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-sm">Search Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="llm-provider">LLM Provider</Label>
                <Input
                  id="llm-provider"
                  placeholder="e.g. google, openai, ollama"
                  value={config.providerName}
                  onChange={(e) => setConfig(prev => ({ ...prev, providerName: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Uses your default provider if left empty
                </p>
              </div>

              <div>
                <Label htmlFor="llm-model">Language Model</Label>
                <Input
                  id="llm-model"
                  placeholder="e.g. gemini-2.0-flash"
                  value={config.model}
                  onChange={(e) => setConfig(prev => ({ ...prev, model: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Uses your default model if left empty
                </p>
              </div>

              <div>
                <Label htmlFor="top-k">Top K Results</Label>
                <Input
                  id="top-k"
                  type="number"
                  min="1"
                  max="50"
                  value={config.topK}
                  onChange={(e) => setConfig(prev => ({ ...prev, topK: parseInt(e.target.value) || 5 }))}
                />
              </div>

              <div>
                <Label htmlFor="temperature">Temperature</Label>
                <Input
                  id="temperature"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={config.temperature}
                  onChange={(e) => setConfig(prev => ({ ...prev, temperature: parseFloat(e.target.value) || 0.1 }))}
                />
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="thinking"
                  checked={config.enableThinking}
                  onCheckedChange={(checked) => setConfig(prev => ({ ...prev, enableThinking: checked }))}
                />
                <Label htmlFor="thinking">Enable Thinking</Label>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main Chat Area */}
        <Card className={`flex flex-col ${showSettings ? 'lg:col-span-3' : 'lg:col-span-4'}`}>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                AI Assistant
              </CardTitle>
              <Badge variant="outline">
                {config.model || defaultModel || 'No model selected'}
              </Badge>
            </div>
          </CardHeader>

          {/* Messages Area */}
          <CardContent className="flex-1 p-0 min-h-0">
            <ScrollArea className="h-full p-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
                  <div className="text-muted-foreground">
                    <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <h3 className="text-lg font-medium mb-2">Start a conversation</h3>
                    <p className="text-sm">Ask questions about your documents and assets</p>
                  </div>

                  <div className="w-full max-w-2xl">
                    <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <Lightbulb className="h-4 w-4" />
                      Suggested questions:
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {suggestedQuestions.map((question, index) => (
                        <Button
                          key={index}
                          variant="outline"
                          size="sm"
                          className="h-auto p-3 text-left justify-start whitespace-normal"
                          onClick={() => handleSearch(question)}
                          disabled={isLoading || !canSearch}
                        >
                          {question}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex gap-3 ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`flex gap-3 max-w-[80%] ${message.type === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                          {message.type === 'user' ? (
                            <User className="h-4 w-4" />
                          ) : (
                            <Bot className="h-4 w-4" />
                          )}
                        </div>
                        <div className={`flex flex-col space-y-2 ${message.type === 'user' ? 'items-end' : 'items-start'}`}>
                          <div
                            className={`rounded-lg px-4 py-2 ${
                              message.type === 'user'
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted'
                            }`}
                          >
                            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                          </div>

                          {message.metadata && (
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <Badge variant="secondary" className="text-xs">
                                {message.metadata.model}
                              </Badge>
                              {message.metadata.processing_time && (
                                <span>{(message.metadata.processing_time / 1000).toFixed(1)}s</span>
                              )}
                              {message.metadata.sources && message.metadata.sources.length > 0 && (
                                <span>{message.metadata.sources.length} sources</span>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2"
                                onClick={() => copyMessage(message.content)}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                          )}

                          {message.metadata?.sources && message.metadata.sources.length > 0 && (
                            <div className="w-full">
                              <details className="text-xs">
                                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                  View {message.metadata.sources.length} sources
                                </summary>
                                <div className="mt-2 space-y-1 border-l-2 border-muted pl-3">
                                  {message.metadata.sources.map((source, index) => (
                                    <div key={index} className="text-xs">
                                      <div className="font-medium">{source.title || `Asset ${source.asset_id}`}</div>
                                      <div className="text-muted-foreground truncate">
                                        {source.snippet?.substring(0, 150)}...
                                      </div>
                                      <div className="text-muted-foreground">
                                        Similarity: {(source.score * 100).toFixed(1)}%
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {isLoading && (
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                        <Bot className="h-4 w-4" />
                      </div>
                      <div className="bg-muted rounded-lg px-4 py-2">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-sm text-muted-foreground">Searching and generating answer...</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
          </CardContent>

          {/* Input Area */}
          <div className="border-t p-4">
            <div className="flex gap-2">
              <Textarea
                placeholder="Ask a question about your content..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyPress}
                className="min-h-[60px] resize-none"
                disabled={isLoading}
              />
              <Button
                onClick={() => handleSearch()}
                disabled={isLoading || !inputValue.trim() || !canSearch}
                size="lg"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>

            {!canSearch && (
              <Alert className="mt-2">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {!activeInfospace?.id
                    ? 'Please select an infospace to start asking questions.'
                    : 'Please configure an LLM provider in Settings or in the Provider Hub.'}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
