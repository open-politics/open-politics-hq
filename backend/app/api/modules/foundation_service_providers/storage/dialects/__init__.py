"""
storage/dialects — which wires exist.

  s3           MinIO · Garage · R2 · B2 · Wasabi · AWS
  filesystem   a local volume
"""

from app.api.modules.foundation_service_providers.storage.provider import Storage


Storage.dialect("s3", module="s3", adapter="S3Storage")
Storage.dialect("filesystem", module="filesystem", adapter="FilesystemStorage")
