"""
logic — decisions as app data.

  models.py   Decision: name · description · config (JSONB)

The capability that answers a decision is the `logic` provider domain
(foundation_service_providers/logic). This module is only what a user keeps:
a decision they set up, saved so they can run it again.
"""

from app.api.modules.logic.models import Decision

__all__ = ["Decision"]
