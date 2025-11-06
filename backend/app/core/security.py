import bcrypt
import os
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
import logging

from jose import jwt
from cryptography.fernet import Fernet

from app.core.config import settings

ALGORITHM = "HS256"
logger = logging.getLogger(__name__)


def create_access_token(subject: str | Any, expires_delta: timedelta) -> str:
    expire = datetime.now(timezone.utc) + expires_delta
    to_encode = {"exp": expire, "sub": str(subject)}
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))


def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')


# ============================================================================
# ENCRYPTED CREDENTIALS MANAGEMENT
# ============================================================================
# For storing user API keys securely for background/scheduled tasks
# Uses Fernet (AES-128 CBC + HMAC) for authenticated encryption

# Lazy-load encryption key
_fernet = None


def _get_fernet() -> Fernet:
    """Get or create Fernet cipher instance."""
    global _fernet
    if _fernet is None:
        key = os.environ.get("ENCRYPTION_MASTER_KEY")
        if not key:
            # FAIL HARD in production
            environment = os.environ.get("ENVIRONMENT", "local")
            if environment == "production":
                raise RuntimeError(
                    "ENCRYPTION_MASTER_KEY must be set in production environment. "
                    "Generate with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
                )
            # Dev fallback with warning
            logger.warning(
                "ENCRYPTION_MASTER_KEY not set, generating temporary key. "
                "This is INSECURE and keys will be lost on restart. "
                "Set ENCRYPTION_MASTER_KEY in production."
            )
            key = Fernet.generate_key().decode()
        _fernet = Fernet(key.encode() if isinstance(key, str) else key)
    return _fernet


def encrypt_credentials(credentials: Dict[str, str]) -> str:
    """
    Encrypt provider credentials dict to encrypted string.
    
    Args:
        credentials: Dict mapping provider_id to api_key (e.g., {"openai": "sk-..."})
    
    Returns:
        Base64-encoded encrypted string
    """
    if not credentials:
        return ""
    json_str = json.dumps(credentials)
    encrypted = _get_fernet().encrypt(json_str.encode())
    return encrypted.decode()


def decrypt_credentials(encrypted: Optional[str]) -> Dict[str, str]:
    """
    Decrypt credentials string to dict.
    
    Args:
        encrypted: Base64-encoded encrypted string from database
    
    Returns:
        Dict mapping provider_id to api_key, or empty dict if decryption fails
    """
    if not encrypted:
        return {}
    try:
        decrypted = _get_fernet().decrypt(encrypted.encode())
        return json.loads(decrypted.decode())
    except Exception as e:
        logger.error(f"Failed to decrypt credentials: {e}", exc_info=True)
        return {}


def merge_credentials(
    user_encrypted: Optional[str],
    runtime_keys: Optional[Dict[str, str]] = None
) -> Dict[str, str]:
    """
    Merge stored credentials with runtime keys.
    
    Priority:
    1. Runtime keys (user-provided for immediate operations)
    2. Stored encrypted keys (for background tasks)
    
    This enables dual-mode: users can provide runtime keys for one-off operations
    or save keys for scheduled/background tasks.
    
    Args:
        user_encrypted: Encrypted credentials from user.encrypted_credentials
        runtime_keys: Runtime API keys from frontend (optional)
    
    Returns:
        Merged dict with runtime keys taking precedence over stored
    """
    stored = decrypt_credentials(user_encrypted)
    runtime = runtime_keys or {}
    # Runtime keys override stored keys (user intent for this specific operation)
    return {**stored, **runtime}
