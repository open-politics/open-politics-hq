"""
Services package.

This package contains the services that encapsulate the application's business logic.
Services abstract implementation details from the API layer and provide a clean interface
for performing business operations.

Note: DO NOT import service factories from this module to avoid circular dependencies.
Instead, import factories directly from app.api.deps.
"""

# This file is intentionally minimal to avoid circular dependencies.
# All service factories should be imported from app.api.deps module.