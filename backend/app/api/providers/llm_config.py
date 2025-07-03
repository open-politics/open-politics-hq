import json
import os
from typing import Dict, List, Any, Optional
from pathlib import Path

class LLMModelsConfig:
    """Utility class to load and manage LLM models configuration."""
    
    def __init__(self):
        self._config = None
        self._load_config()
    
    def _load_config(self):
        """Load the LLM models configuration from JSON file."""
        config_path = Path(__file__).parent / "config_llm_models.json"
        try:
            with open(config_path, 'r') as f:
                self._config = json.load(f)
        except FileNotFoundError:
            raise FileNotFoundError(f"LLM configuration file not found at {config_path}")
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in LLM configuration: {e}")
    
    def get_provider_config(self, provider_name: str) -> Optional[Dict[str, Any]]:
        """Get configuration for a specific provider."""
        return self._config.get("providers", {}).get(provider_name.lower())
    
    def get_provider_models(self, provider_name: str) -> Dict[str, Dict[str, Any]]:
        """Get all models for a specific provider."""
        provider_config = self.get_provider_config(provider_name)
        if provider_config:
            return provider_config.get("models", {})
        return {}
    
    def get_model_config(self, provider_name: str, model_name: str) -> Optional[Dict[str, Any]]:
        """Get configuration for a specific model."""
        models = self.get_provider_models(provider_name)
        return models.get(model_name)
    
    def list_all_providers(self) -> List[str]:
        """List all available providers."""
        return list(self._config.get("providers", {}).keys())
    
    def list_provider_models(self, provider_name: str) -> List[str]:
        """List all model names for a provider."""
        return list(self.get_provider_models(provider_name).keys())
    
    def get_recommended_models(self, use_case: Optional[str] = None, provider: Optional[str] = None) -> List[str]:
        """Get recommended models for a specific use case or provider."""
        if use_case:
            recommended = self._config.get("recommended_models", {}).get(use_case, [])
            if provider:
                # Filter by provider
                provider_models = self.list_provider_models(provider)
                return [model for model in recommended if model in provider_models]
            return recommended
        
        if provider:
            # Return all recommended models for this provider
            models = self.get_provider_models(provider)
            return [name for name, config in models.items() if config.get("recommended", False)]
        
        # Return general purpose recommendations
        return self._config.get("recommended_models", {}).get("classification", [])
    
    def get_default_provider(self, environment: str = "development") -> str:
        """Get the default provider for an environment."""
        return self._config.get("default_providers", {}).get(environment, "ollama")
    
    def get_default_model_for_use_case(self, use_case: str, environment: str = "development") -> Optional[str]:
        """Get the default model for a specific use case and environment."""
        use_case_defaults = self._config.get("use_case_defaults", {})
        if use_case in use_case_defaults:
            return use_case_defaults[use_case].get(environment)
        return None
    
    def get_models_by_capability(self, capability: str, provider: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get all models that support a specific capability (e.g., 'multimodal', 'structured_output')."""
        matching_models = []
        
        providers_to_check = [provider] if provider else self.list_all_providers()
        
        for prov in providers_to_check:
            models = self.get_provider_models(prov)
            for model_name, model_config in models.items():
                if model_config.get(f"supports_{capability}", False):
                    matching_models.append({
                        "provider": prov,
                        "name": model_name,
                        **model_config
                    })
        
        return matching_models
    
    def get_models_by_tags(self, tags: List[str], provider: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get all models that have any of the specified tags."""
        matching_models = []
        
        providers_to_check = [provider] if provider else self.list_all_providers()
        
        for prov in providers_to_check:
            models = self.get_provider_models(prov)
            for model_name, model_config in models.items():
                model_tags = model_config.get("tags", [])
                if any(tag in model_tags for tag in tags):
                    matching_models.append({
                        "provider": prov,
                        "name": model_name,
                        **model_config
                    })
        
        return matching_models
    
    def get_models_by_context_length(self, min_context_length: int, provider: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get all models with context length >= min_context_length."""
        matching_models = []
        
        providers_to_check = [provider] if provider else self.list_all_providers()
        
        for prov in providers_to_check:
            models = self.get_provider_models(prov)
            for model_name, model_config in models.items():
                context_length = model_config.get("context_length", 0)
                if context_length >= min_context_length:
                    matching_models.append({
                        "provider": prov,
                        "name": model_name,
                        **model_config
                    })
        
        return matching_models
    
    def get_provider_connection_config(self, provider_name: str) -> Dict[str, Any]:
        """Get connection configuration for a provider."""
        provider_config = self.get_provider_config(provider_name)
        if not provider_config:
            return {}
        
        result = {}
        
        # Base URL configuration
        if "base_url_env" in provider_config:
            result["base_url"] = os.getenv(
                provider_config["base_url_env"], 
                provider_config.get("default_base_url")
            )
        elif "base_url" in provider_config:
            result["base_url"] = provider_config["base_url"]
        
        # API Key configuration
        if "api_key_env" in provider_config:
            result["api_key"] = os.getenv(provider_config["api_key_env"])
        
        # Provider type and description
        result["type"] = provider_config.get("type", "unknown")
        result["description"] = provider_config.get("description", "")
        
        return result
    
    def validate_model_exists(self, provider_name: str, model_name: str) -> bool:
        """Check if a model exists in the configuration."""
        return self.get_model_config(provider_name, model_name) is not None
    
    def get_model_max_tokens(self, provider_name: str, model_name: str) -> Optional[int]:
        """Get the max tokens for a specific model."""
        model_config = self.get_model_config(provider_name, model_name)
        return model_config.get("max_tokens") if model_config else None
    
    def get_model_context_length(self, provider_name: str, model_name: str) -> Optional[int]:
        """Get the context length for a specific model."""
        model_config = self.get_model_config(provider_name, model_name)
        return model_config.get("context_length") if model_config else None
    
    def get_model_cost(self, provider_name: str, model_name: str) -> Dict[str, Optional[float]]:
        """Get cost information for a specific model."""
        model_config = self.get_model_config(provider_name, model_name)
        if not model_config:
            return {"input": None, "output": None}
        
        return {
            "input": model_config.get("cost_per_1k_input_tokens"),
            "output": model_config.get("cost_per_1k_output_tokens")
        }
    
    def supports_multimodal(self, provider_name: str, model_name: str) -> bool:
        """Check if a model supports multimodal input."""
        model_config = self.get_model_config(provider_name, model_name)
        return model_config.get("supports_multimodal", False) if model_config else False
    
    def supports_structured_output(self, provider_name: str, model_name: str) -> bool:
        """Check if a model supports structured output."""
        model_config = self.get_model_config(provider_name, model_name)
        return model_config.get("supports_structured_output", False) if model_config else False
    
    def supports_thinking(self, provider_name: str, model_name: str) -> bool:
        """Check if a model supports thinking/reasoning."""
        model_config = self.get_model_config(provider_name, model_name)
        return model_config.get("supports_thinking", False) if model_config else False

# Global instance
llm_models_config = LLMModelsConfig() 