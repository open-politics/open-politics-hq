from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status
from pydantic.networks import EmailStr
import fitz
from io import BytesIO
from typing import Dict, Any, Optional, List
import requests
from datetime import datetime, timezone

from app.api.deps import get_current_active_superuser, get_current_user, ContentIngestionServiceDep, SessionDep, CurrentUser
from app.schemas import Message, ProviderInfo, ProviderModel, ProviderListResponse
from app.utils import generate_test_email, send_email
from app.core.opol_config import opol
from app.core.config import settings
import logging

# Type alias for current user
CurrentUser = get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/utils", tags=["Utilities"])


@router.post(
    "/test-email/",
    dependencies=[Depends(get_current_active_superuser)],
    status_code=201,
)
def test_email(email_to: EmailStr) -> Message:
    """
    Test emails.
    """
    email_data = generate_test_email(email_to=email_to)
    send_email(
        email_to=email_to,
        subject=email_data.subject,
        html_content=email_data.html_content,
    )
    return Message(message="Test email sent")


@router.get('/healthz')
def healthz():
    return {"status": "ok"}, 200

@router.get('/healthz/readiness')
def readyz():
    return {"status": "ok"}, 200

@router.get('/healthz/liveness')
def liveness():
    return {"status": "ok"}, 200

@router.get('/rss-countries')
def get_available_rss_countries():
    """
    Get list of available countries for RSS feed discovery from awesome-rss-feeds repository.
    """
    countries = [
        "Australia", "Bangladesh", "Brazil", "Canada", "Germany", "Spain", "France",
        "United Kingdom", "Hong Kong SAR China", "Indonesia", "Ireland", "India",
        "Iran", "Italy", "Japan", "Myanmar (Burma)", "Mexico", "Nigeria",
        "Philippines", "Pakistan", "Poland", "Russia", "Ukraine", "United States",
        "South Africa"
    ]
    
    return {
        "countries": countries,
        "count": len(countries),
        "source": "awesome-rss-feeds",
        "description": "Available countries for RSS feed discovery from the awesome-rss-feeds repository"
    }

@router.get("/discover-rss-feeds")
async def discover_rss_feeds(
    *,
    session: SessionDep,
    content_service: ContentIngestionServiceDep,
    country: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 50
) -> Any:
    """
    Discover RSS feeds from the awesome-rss-feeds repository.
    
    Args:
        country: Country name (e.g., "Australia", "United States") - if None, returns all countries
        category: Category filter (e.g., "News", "Technology") - if None, returns all categories
        limit: Maximum number of feeds to return
    """
    try:

        
        feeds = await content_service.discover_rss_feeds_from_awesome_repo(
            country=country,
            category=category,
            limit=limit
        )
        
        return {
            "feeds": feeds,
            "count": len(feeds),
            "country": country,
            "category": category,
            "limit": limit
        }
        
    except Exception as e:
        logger.error(f"RSS feed discovery failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"RSS feed discovery failed: {str(e)}"
        )

@router.post("/extract-pdf-text")
async def extract_pdf_text(
    file: UploadFile = File(...),
):
    """Extract text from PDF without authentication"""
    if not file.filename.lower().endswith(".pdf"):
        return {"error": "Only PDF files are supported"}
    
    try:
        contents = await file.read()
        text = ""
        with fitz.open(stream=contents, filetype="pdf") as doc:
            for page in doc:
                text += page.get_text() + "\n"
        return {"text": text}
    except Exception as e:
        return {"error": f"PDF processing failed: {str(e)}"}

@router.post("/extract-pdf-metadata")
async def extract_pdf_metadata(
    file: UploadFile = File(...),
):
    """Extract metadata from PDF including title, author, etc."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    
    try:
        contents = await file.read()
        with fitz.open(stream=contents, filetype="pdf") as doc:
            # Extract metadata
            metadata = doc.metadata
            
            # Extract first page text for potential title extraction
            first_page_text = ""
            if doc.page_count > 0:
                first_page = doc[0]
                first_page_text = first_page.get_text()
            
            # Try to extract title from metadata or first page
            title = metadata.get("title", "")
            if not title and first_page_text:
                # If no title in metadata, try to extract from first page
                # Get first non-empty line that's not too long (likely a title)
                lines = [line.strip() for line in first_page_text.split('\n') if line.strip()]
                if lines and len(lines[0]) < 100:  # Assume title is not extremely long
                    title = lines[0]
            
            # Extract text content from all pages
            text_content = ""
            for page in doc:
                text_content += page.get_text() + "\n"
            
            # Create a summary from the first few paragraphs
            summary = ""
            paragraphs = [p for p in text_content.split('\n\n') if p.strip()]
            if paragraphs:
                # Use first paragraph or first 500 chars as summary
                summary = paragraphs[0][:500] + ("..." if len(paragraphs[0]) > 500 else "")
            
            return {
                "title": title or file.filename.replace(".pdf", ""),
                "author": metadata.get("author", ""),
                "subject": metadata.get("subject", ""),
                "keywords": metadata.get("keywords", ""),
                "creator": metadata.get("creator", ""),
                "producer": metadata.get("producer", ""),
                "text_content": text_content,
                "summary": summary,
                "page_count": doc.page_count
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF processing failed: {str(e)}")


@router.get("/scrape_article")
async def scrape_article(url: str):
    """
    Scrape article content from a URL using the configured scraping provider.
    
    Args:
        url: The URL of the article to scrape
        
    Returns:
        The scraped article content
    """
    try:
        from app.api.providers.factory import create_scraping_provider
        scraping_provider = create_scraping_provider(settings)
        
        article_data = await scraping_provider.scrape_url(url)
        
        return article_data

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to scrape article: {str(e)}"
        )

@router.get("/analyze_source")
async def analyze_source(base_url: str):
    """
    Analyze a news source to discover RSS feeds, categories, and recent articles.
    
    Args:
        base_url: The base URL of the news source to analyze
        
    Returns:
        Source analysis results including RSS feeds, categories, and articles
    """
    try:
        from app.api.providers.factory import create_scraping_provider
        scraping_provider = create_scraping_provider(settings)
        
        analysis_result = await scraping_provider.analyze_source(base_url)
        
        return analysis_result

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to analyze source: {str(e)}"
        )

@router.get("/discover_rss_feeds")
async def discover_rss_feeds(base_url: str):
    """
    Discover RSS feeds from a news source.
    
    Args:
        base_url: The base URL of the news source
        
    Returns:
        List of discovered RSS feed URLs
    """
    try:
        from app.api.providers.factory import create_scraping_provider
        scraping_provider = create_scraping_provider(settings)
        
        rss_feeds = await scraping_provider.discover_rss_feeds(base_url)
        
        return {"base_url": base_url, "rss_feeds": rss_feeds}

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to discover RSS feeds: {str(e)}"
        )

@router.get("/browse_rss_feed")
async def browse_rss_feed(feed_url: str, limit: int = 20):
    """
    Browse RSS feed items without ingesting them.
    
    Args:
        feed_url: The RSS feed URL to browse
        limit: Maximum number of items to return (default 20)
        
    Returns:
        RSS feed metadata and recent items
    """
    try:
        import feedparser
        
        feed = feedparser.parse(feed_url)
        
        if not feed.feed:
            raise HTTPException(status_code=404, detail="RSS feed not found or invalid")
        
        # Extract feed metadata
        feed_info = {
            "feed_url": feed_url,
            "title": feed.feed.get('title', 'RSS Feed'),
            "description": feed.feed.get('description', ''),
            "language": feed.feed.get('language', ''),
            "updated": feed.feed.get('updated', ''),
            "generator": feed.feed.get('generator', ''),
            "total_entries": len(feed.entries)
        }
        
        # Extract recent items
        items = []
        for entry in feed.entries[:limit]:
            item = {
                "title": entry.get('title', 'RSS Item'),
                "link": entry.get('link', ''),
                "summary": entry.get('summary', ''),
                "published": entry.get('published', ''),
                "author": entry.get('author', ''),
                "id": entry.get('id', ''),
                "tags": [tag.get('term', '') for tag in entry.get('tags', [])]
            }
            items.append(item)
        
        return {
            "feed": feed_info,
            "items": items,
            "browsed_at": datetime.now(timezone.utc).isoformat()
        }

    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="feedparser library not installed. Install with: pip install feedparser"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to browse RSS feed: {str(e)}"
        )

@router.get("/providers/unified")
async def get_unified_providers():
    """
    Get all providers across all capabilities (LLM, embedding, search, geocoding) in a unified format.
    This provides metadata about requirements (API keys, local, etc.) and capabilities.
    """
    try:
        from app.api.providers.unified_registry import get_unified_registry
        
        registry = get_unified_registry()
        
        # Get providers grouped by capability
        grouped = registry.get_providers_grouped_by_capability()
        
        # Convert to JSON-serializable format
        result = {}
        capabilities_list = []
        
        for capability, providers in grouped.items():
            capabilities_list.append(capability)
            result[capability] = [
                {
                    "id": p.id,
                    "name": p.name,
                    "description": p.description,
                    "requires_api_key": p.requires_api_key,
                    "api_key_name": p.api_key_name,
                    "api_key_url": p.api_key_url,
                    "is_local": p.is_local,
                    "is_oss": p.is_oss,
                    "is_free": p.is_free,
                    "has_env_fallback": p.has_env_fallback,
                    "features": p.features or [],
                    "rate_limited": p.rate_limited,
                    "rate_limit_info": p.rate_limit_info,
                }
                for p in providers
            ]
        
        return {
            "providers": result,
            "capabilities": capabilities_list,
        }
    except Exception as e:
        logger.error(f"Failed to get unified providers: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load provider configuration: {str(e)}"
        )


@router.get("/providers", response_model=ProviderListResponse, status_code=status.HTTP_200_OK)
async def get_providers() -> ProviderListResponse:
    """
    Returns a dynamic list of available classification providers and their models.
    Discovers models from all configured providers (Ollama, OpenAI, Gemini).
    
    LEGACY: Use /providers/unified for a better structured response.
    """
    logger.info("Route: Discovering classification providers and models.")
    
    try:
        # Import the model registry from the factory
        from app.api.providers.factory import create_model_registry
        from app.core.config import settings
        
        # Create and initialize the model registry
        model_registry = create_model_registry(settings)
        await model_registry.initialize_providers()
        
        # Discover all models
        all_models = await model_registry.discover_all_models(force_refresh=True)
        
        # Convert to the expected response format
        providers_list: List[ProviderInfo] = []
        
        for provider_name, models in all_models.items():
            provider_models = [
                ProviderModel(
                    name=model.name,
                    description=model.description or f"{provider_name} {model.name}"
                )
                for model in models
            ]
            
            # Always add configured providers, even if they have no models
            # This allows users to pull models for providers like Ollama
            providers_list.append(ProviderInfo(
                provider_name=provider_name,
                models=provider_models
            ))
        
        logger.info(f"Discovered {len(providers_list)} providers with models")
        return ProviderListResponse(providers=providers_list)
        
    except Exception as e:
        logger.error(f"Failed to discover providers: {e}")
        # Fallback to hardcoded list if discovery fails
        hardcoded_providers: List[ProviderInfo] = [
            ProviderInfo(
                provider_name="gemini",
                models=[
                    ProviderModel(name="gemini-2.5-flash", description="Google's most capable model."),
                    ProviderModel(name="gemini-2.5-flash-lite-preview-06-17", description="A smaller, faster model."),
                ]
            ),
            ProviderInfo(
                provider_name="ollama",
                models=[
                    ProviderModel(name="llama3.2", description="Meta's Llama 3.2 model."),
                ]
            )
        ]
        
        return ProviderListResponse(providers=hardcoded_providers)


@router.post("/ollama/pull-model")
async def pull_ollama_model(
    model_name: str,
    current_user: CurrentUser = Depends(get_current_active_superuser)
) -> Message:
    """
    Pull a model from Ollama registry.
    Admin only endpoint for security.
    """
    logger.info(f"Pulling Ollama model: {model_name}")
    
    try:
        import httpx
        from app.core.config import settings
        
        ollama_base_url = getattr(settings, 'OLLAMA_BASE_URL', 'http://ollama:11434')
        
        async with httpx.AsyncClient(timeout=300.0) as client:  # 5 minute timeout for model pulling
            response = await client.post(
                f"{ollama_base_url}/api/pull",
                json={"name": model_name}
            )
            response.raise_for_status()
            
        logger.info(f"Successfully pulled Ollama model: {model_name}")
        return Message(message=f"Model {model_name} pulled successfully")
        
    except httpx.HTTPStatusError as e:
        logger.error(f"Ollama API error pulling model {model_name}: {e.response.status_code} - {e.response.text}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to pull model {model_name}: {e.response.text}"
        )
    except Exception as e:
        logger.error(f"Error pulling Ollama model {model_name}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to pull model {model_name}: {str(e)}"
        )


@router.get("/ollama/available-models")
async def get_ollama_available_models(
    sort: str = "newest",   # "newest" | "popular"
    limit: int = 50
) -> Dict[str, Any]:
    """
    Fetch models from the *plain* Ollama Library page and return normalized JSON.
    Only calls https://ollama.com/library (follows redirect from /library/).
    """
    import re
    from typing import Any, Dict, List

    try:
        import httpx
        from bs4 import BeautifulSoup
    except ImportError as e:
        logger.error("Missing dependency: %s", e)
        raise HTTPException(
            status_code=500,
            detail="Missing dependencies. Please install: httpx and beautifulsoup4."
        )

    # ------------ helpers ------------
    PULLS_RE   = re.compile(r"(?P<num>\d[\d,.]*)\s*(?P<suf>[MK])?\s*Pulls", re.I)
    PARAM_RE   = re.compile(r"\b(\d+(?:\.\d+)?(?:b|m)|\d+x\d+(?:\.\d+)?b)\b", re.I)
    UPDATED_RE = re.compile(r"\bUpdated\b\s+(?P<when>.+?)(?:$|\s{2,})", re.I)
    VALID_CAPS = {"tools", "vision", "thinking", "embedding", "cloud"}

    def pulls_to_int(s: str) -> int:
        if not s: return 0
        m = PULLS_RE.search(s)
        if not m: return 0
        n = float(m.group("num").replace(",", ""))
        suf = (m.group("suf") or "").upper()
        if suf == "M": n *= 1_000_000
        elif suf == "K": n *= 1_000
        return int(n)

    def short_desc(blob: str) -> str:
        # keep an initial sentence-like chunk; trim caps & params tokens
        s = re.split(r"\b(tools|vision|thinking|embedding|cloud)\b", blob, flags=re.I)[0]
        s = re.split(r"\b\d+(?:\.\d+)?(?:b|m)\b", s, flags=re.I)[0]
        return s.strip()

    # ------------ fetch ------------
    url = "https://ollama.com/library"  # plain endpoint
    headers = {
        # Safari UA to match your network capture (handles any conditional markup)
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0, headers=headers, follow_redirects=True) as client:
            r = await client.get(url)  # follows /library/ -> /library 303 automatically
            if r.status_code != 200:
                logger.warning("Failed to fetch %s: HTTP %s", url, r.status_code)
                return {"models": [], "error": f"Failed to fetch {url}", "status": r.status_code}
            html = r.text
    except Exception as e:
        logger.exception("Network error: %s", e)
        return {"models": [], "error": f"Network error: {e}"}

    # ------------ parse ------------
    soup = BeautifulSoup(html, "html.parser")
    rows: List[Dict[str, Any]] = []

    # Each tile is an <a href="/library/<slug>">…</a> containing the human strings
    for a in soup.find_all("a", href=True):
        href = (a.get("href") or "").strip()
        if not href.startswith("/library/"):
            continue
        slug = href.rsplit("/", 1)[-1]
        if not slug:
            continue

        text = a.get_text(" ", strip=True)
        if not text:
            continue

        pulls_text = PULLS_RE.search(text).group(0) if PULLS_RE.search(text) else "Unknown"
        pulls_num  = pulls_to_int(text)
        params     = [p.lower() for p in PARAM_RE.findall(text)]
        # dedupe while preserving order
        seen = set(); params = [p for p in params if (p not in seen and not seen.add(p))]
        updated    = UPDATED_RE.search(text).group("when") if UPDATED_RE.search(text) else None
        caps_found = [c for c in VALID_CAPS if re.search(rf"\b{re.escape(c)}\b", text, re.I)]
        desc       = short_desc(text) or slug

        if params:
            for p in params[:3]:
                rows.append({
                    "name": f"{slug}:{p}" if p not in slug else slug,
                    "base_model": slug,
                    "parameters": p,
                    "size": estimate_model_size(p),   # uses your existing helper
                    "capabilities": caps_found,
                    "pulls": pulls_text,
                    "pulls_num": pulls_num,
                    "description": f"{desc} ({p} parameters)" if desc else f"{slug} ({p})",
                    "updated": updated,
                    "link": f"https://ollama.com/library/{slug}",
                })
        else:
            rows.append({
                "name": slug,
                "base_model": slug,
                "parameters": "unknown",
                "size": "Unknown",
                "capabilities": caps_found,
                "pulls": pulls_text,
                "pulls_num": pulls_num,
                "description": desc or slug,
                "updated": updated,
                "link": f"https://ollama.com/library/{slug}",
            })

    # dedupe final variants by full name; keep highest pulls
    by_name: Dict[str, Dict[str, Any]] = {}
    for m in rows:
        n = m["name"]
        if n not in by_name or m["pulls_num"] > by_name[n]["pulls_num"]:
            by_name[n] = m
    models = list(by_name.values())

    # server-side sort safeguard (the page often defaults to Popular; we allow override)
    if sort.lower() == "popular":
        models.sort(key=lambda m: m.get("pulls_num", 0), reverse=True)
    else:
        # prefer entries with an "Updated …" stamp; tie-break by pulls
        def newest_key(m: Dict[str, Any]):
            has_updated = 1 if (m.get("updated") or "") else 0
            return (has_updated, m.get("pulls_num", 0))
        models.sort(key=newest_key, reverse=True)

    # limit & cleanup
    limit = max(1, min(limit, 200))
    models = models[:limit]
    for m in models:
        m.pop("pulls_num", None)

    return {"source_url": url, "sort": sort.lower(), "models": models}



def estimate_model_size(param_str: str) -> str:
    """Estimate model download size based on parameter count"""
    try:
        param_str = param_str.lower().replace('b', '').replace('m', '')
        
        if 'x' in param_str:  # MoE models like "8x7b"
            parts = param_str.split('x')
            if len(parts) == 2:
                experts = float(parts[0])
                size_per_expert = float(parts[1])
                # MoE models are more efficient, roughly 2x the single expert size
                total_params = size_per_expert * 2
            else:
                return "Unknown"
        else:
            total_params = float(param_str)
        
        # Rough estimation: 1B params ≈ 2GB download (considering quantization)
        if total_params >= 100:  # 100B+
            return f"~{int(total_params * 1.8)}GB"
        elif total_params >= 10:   # 10B-99B  
            return f"~{int(total_params * 2)}GB"
        elif total_params >= 1:    # 1B-9B
            return f"~{total_params * 2:.1f}GB"
        else:  # <1B (in millions)
            return f"~{int(total_params * 2000)}MB"
            
    except (ValueError, AttributeError):
        return "Unknown"


@router.delete("/ollama/remove-model")
async def remove_ollama_model(
    model_name: str,
    current_user: CurrentUser = Depends(get_current_active_superuser)
) -> Message:
    """
    Remove a model from Ollama.
    Admin only endpoint for security.
    """
    logger.info(f"Removing Ollama model: {model_name}")
    
    try:
        import httpx
        from app.core.config import settings
        
        ollama_base_url = getattr(settings, 'OLLAMA_BASE_URL', 'http://ollama:11434')
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.delete(
                f"{ollama_base_url}/api/delete",
                json={"name": model_name}
            )
            response.raise_for_status()
            
        logger.info(f"Successfully removed Ollama model: {model_name}")
        return Message(message=f"Model {model_name} removed successfully")
        
    except httpx.HTTPStatusError as e:
        logger.error(f"Ollama API error removing model {model_name}: {e.response.status_code} - {e.response.text}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to remove model {model_name}: {e.response.text}"
        )
    except Exception as e:
        logger.error(f"Error removing Ollama model {model_name}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to remove model {model_name}: {str(e)}"
        )

@router.get("/geocoding-providers")
async def get_geocoding_providers():
    """
    Get available geocoding providers and their configuration requirements.
    Helps frontend display provider options and understand what credentials are needed.
    Uses registry service to dynamically discover providers.
    """
    from app.api.providers.geocoding_registry import GeocodingProviderRegistryService
    
    registry = GeocodingProviderRegistryService()
    available_providers = registry.get_available_providers()
    
    # Build detailed provider information
    providers_info = []
    
    for provider_name in available_providers:
        config = registry.get_provider_info(provider_name)
        if not config:
            continue
        
        # Provider-specific metadata
        provider_meta = {
            "id": provider_name,
            "requires_api_key": config.requires_api_key,
            "enabled": config.enabled
        }
        
        # Add specific metadata per provider
        if provider_name == "local":
            provider_meta.update({
                "name": "Local Nominatim",
                "description": "Self-hosted Nominatim instance (compose/kubernetes)",
                "rate_limited": False,
                "supports_polygons": True,
            })
        elif provider_name == "nominatim_api":
            provider_meta.update({
                "name": "Nominatim Public API",
                "description": "OpenStreetMap's free public geocoding API",
                "rate_limited": True,
                "rate_limit": "1 request/second",
                "supports_polygons": True,
            })
        elif provider_name == "mapbox":
            provider_meta.update({
                "name": "Mapbox Geocoding",
                "description": "Mapbox commercial geocoding API",
                "api_key_name": "Mapbox Access Token",
                "rate_limited": True,
                "rate_limit": "600 requests/minute (free tier)",
                "supports_polygons": False,
                "docs_url": "https://docs.mapbox.com/api/search/geocoding/",
                "env_configured": bool(settings.MAPBOX_ACCESS_TOKEN)
            })
        
        providers_info.append(provider_meta)
    
    return {
        "providers": providers_info,
        "default_strategy": "local with fallback to nominatim_api"
    }


@router.get("/geocode_location")
async def geocode_location(
    location: str,
    language: Optional[str] = 'en'
):
    """
    Public geocoding endpoint - no authentication required.
    
    Uses local Nominatim container with automatic fallback to public Nominatim API.
    For proprietary providers (Mapbox, etc.) use /geocode_location_with_provider endpoint.
    
    Strategy:
    1. Try local Nominatim container first (fast, no rate limits)
    2. If local fails, fallback to public Nominatim API (rate limited but reliable)
    
    Args:
        location: Location name or address to geocode
        language: Language code for results (default: 'en')
    """
    from app.api.providers.geocoding_registry import GeocodingProviderRegistryService
    
    logger.info(f"Geocoding location (public): {location}")
    
    # Use registry service for automatic fallback
    registry = GeocodingProviderRegistryService()
    result = await registry.geocode_with_fallback(location, language=language)
    
    if result:
        return {
            "coordinates": result['coordinates'],
            "location_type": result['location_type'],
            "bbox": result.get('bbox'),
            "area": result.get('area'),
            "display_name": result.get('display_name'),
            "geometry": result.get('geometry'),
            "provider": result.get('provider')
        }
    
    # All providers failed
    logger.warning(f"Unable to geocode location: {location}")
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Unable to geocode location: {location}"
    )


@router.get("/geocode_location_with_provider")
async def geocode_location_with_provider(
    location: str,
    provider_type: str,
    api_key: Optional[str] = None,
    language: Optional[str] = 'en',
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Authenticated geocoding endpoint with custom provider selection.
    Requires authentication to use proprietary providers with user's API keys.
    
    Supported providers:
    - local: Local Nominatim container (no API key)
    - nominatim_api: Public Nominatim API (no API key, rate limited)
    - mapbox: Mapbox Geocoding API (requires api_key parameter)
    
    Args:
        location: Location name or address to geocode
        provider_type: Provider to use ('local', 'nominatim_api', 'mapbox')
        api_key: API key for proprietary providers (required for 'mapbox')
        language: Language code for results (default: 'en')
        current_user: Authenticated user (injected)
    """
    from app.api.providers.geocoding_registry import GeocodingProviderRegistryService
    
    logger.info(f"Geocoding location (authenticated): {location} with provider: {provider_type} for user: {current_user.email}")
    
    # Create provider using registry service
    registry = GeocodingProviderRegistryService()
    
    try:
        provider = registry.create_provider(provider_type, api_key=api_key)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    
    result = await provider.geocode(location, language=language)
    
    if result:
        logger.info(f"Geocoded '{location}' using {provider_type}")
        return {
            "coordinates": result['coordinates'],
            "location_type": result['location_type'],
            "bbox": result.get('bbox'),
            "area": result.get('area'),
            "display_name": result.get('display_name'),
            "geometry": result.get('geometry'),
            "provider": provider_type
        }
    else:
        logger.warning(f"Unable to geocode location: {location}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unable to geocode location: {location}"
        )

@router.get("/get_country_data")
def get_country_data(country):
    url = f"https://en.wikipedia.org/w/api.php"
    params = {
        "action": "query",
        "format": "json",
        "titles": country,
        "prop": "extracts",
        "exintro": True,
        "explaintext": True
    }
    response = requests.get(url, params=params)
    data = response.json()
    pages = data['query']['pages']
    for page_id, page_data in pages.items():
        if 'extract' in page_data:
            return page_data['extract']
    return None    