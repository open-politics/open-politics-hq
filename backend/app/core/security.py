import bcrypt
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
import logging

from jose import JWTError, jwt
from cryptography.fernet import Fernet, MultiFernet, InvalidToken

from app.core.config import settings

ALGORITHM = "HS256"
logger = logging.getLogger(__name__)


class CredentialDecryptionError(Exception):
    """Stored ciphertext is present but undecryptable with any configured key
    (or decrypts to corrupt JSON).

    Raised instead of silently returning ``{}`` — the old behavior, combined
    with the read-modify-write credential endpoints, would persist an empty
    blob and irreversibly wipe every other stored key for that user. Callers
    must surface this loudly (503 / ProviderError), never substitute ``{}``.
    """


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

# Lazy per-process MultiFernet singleton. There is no shared cache: each
# process (uvicorn workers, celery_worker, celery_beat) builds its own on first
# use and must be RESTARTED to pick up rotated keys. See ./setup.sh rotate.
_fernet: Optional[MultiFernet] = None


def _get_multifernet() -> MultiFernet:
    """Build (once) a MultiFernet from settings.encryption_keys.

    Index 0 (ENCRYPTION_MASTER_KEY) is the write key; all keys are decrypt
    candidates so ciphertext written under a rotated-out key still reads during
    a rotation window. A single-key .env yields a one-element MultiFernet that
    behaves exactly like the previous single-Fernet implementation.
    """
    global _fernet
    if _fernet is None:
        keys = settings.encryption_keys
        if not keys:
            # FAIL HARD in production — no silent ephemeral key.
            if settings.ENVIRONMENT == "production":
                raise RuntimeError(
                    "ENCRYPTION_MASTER_KEY must be set in production environment. "
                    "Generate with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
                )
            logger.warning(
                "ENCRYPTION_MASTER_KEY not set, generating temporary key. "
                "This is INSECURE and stored credentials will be lost on restart. "
                "Set ENCRYPTION_MASTER_KEY in production."
            )
            keys = [Fernet.generate_key().decode()]
        _fernet = MultiFernet([Fernet(k.encode()) for k in keys])
    return _fernet


def _reset_fernet_cache() -> None:
    """Drop the in-process MultiFernet singleton so the next call rebuilds it
    from current settings. In-process ONLY — does not reach other workers.
    Used by the rotation command and tests after settings are changed."""
    global _fernet
    _fernet = None


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
    encrypted = _get_multifernet().encrypt(json_str.encode())
    return encrypted.decode()


def decrypt_credentials(encrypted: Optional[str]) -> Dict[str, str]:
    """
    Decrypt credentials string to dict.
    
    Args:
        encrypted: Base64-encoded encrypted string from database
    
    Returns:
        Dict mapping provider_id to api_key. Empty dict ONLY when nothing is
        stored (input is None/empty).

    Raises:
        CredentialDecryptionError — input is non-empty but no configured key
        can decrypt it, or it decrypts to corrupt JSON. Never silently
        returns {} for a non-empty blob (that would wipe creds on next save).
    """
    if not encrypted:
        return {}
    try:
        decrypted = _get_multifernet().decrypt(encrypted.encode())
    except InvalidToken as e:
        logger.error("Credential decryption failed: no configured key matches the stored ciphertext")
        raise CredentialDecryptionError(
            "Stored credentials cannot be decrypted with any configured key "
            "(key rotation in progress or ENCRYPTION_MASTER_KEY misconfigured)."
        ) from e
    try:
        return json.loads(decrypted.decode())
    except (ValueError, json.JSONDecodeError) as e:
        logger.error(f"Decrypted credentials are not valid JSON: {e}")
        raise CredentialDecryptionError(
            "Stored credentials decrypted but contain corrupt data."
        ) from e


def generate_password_reset_token(email: str) -> str:
    delta = timedelta(hours=settings.EMAIL_RESET_TOKEN_EXPIRE_HOURS)
    now = datetime.now(timezone.utc)
    expires = now + delta
    encoded_jwt = jwt.encode(
        {"exp": expires.timestamp(), "nbf": now.timestamp(), "sub": email},
        settings.SECRET_KEY,
        algorithm=ALGORITHM,
    )
    return encoded_jwt


def verify_password_reset_token(token: str) -> str | None:
    try:
        decoded = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        return str(decoded["sub"])
    except JWTError:
        return None


def generate_email_verification_token(email: str) -> str:
    delta = timedelta(hours=24)
    now = datetime.now(timezone.utc)
    expires = now + delta
    encoded_jwt = jwt.encode(
        {"exp": expires.timestamp(), "nbf": now.timestamp(), "sub": email, "type": "email_verification"},
        settings.SECRET_KEY,
        algorithm=ALGORITHM,
    )
    return encoded_jwt


def verify_email_verification_token(token: str) -> str | None:
    try:
        decoded = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        if decoded.get("type") != "email_verification":
            return None
        return str(decoded["sub"])
    except JWTError:
        return None


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

    Raises:
        CredentialDecryptionError — propagated from decrypt_credentials when a
        stored blob is present but undecryptable. Deliberately not caught: a
        background task must fail loudly, not run with zero credentials.
    """
    stored = decrypt_credentials(user_encrypted)
    runtime = runtime_keys or {}
    # Runtime keys override stored keys (user intent for this specific operation)
    return {**stored, **runtime}
