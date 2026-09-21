"""Every AppSettings field has exactly one home.

`.env` holds what compromises the deployment if it leaks. `HQ.yml` holds
everything else. The split only stays true if something checks it — a field
added without a `validation_alias` silently reads from an environment that no
longer carries it, and falls back to its code default. That failure is quiet:
the stack boots, and `POSTGRES_DB` is `""`.

So: yaml-backed (AliasPath, no env name) XOR secret (env name, no AliasPath)
XOR explicitly code-internal. Never both, never neither.
"""
from app.core.config import ACCESS_LEVELS, AppSettings, is_yaml_backed

# Leaking one of these compromises the deployment. They live in .env only.
SECRETS = {
    "SECRET_KEY", "ENCRYPTION_MASTER_KEY", "ENCRYPTION_MASTER_KEY_FALLBACKS",
    "POSTGRES_PASSWORD", "REDIS_PASSWORD",
    "FIRST_SUPERUSER", "FIRST_SUPERUSER_PASSWORD",
    "SMTP_PASSWORD", "DISCOURSE_CONNECT_SECRET",
    "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY",
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "MISTRAL_API_KEY",
    "TAVILY_API_KEY", "JINA_API_KEY", "VOYAGE_API_KEY", "MAPBOX_ACCESS_TOKEN",
}

# Env-only, but not secret: wiring that tells the process where its config is
# and whether that config is current. These cannot live in the yaml — one names
# it, the other is a fingerprint OF it.
INFRASTRUCTURE = {
    "HQ_CONFIG_SHA",     # stamp written into .env by setup.sh; the staleness gate
}

# Not deployment configuration: constants, derived values, per-process identity.
CODE_INTERNAL = {
    "API_V1_STR",        # route prefix, a constant
    "INSTANCE_ID",       # generated per process
    "TEMP_FOLDER",       # scratch path
    "MCP_SERVER_URL",    # only set for a separate MCP container
}


def test_every_field_has_exactly_one_home():
    unplaced, double_homed = [], []
    for name, field in AppSettings.model_fields.items():
        in_yaml = is_yaml_backed(field)
        in_env = name in SECRETS or name in INFRASTRUCTURE
        internal = name in CODE_INTERNAL
        if sum((in_yaml, in_env, internal)) != 1:
            (double_homed if sum((in_yaml, in_env, internal)) > 1 else unplaced).append(name)

    assert not unplaced, (
        "Fields with no home — they will read from an environment that no longer "
        f"carries them and silently fall back to code defaults: {sorted(unplaced)}. "
        "Give each a validation_alias=AliasPath(...), or add it to SECRETS."
    )
    assert not double_homed, (
        f"Fields claimed by two homes: {sorted(double_homed)}. "
        "A value readable from two places is the divergence this split removes."
    )


def test_secrets_are_notis_yaml_backed():
    """A secret with an AliasPath would be readable from the non-secret file."""
    leaked = [n for n in SECRETS
              if n in AppSettings.model_fields and is_yaml_backed(AppSettings.model_fields[n])]
    assert not leaked, f"Secrets reachable from HQ.yml: {leaked}"


def test_no_minio_fields_remain():
    """MINIO_* became the generic S3 provider; leftovers would be dead config."""
    stale = [n for n in AppSettings.model_fields if n.startswith("MINIO_")]
    assert not stale, f"MINIO_* fields still declared: {stale}"


def test_access_levels_are_the_documented_four():
    assert ACCESS_LEVELS == ("all", "superuser", "byok", "none")
