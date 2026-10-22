"""
pull.py — feature: pull or delete a model on the endpoint itself.

The inventory belongs to the endpoint, not to a domain: an Ollama holds its
embedding models next to its language models and installs both the same way.
So the wire lives once, in language/features/pull.py, and this binding reuses it.
"""

from app.api.modules.foundation_service_providers.language.features.pull import (  # noqa: F401
    PROVIDES, delete_model, pull_model,
)
