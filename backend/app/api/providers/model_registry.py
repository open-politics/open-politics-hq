"""
Model Registry Service for Language Model Provider Management
"""
import logging
from typing import Dict, List, Optional, Tuple, Union, AsyncIterator, Callable, Awaitable, Any
from dataclasses import dataclass

from app.api.providers.base import LanguageModelProvider, ModelInfo, GenerationResponse
from app.api.providers.impl.language_openai import OpenAILanguageModelProvider
from app.api.providers.impl.language_ollama import OllamaLanguageModelProvider
from app.api.providers.impl.language_gemini import GeminiLanguageModelProvider
from app.api.providers.impl.language_anthropic import AnthropicLanguageModelProvider

logger = logging.getLogger(__name__)


@dataclass
class ProviderConfig:
    """Configuration for a language model provider"""
    name: str
    provider_class: type
    config: Dict
    enabled: bool = True


class ModelRegistryService:
    """
    Centralized service for discovering and managing language model providers.
    
    This service:
    - Discovers models from all configured providers
    - Routes requests to the appropriate provider
    - Provides unified access to all language models
    - Handles provider failures gracefully
    """
    
    def __init__(self):
        self.providers: Dict[str, LanguageModelProvider] = {}
        self.models_cache: Dict[str, ModelInfo] = {}
        self.provider_configs: Dict[str, ProviderConfig] = {}
        logger.info("ModelRegistryService initialized")
    
    def add_provider(self, name: str, provider: LanguageModelProvider):
        """Add a provider to the registry"""
        self.providers[name] = provider
        logger.info(f"Added provider: {name}")
    
    def configure_provider(self, name: str, provider_class: type, config: Dict, enabled: bool = True):
        """Configure a provider (will be instantiated when needed)"""
        self.provider_configs[name] = ProviderConfig(
            name=name,
            provider_class=provider_class,
            config=config,
            enabled=enabled
        )
        logger.info(f"Configured provider: {name}")
    
    async def initialize_providers(self):
        """Initialize all configured providers"""
        for name, config in self.provider_configs.items():
            if not config.enabled:
                continue
                
            try:
                provider = config.provider_class(**config.config)
                self.providers[name] = provider
                logger.info(f"Initialized provider: {name}")
            except Exception as e:
                logger.error(f"Failed to initialize provider {name}: {e}")
    
    async def discover_all_models(self, force_refresh: bool = False) -> Dict[str, List[ModelInfo]]:
        """
        Discover models from all providers.
        
        Args:
            force_refresh: Whether to force refresh the cache
            
        Returns:
            Dict mapping provider names to their available models
        """
        if not force_refresh and self.models_cache:
            # Return cached results organized by provider
            results = {}
            for model_name, model_info in self.models_cache.items():
                provider_name = model_info.provider
                if provider_name not in results:
                    results[provider_name] = []
                results[provider_name].append(model_info)
            return results
        
        results = {}
        self.models_cache.clear()
        
        for provider_name, provider in self.providers.items():
            try:
                models = await provider.discover_models()
                results[provider_name] = models
                
                # Update cache
                for model in models:
                    self.models_cache[model.name] = model
                
                logger.info(f"Discovered {len(models)} models from {provider_name}")
                
            except Exception as e:
                logger.error(f"Failed to discover models from {provider_name}: {e}")
                results[provider_name] = []
        
        return results
    
    async def get_model_info(self, model_name: str) -> Optional[ModelInfo]:
        """Get information about a specific model"""
        # Check cache first
        if model_name in self.models_cache:
            return self.models_cache[model_name]
        
        # If not in cache, try to discover from all providers
        await self.discover_all_models()
        return self.models_cache.get(model_name)
    
    async def get_provider_for_model(self, model_name: str, runtime_api_keys: Optional[Dict[str, str]] = None) -> Tuple[Optional[LanguageModelProvider], Optional[str]]:
        """
        Find which provider has a specific model.
        
        Args:
            model_name: Name of the model to find
            runtime_api_keys: Runtime API keys from frontend (required for OpenAI, Anthropic, Gemini)
        
        Returns:
            Tuple of (provider_instance, provider_name) or (None, None) if not found
        """
        # First, try to find model in cache
        model_info = await self.get_model_info(model_name)
        
        # If not found and we have runtime API keys, try to discover from runtime providers
        if not model_info and runtime_api_keys:
            logger.info(f"Model '{model_name}' not in cache, attempting discovery with runtime API keys")
            
            # Try each provider in runtime_api_keys
            for provider_name, api_key in runtime_api_keys.items():
                if provider_name in ["openai", "anthropic", "gemini"] and api_key and api_key != "placeholder":
                    logger.info(f"Attempting to discover models from runtime provider: {provider_name}")
                    try:
                        runtime_provider = await self._create_runtime_provider(provider_name, api_key)
                        # After discovery, try to find the model again
                        model_info = await self.get_model_info(model_name)
                        if model_info:
                            logger.info(f"Found model '{model_name}' in provider '{provider_name}' after runtime discovery")
                            return runtime_provider, provider_name
                    except Exception as e:
                        logger.error(f"Failed to create runtime provider {provider_name}: {e}")
            
            # If still not found after trying all runtime providers
            if not model_info:
                logger.error(f"Model '{model_name}' not found after trying all runtime providers")
                return None, None
        
        # If we found the model info
        if model_info:
            provider_name = model_info.provider
            
            # For providers that need API keys, create runtime provider
            if provider_name in ["openai", "anthropic", "gemini"]:
                if not runtime_api_keys or provider_name not in runtime_api_keys:
                    logger.error(f"Provider '{provider_name}' requires API key from frontend")
                    return None, None
                
                api_key = runtime_api_keys[provider_name]
                if not api_key or api_key == "placeholder":
                    logger.error(f"Invalid API key for provider '{provider_name}'")
                    return None, None
                
                # Create runtime provider with frontend API key
                runtime_provider = await self._create_runtime_provider(provider_name, api_key)
                return runtime_provider, provider_name
            
            # For Ollama (no API key needed), use initialized provider
            provider = self.providers.get(provider_name)
            return provider, provider_name
        
        # Model not found at all
        return None, None
    
    async def _create_runtime_provider(self, provider_name: str, api_key: str) -> Optional[LanguageModelProvider]:
        """Create a provider instance with runtime API key and discover its models."""
        if provider_name == "openai":
            from app.api.providers.impl.language_openai import OpenAILanguageModelProvider
            provider = OpenAILanguageModelProvider(api_key=api_key)
            # Discover models for this runtime provider
            try:
                models = await provider.discover_models()
                for model in models:
                    self.models_cache[model.name] = model
                logger.info(f"Created runtime OpenAI provider and discovered {len(models)} models")
            except Exception as e:
                logger.error(f"Failed to discover models for runtime provider {provider_name}: {e}")
            return provider
        elif provider_name == "anthropic":
            from app.api.providers.impl.language_anthropic import AnthropicLanguageModelProvider
            provider = AnthropicLanguageModelProvider(api_key=api_key)
            # Discover models for this runtime provider
            try:
                models = await provider.discover_models()
                for model in models:
                    self.models_cache[model.name] = model
                logger.info(f"Created runtime Anthropic provider and discovered {len(models)} models")
            except Exception as e:
                logger.error(f"Failed to discover models for runtime provider {provider_name}: {e}")
            return provider
        elif provider_name == "gemini":
            from app.api.providers.impl.language_gemini import GeminiLanguageModelProvider
            provider = GeminiLanguageModelProvider(api_key=api_key)
            # Discover models for this runtime provider
            try:
                models = await provider.discover_models()
                for model in models:
                    self.models_cache[model.name] = model
                logger.info(f"Created runtime Gemini provider and discovered {len(models)} models")
            except Exception as e:
                logger.error(f"Failed to discover models for runtime provider {provider_name}: {e}")
            return provider
        else:
            logger.warning(f"Runtime provider creation not supported for: {provider_name}")
            return None
    
    async def generate(self, 
                      model_name: str,
                      messages: List[Dict[str, str]],
                      response_format: Optional[Dict] = None,
                      tools: Optional[List[Dict]] = None,
                      stream: bool = False,
                      thinking_enabled: bool = False,
                      tool_executor: Optional[Callable[[str, Dict[str, Any]], Awaitable[Dict[str, Any]]]] = None,
                      runtime_api_keys: Optional[Dict[str, str]] = None,
                      **kwargs) -> Union[GenerationResponse, AsyncIterator[GenerationResponse]]:
        """
        Generate response using the appropriate provider for the model.
        
        This is the main entry point for all language model interactions.
        
        Args:
            runtime_api_keys: Optional runtime API keys (e.g., {"openai": "sk-...", "anthropic": "sk-ant-..."})
        """
        provider, provider_name = await self.get_provider_for_model(model_name, runtime_api_keys)
        
        if not provider:
            raise ValueError(f"Model '{model_name}' not found in any provider")
        
        logger.debug(f"Routing model '{model_name}' to provider '{provider_name}'")
        
        try:
            return await provider.generate(
                messages=messages,
                model_name=model_name,
                response_format=response_format,
                tools=tools,
                stream=stream,
                thinking_enabled=thinking_enabled,
                tool_executor=tool_executor,
                **kwargs
            )
        except Exception as e:
            logger.error(f"Generation failed for model '{model_name}' on provider '{provider_name}': {e}")
            raise RuntimeError(f"Generation failed: {str(e)}")
    
    def get_models_by_capability(self, capability: str) -> List[ModelInfo]:
        """
        Get all models that support a specific capability.
        
        Args:
            capability: One of 'structured_output', 'tools', 'streaming', 'thinking', 'multimodal'
        """
        matching_models = []
        
        for model in self.models_cache.values():
            if getattr(model, f"supports_{capability}", False):
                matching_models.append(model)
        
        return matching_models
    
    def get_models_by_provider(self, provider_name: str) -> List[ModelInfo]:
        """Get all models from a specific provider"""
        return [model for model in self.models_cache.values() if model.provider == provider_name]
    
    def get_available_providers(self) -> List[str]:
        """Get list of available provider names"""
        return list(self.providers.keys())
    
    def get_provider_status(self) -> Dict[str, Dict]:
        """Get status of all providers"""
        status = {}
        
        for name, provider in self.providers.items():
            try:
                models = self.get_models_by_provider(name)
                status[name] = {
                    "available": True,
                    "model_count": len(models),
                    "models": [m.name for m in models]
                }
            except Exception as e:
                status[name] = {
                    "available": False,
                    "error": str(e),
                    "model_count": 0,
                    "models": []
                }
        
        return status
    
    # Convenience methods for common use cases
    async def classify(self, 
                      text_content: str,
                      schema: Dict,
                      model_name: str,
                      instructions: Optional[str] = None,
                      **kwargs) -> GenerationResponse:
        """
        Convenience method for structured classification/extraction.
        
        This replaces the old ClassificationProvider.classify() method.
        """
        messages = []
        
        if instructions:
            messages.append({"role": "system", "content": instructions})
        
        messages.append({"role": "user", "content": text_content})
        
        return await self.generate(
            model_name=model_name,
            messages=messages,
            response_format=schema,
            **kwargs
        )
    
    async def chat(self,
                  messages: List[Dict[str, str]],
                  model_name: str,
                  stream: bool = False,
                  **kwargs) -> Union[GenerationResponse, AsyncIterator[GenerationResponse]]:
        """
        Convenience method for chat conversations.
        """
        return await self.generate(
            model_name=model_name,
            messages=messages,
            stream=stream,
            **kwargs
        )
    
    async def analyze_with_tools(self,
                               query: str,
                               tools: List[Dict],
                               model_name: str,
                               context: Optional[str] = None,
                               **kwargs) -> GenerationResponse:
        """
        Convenience method for tool-augmented analysis.
        """
        messages = []
        
        if context:
            messages.append({"role": "system", "content": f"Context: {context}"})
        
        messages.append({"role": "user", "content": query})
        
        return await self.generate(
            model_name=model_name,
            messages=messages,
            tools=tools,
            **kwargs
        )



