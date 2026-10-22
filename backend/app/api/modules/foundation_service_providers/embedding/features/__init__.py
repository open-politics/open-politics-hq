"""
embedding features — probe_model · list_models · model_pull (ollama) · verify (keyed endpoints).
"""

from app.api.modules.foundation_service_providers.embedding.provider import Embedding


Embedding.feature("probe_model", module="probe")
Embedding.feature("verify", module="verify")
Embedding.feature("list_models", module="models")
Embedding.feature("model_pull", module="pull")
