"""
storage/models.py — this domain's data models.
==============================================

  StorageQuirks   endpoint deviations within a dialect
"""

from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class StorageQuirks:
    """Endpoint deviations within a storage dialect."""
    #: Create the bucket if missing. (s3/self-hosted — a cloud create would 403.)
    create_bucket: bool = True
