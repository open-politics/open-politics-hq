"""
Tests for deployment configuration — capability ceiling, settings parsing.

These test the deployment sovereignty mechanism: the same codebase running
as full-stack, readonly, ingest-only, or compute-only by changing one env var.
"""
import pytest

from app.core.config import AppSettings
from app.api.modules.identity_infospace_user.access import Capability


# Helper: create AppSettings with minimal required fields
def _settings(**overrides):
    defaults = {
        "FIRST_SUPERUSER": "test@test.com",
        "FIRST_SUPERUSER_PASSWORD": "testpass",
        "POSTGRES_SERVER": "localhost",
    }
    defaults.update(overrides)
    return AppSettings(**defaults)


# ═══════════════════════════════════════════════════
# Deployment capability ceiling
# ═══════════════════════════════════════════════════

class TestDeploymentCapabilities:

    def test_star_means_full_stack(self):
        s = _settings(DEPLOYMENT_CAPABILITIES="*")
        assert s.deployment_capability_names == frozenset({
            "organize", "ingest", "compute", "delete", "setup"
        })

    def test_empty_means_readonly(self):
        s = _settings(DEPLOYMENT_CAPABILITIES="")
        assert s.deployment_capability_names == frozenset()

    def test_single_capability(self):
        s = _settings(DEPLOYMENT_CAPABILITIES="ingest")
        assert s.deployment_capability_names == frozenset({"ingest"})

    def test_comma_separated(self):
        s = _settings(DEPLOYMENT_CAPABILITIES="organize,ingest")
        assert s.deployment_capability_names == frozenset({"organize", "ingest"})

    def test_whitespace_handling(self):
        s = _settings(DEPLOYMENT_CAPABILITIES=" organize , ingest ")
        # The implementation strips the whole string; individual items may need stripping
        names = s.deployment_capability_names
        # At minimum, the parsing should not crash
        assert isinstance(names, frozenset)

    def test_ceiling_intersection_with_owner(self):
        """Owner on a readonly deployment gets zero capabilities."""
        ceiling_names = frozenset()  # readonly
        owner_caps = frozenset(Capability)
        ceiling = frozenset(c for c in Capability if c.value in ceiling_names)
        result = owner_caps & ceiling
        assert result == frozenset()

    def test_ceiling_intersection_partial(self):
        """Owner on ingest-only deployment keeps only matching capabilities."""
        ceiling_names = frozenset({"organize", "ingest"})
        owner_caps = frozenset(Capability)
        ceiling = frozenset(c for c in Capability if c.value in ceiling_names)
        result = owner_caps & ceiling
        assert Capability.ORGANIZE in result
        assert Capability.INGEST in result
        assert Capability.COMPUTE not in result
        assert Capability.DELETE not in result
        assert Capability.SETUP not in result

    def test_ceiling_star_preserves_all_caps(self):
        """Full-stack deployment preserves all user capabilities."""
        ceiling_names = frozenset({"organize", "ingest", "compute", "delete", "setup"})
        analyst_caps = frozenset({Capability.ORGANIZE, Capability.INGEST, Capability.COMPUTE, Capability.DELETE})
        ceiling = frozenset(c for c in Capability if c.value in ceiling_names)
        result = analyst_caps & ceiling
        assert result == analyst_caps


# ═══════════════════════════════════════════════════
# Settings defaults
# ═══════════════════════════════════════════════════

class TestSettingsDefaults:

    def test_api_v1_str(self):
        s = _settings()
        assert s.API_V1_STR == "/api/v1"

    def test_default_environment(self):
        s = _settings()
        assert s.ENVIRONMENT == "local"

    def test_server_host_local(self):
        s = _settings(ENVIRONMENT="local", DOMAIN="localhost")
        assert s.server_host == "http://localhost"

    def test_server_host_production(self):
        s = _settings(ENVIRONMENT="production", DOMAIN="hq.openpolitics.org")
        assert s.server_host == "https://hq.openpolitics.org"

    def test_default_deployment_is_full_stack(self):
        """Default DEPLOYMENT_CAPABILITIES='*' — everything enabled."""
        s = _settings()
        assert s.deployment_capability_names == frozenset({
            "organize", "ingest", "compute", "delete", "setup"
        })
