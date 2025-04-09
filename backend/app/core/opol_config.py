from app.core.config import settings

# Import OPOL for centralized instance
try:
    from opol import OPOL
except ImportError:
    OPOL = None

# Initialize OPOL instance
opol = None
if OPOL:
    opol = OPOL(mode=settings.OPOL_MODE, api_key=settings.OPOL_API_KEY)

# Available AI providers and models
available_providers = [
    {
        "name": "Google",
        "models": ["gemini-2.0-flash"],
    }
]


def get_fastclass(
    provider: str = "Google",
    model_name: str = "gemini-2.0-flash",
    api_key: str | None = None,
):
    """
    Get a classification instance with the specified provider and model.

    Args:
        provider: The AI provider to use (default: "Google").
        model_name: The model name to use (default: "gemini-2.0-flash").
        api_key: Optional API key to use instead of the default.

    Returns:
        An OPOL classification instance.
    """
    # Validate provider
    valid_provider = any(
        provider_info["name"] == provider for provider_info in available_providers
    )

    if not valid_provider:
        provider = "Google"  # Default to Google if invalid provider

    # Validate model name (although currently not used)
    if not model_name:
        model_name = "gemini-2.0-flash"

    if opol is None:
        raise ValueError("OPOL is not initialized.")

    return opol.classification(model_name=model_name, llm_api_key=api_key)


# Create a default fastclass instance
fastclass = get_fastclass()