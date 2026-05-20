"""
Encryption key rotation + decrypt-failure contract.

The core data-loss regression guard: a NON-EMPTY but undecryptable stored blob
must raise CredentialDecryptionError — never silently return {} (which the
read-modify-write credential endpoints would then persist, wiping every key).
"""
import json

import pytest
from cryptography.fernet import Fernet

from app.core.config import AppSettings
from app.core import security
from app.core.security import (
    encrypt_credentials,
    decrypt_credentials,
    CredentialDecryptionError,
)

KEY_A = Fernet.generate_key().decode()
KEY_B = Fernet.generate_key().decode()


def _settings(**overrides) -> AppSettings:
    defaults = {
        "FIRST_SUPERUSER": "test@test.com",
        "FIRST_SUPERUSER_PASSWORD": "testpass",
        "POSTGRES_SERVER": "localhost",
        "ENVIRONMENT": "local",
    }
    defaults.update(overrides)
    return AppSettings(**defaults)


@pytest.fixture
def use_keys(monkeypatch):
    """Point the security module at a given keyring and clear its cache."""
    def _apply(primary: str, fallbacks: str = ""):
        s = _settings(
            ENCRYPTION_MASTER_KEY=primary,
            ENCRYPTION_MASTER_KEY_FALLBACKS=fallbacks,
        )
        monkeypatch.setattr(security, "settings", s)
        security._reset_fernet_cache()
        return s
    yield _apply
    security._reset_fernet_cache()


# ── encryption_keys parsing ───────────────────────────────────────────────────

class TestEncryptionKeysParsing:
    def test_single_key(self):
        s = _settings(ENCRYPTION_MASTER_KEY=KEY_A)
        assert s.encryption_keys == [KEY_A]

    def test_primary_always_first(self):
        s = _settings(ENCRYPTION_MASTER_KEY=KEY_A, ENCRYPTION_MASTER_KEY_FALLBACKS=KEY_B)
        assert s.encryption_keys == [KEY_A, KEY_B]

    def test_whitespace_and_trailing_comma(self):
        s = _settings(
            ENCRYPTION_MASTER_KEY=f"  {KEY_A}  ",
            ENCRYPTION_MASTER_KEY_FALLBACKS=f" {KEY_B} , , ",
        )
        assert s.encryption_keys == [KEY_A, KEY_B]

    def test_empty(self):
        s = _settings(ENCRYPTION_MASTER_KEY="", ENCRYPTION_MASTER_KEY_FALLBACKS="")
        assert s.encryption_keys == []


# ── round-trip & rotation ─────────────────────────────────────────────────────

class TestRoundTrip:
    def test_single_key_backward_compat(self, use_keys):
        use_keys(KEY_A)
        blob = encrypt_credentials({"openai": "sk-1"})
        assert decrypt_credentials(blob) == {"openai": "sk-1"}

    def test_old_blob_readable_after_adding_new_primary(self, use_keys):
        use_keys(KEY_A)
        old_blob = encrypt_credentials({"anthropic": "sk-old"})
        # Rotate: NEW primary, OLD kept as decrypt-only fallback.
        use_keys(KEY_B, fallbacks=KEY_A)
        assert decrypt_credentials(old_blob) == {"anthropic": "sk-old"}

    def test_reencrypted_blob_reads_with_primary_alone(self, use_keys):
        use_keys(KEY_A)
        old_blob = encrypt_credentials({"jina": "jk"})
        use_keys(KEY_B, fallbacks=KEY_A)
        # Simulate the rotation command re-encrypting under the new primary.
        rotated = decrypt_credentials(old_blob)
        new_blob = encrypt_credentials(rotated)
        # Fallback removed — primary-only must still decrypt.
        use_keys(KEY_B)
        assert decrypt_credentials(new_blob) == {"jina": "jk"}

    def test_old_blob_unreadable_once_old_key_fully_retired(self, use_keys):
        use_keys(KEY_A)
        old_blob = encrypt_credentials({"x": "y"})
        use_keys(KEY_B)  # KEY_A gone entirely
        with pytest.raises(CredentialDecryptionError):
            decrypt_credentials(old_blob)


# ── the silent-wipe regression guard ──────────────────────────────────────────

class TestDecryptFailureContract:
    def test_empty_is_the_only_path_to_empty_dict(self, use_keys):
        use_keys(KEY_A)
        assert decrypt_credentials("") == {}
        assert decrypt_credentials(None) == {}

    def test_garbage_non_empty_raises(self, use_keys):
        use_keys(KEY_A)
        with pytest.raises(CredentialDecryptionError):
            decrypt_credentials("not-a-fernet-token")

    def test_wrong_key_raises_not_empty(self, use_keys):
        use_keys(KEY_A)
        blob = encrypt_credentials({"openai": "sk-secret"})
        use_keys(KEY_B)  # wrong key, no fallback
        with pytest.raises(CredentialDecryptionError):
            decrypt_credentials(blob)

    def test_valid_fernet_but_corrupt_json_raises(self, use_keys):
        use_keys(KEY_A)
        # Encrypt non-JSON payload directly with the active key.
        bad = Fernet(KEY_A.encode()).encrypt(b"not json at all").decode()
        with pytest.raises(CredentialDecryptionError):
            decrypt_credentials(bad)

    def test_read_modify_write_aborts_instead_of_wiping(self, use_keys):
        """The exact bug: existing creds undecryptable → must NOT merge onto {}."""
        use_keys(KEY_A)
        existing_blob = encrypt_credentials({"openai": "keep-me", "jina": "keep-me-too"})
        use_keys(KEY_B)  # rotation/misconfig: existing blob now undecryptable

        # Simulates save_credentials' read step. Old code returned {}, then
        # encrypt_credentials({**{}, "anthropic": "new"}) wiped openai+jina.
        with pytest.raises(CredentialDecryptionError):
            _ = decrypt_credentials(existing_blob)
        # Because it raised, the caller aborts and existing_blob is untouched.
        use_keys(KEY_A)
        assert decrypt_credentials(existing_blob) == {
            "openai": "keep-me",
            "jina": "keep-me-too",
        }
