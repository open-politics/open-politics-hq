"""
logic/features — optional surfaces a decision endpoint may expose.

  Logic.feature(name, module)     PROVIDES ─► bound as p.<name>(...)

    loaded_model   GET /v1/models ─► list_models

Nothing here installs or switches a model: a decision server loads one
checkpoint at startup. The listing is a read, so a setup UI can show what is
answering rather than offer a choice the server ignores.
"""

from app.api.modules.foundation_service_providers.logic.provider import Logic


Logic.feature("loaded_model", module="models")      # GET {base}/v1/models
