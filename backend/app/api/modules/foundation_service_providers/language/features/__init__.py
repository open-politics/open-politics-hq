"""
language/features — optional surfaces an endpoint may expose.
=============================================================

  Language.feature(name, module)     PROVIDES ─► bound as p.<name>(...)

    models_v1       {base}/v1/models ─► list_models
    models_ollama   /api/tags + /api/show
                      ─► list_models, model_capabilities
    model_pull      pull · delete ─► pull_model, delete_model
    props           /props ─► server_props, server_context_length
    prompt_caching  cacheable ─► cache_control ─► apply_cache_markers
    mcp             native MCP passthrough ─► mcp_tool

  NOT IN THIS FILE
    ../resolve.py   _compose_features — the loop that binds PROVIDES.

models_v1 and models_ollama both bind `list_models`; a declaration attaches
whichever matches the endpoint, and a caller never learns which one ran.
"""

from app.api.modules.foundation_service_providers.language.provider import Language


Language.feature("models_v1", module="models_v1")          # GET {base}/v1/models
Language.feature("models_ollama", module="models_ollama")  # GET /api/tags + POST /api/show
Language.feature("model_pull", module="pull")
Language.feature("props", module="props")
Language.feature("prompt_caching", module="caching")
Language.feature("mcp", module="mcp")
