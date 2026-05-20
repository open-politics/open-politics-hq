from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status
from pydantic.networks import EmailStr
import fitz
from io import BytesIO
from typing import Dict, Any, Optional, List
import requests
from datetime import datetime, timezone

from app.api.dependency_injection import get_current_active_superuser, get_current_user, SessionDep, CurrentUser
from app.api.modules.identity_infospace_user.access import Access, Requires
from app.schemas import Message, ProviderInfo, ProviderModel, ProviderListResponse
from app.api.modules.identity_infospace_user.services import generate_test_email, send_email
from app.core.config import settings
import logging

# Type alias for current user
CurrentUser = get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/utils", tags=["Utilities"], dependencies=[Depends(get_current_user)])


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
async def discover_curated_rss_feeds(
    *,
    session: SessionDep,
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
        from app.api.modules.content.handlers import RSSHandler

        feeds = await RSSHandler.discover_rss_feeds_from_awesome_repo(
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
        from app.api.modules.foundation_service_providers import resolve
        scraping_provider = resolve("scraping")
        
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
        from app.api.modules.foundation_service_providers import resolve
        scraping_provider = resolve("scraping")
        
        analysis_result = await scraping_provider.analyze_source(base_url)
        
        return analysis_result

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to analyze source: {str(e)}"
        )

@router.get("/discover_rss_feeds")
async def discover_rss_feeds_from_site(base_url: str):
    """
    Discover RSS feeds from a news source.

    Args:
        base_url: The base URL of the news source

    Returns:
        List of discovered RSS feed URLs
    """
    try:
        from app.api.modules.foundation_service_providers import resolve
        scraping_provider = resolve("scraping")
        
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
        from app.api.modules.foundation_service_providers import list_providers

        # Capability names returned in response — mapped to registry capability strings.
        _CAPABILITY_MAP = {
            "llm":         "language",
            "embedding":   "embedding",
            "web_search":  "web_search",
            "geocoding":   "geocoding",
            "ocr":         "ocr",
        }

        # Human-readable display metadata per provider type_key
        _PROVIDER_DISPLAY = {
            "ollama": {
                "name": "Ollama",
                "description": "Run open-source models locally via Ollama. Supports language, embedding, and OCR capabilities.",
            },
            "openai": {
                "name": "OpenAI",
                "description": "GPT models and text embeddings from OpenAI.",
                "api_key_name": "OpenAI API Key",
                "api_key_url": "https://platform.openai.com/api-keys",
            },
            "anthropic": {
                "name": "Anthropic",
                "description": "Claude language models from Anthropic.",
                "api_key_name": "Anthropic API Key",
                "api_key_url": "https://console.anthropic.com/settings/keys",
            },
            "gemini": {
                "name": "Google Gemini",
                "description": "Gemini language models from Google.",
                "api_key_name": "Google API Key",
                "api_key_url": "https://aistudio.google.com/apikey",
            },
            "mistral": {
                "name": "Mistral AI",
                "description": "Mistral and Codestral language models.",
                "api_key_name": "Mistral API Key",
                "api_key_url": "https://console.mistral.ai/api-keys/",
            },
            "jina": {
                "name": "Jina AI",
                "description": "High-quality multilingual text embeddings.",
                "api_key_name": "Jina API Key",
                "api_key_url": "https://jina.ai/embeddings/#apiform",
            },
            "voyage": {
                "name": "Voyage AI",
                "description": "Specialized embeddings for code, law, and finance (Anthropic partner).",
                "api_key_name": "Voyage API Key",
                "api_key_url": "https://dash.voyageai.com/",
            },
            "tesseract": {
                "name": "Tesseract OCR",
                "description": "Open-source OCR engine running locally via ocrmypdf.",
            },
            "local": {
                "name": "Local Nominatim",
                "description": "Self-hosted Nominatim geocoding instance.",
            },
            "nominatim_api": {
                "name": "Nominatim Public API",
                "description": "OpenStreetMap's free public geocoding API (rate-limited).",
            },
            "mapbox": {
                "name": "Mapbox Geocoding",
                "description": "Commercial geocoding API from Mapbox.",
                "api_key_name": "Mapbox Access Token",
                "api_key_url": "https://account.mapbox.com/access-tokens/",
            },
            "tavily": {
                "name": "Tavily",
                "description": "AI-optimised web search API.",
                "api_key_name": "Tavily API Key",
                "api_key_url": "https://tavily.com/#api",
            },
            "minio": {
                "name": "MinIO",
                "description": "S3-compatible object storage (self-hosted).",
            },
            "local_fs": {
                "name": "Local Filesystem",
                "description": "Store files directly on the local filesystem.",
            },
            "newspaper4k": {
                "name": "Newspaper4k",
                "description": "Local article scraping and extraction library.",
            },
        }

        result = {}
        capabilities_list = []

        for response_name, capability_key in _CAPABILITY_MAP.items():
            descriptors = list_providers(capability_key)
            capabilities_list.append(response_name)
            result[response_name] = []
            for type_key, desc in descriptors:
                display = _PROVIDER_DISPLAY.get(type_key, {})
                has_env = False
                if desc.api_key_setting:
                    has_env = bool(getattr(settings, desc.api_key_setting, None))
                # Statically-declared models for this (capability, provider). Empty
                # for providers whose model list is runtime-discovered (Ollama).
                models_payload = [
                    {
                        "name": spec.name,
                        "description": getattr(spec, "description", "") or "",
                        "dimension": getattr(spec, "dimension", None),
                        "max_sequence_length": getattr(spec, "max_sequence_length", None),
                    }
                    for spec in desc.models
                ]
                result[response_name].append({
                    "id": type_key,
                    "name": display.get("name", type_key),
                    "description": display.get("description", ""),
                    "requires_api_key": desc.requires_api_key,
                    "api_key_name": display.get("api_key_name"),
                    "api_key_url": display.get("api_key_url"),
                    "is_local": desc.is_local,
                    "is_oss": desc.is_local,
                    "is_free": not desc.requires_api_key,
                    "has_env_fallback": has_env,
                    "features": sorted(desc.contexts),
                    "rate_limited": None,
                    "rate_limit_info": None,
                    "model_required": desc.model_required,
                    "models": models_payload,
                })

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
    Returns statically-declared LLM providers and their models.

    This is a deployment-level catalog — no credentials, no infospace context.
    For runtime discovery of locally-installed models (Ollama), use
    ``/providers/{infospace_id}/models?capability=language&provider_key=ollama``.
    """
    logger.info("Route: Listing static LLM provider catalog.")

    try:
        from app.api.modules.foundation_service_providers import list_providers

        descriptors = list_providers("language")
        providers_list: List[ProviderInfo] = []

        for provider_key, desc in descriptors:
            models: List[ProviderModel] = [
                ProviderModel(name=spec.name, description=spec.description or spec.name)
                for spec in desc.models
            ]
            if models:
                providers_list.append(ProviderInfo(provider_name=provider_key, models=models))

        total = sum(len(p.models) for p in providers_list)
        logger.info(f"Listed {total} LLM models across {len(providers_list)} providers")
        return ProviderListResponse(providers=providers_list)

    except Exception as e:
        logger.error(f"Failed to list providers: {e}")
        return ProviderListResponse(providers=[])


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
        
        # Use host.docker.internal for Docker containers to reach host machine's Ollama
        ollama_base_url = getattr(settings, 'OLLAMA_BASE_URL', 'http://host.docker.internal:11434')
        
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
        
        # Use host.docker.internal for Docker containers to reach host machine's Ollama
        ollama_base_url = getattr(settings, 'OLLAMA_BASE_URL', 'http://host.docker.internal:11434')
        
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
    Uses descriptor registry to dynamically discover providers.
    """
    from app.api.modules.foundation_service_providers import list_providers

    descriptors = list_providers("geocoding")

    # Static metadata keyed by type_key, preserving the same response shape
    _GEOCODING_META = {
        "local": {
            "name": "Local Nominatim",
            "description": "Self-hosted Nominatim instance (compose/kubernetes)",
            "rate_limited": False,
            "supports_polygons": True,
        },
        "nominatim_api": {
            "name": "Nominatim Public API",
            "description": "OpenStreetMap's free public geocoding API",
            "rate_limited": True,
            "rate_limit": "1 request/second",
            "supports_polygons": True,
        },
        "mapbox": {
            "name": "Mapbox Geocoding",
            "description": "Mapbox commercial geocoding API",
            "api_key_name": "Mapbox Access Token",
            "rate_limited": True,
            "rate_limit": "600 requests/minute (free tier)",
            "supports_polygons": False,
            "docs_url": "https://docs.mapbox.com/api/search/geocoding/",
            "env_configured": bool(settings.MAPBOX_ACCESS_TOKEN),
        },
    }

    providers_info = []
    for type_key, desc in descriptors:
        provider_meta = {
            "id": type_key,
            "requires_api_key": desc.requires_api_key,
            "enabled": True,
        }
        extra = _GEOCODING_META.get(type_key, {})
        provider_meta.update(extra)
        providers_info.append(provider_meta)

    return {
        "providers": providers_info,
        "default_strategy": "local with fallback to nominatim_api"
    }


@router.get("/{infospace_id}/geocode_location")
async def geocode_location(
    location: str,
    language: Optional[str] = 'en',
    access: Access = Requires(scope=None),
    session: SessionDep = None,
):
    """
    Geocode a location within an infospace. Uses the infospace's configured
    geocoding provider (defaults to local Nominatim → public Nominatim fallback
    when the owner hasn't configured anything explicitly).

    Authenticated — any user with view access to the infospace can call this.
    """
    from app.api.modules.foundation_service_providers import resolve, ProviderError

    # Try owner-configured + local + public fallback in order.
    for provider_key in (None, "local", "nominatim_api"):
        try:
            p = resolve(
                "geocoding", provider_key,
                infospace_id=access.infospace_id,
                session=session,
            )
            result = await p.geocode(location, language=language)
            if result:
                return {
                    "coordinates": result['coordinates'],
                    "location_type": result['location_type'],
                    "bbox": result.get('bbox'),
                    "area": result.get('area'),
                    "display_name": result.get('display_name'),
                    "geometry": result.get('geometry'),
                    "provider": p.provider_key,
                }
        except ProviderError as e:
            logger.debug("Geocoding provider %s not available: %s", provider_key, e)
        except Exception as e:
            logger.warning(f"Geocoding provider {provider_key!r} failed for {location!r}: {e}")

    logger.warning(f"Unable to geocode location: {location}")
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Unable to geocode location: {location}",
    )


@router.get("/{infospace_id}/geocode_location_with_provider")
async def geocode_location_with_provider(
    location: str,
    provider_type: str,
    api_key: Optional[str] = None,
    language: Optional[str] = 'en',
    access: Access = Requires(scope=None),
    session: SessionDep = None,
):
    """
    Geocode a location with an explicit provider choice (BYOK supported).

    ``api_key`` is a runtime BYOK key — used for this call only. The infospace
    owner's stored keys and deployment grants still work without it.
    """
    from app.api.modules.foundation_service_providers import resolve, ProviderError

    try:
        p = resolve(
            "geocoding", provider_type,
            infospace_id=access.infospace_id,
            runtime_key=api_key,
            session=session,
        )
    except ProviderError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    result = await p.geocode(location, language=language)

    if result:
        return {
            "coordinates": result['coordinates'],
            "location_type": result['location_type'],
            "bbox": result.get('bbox'),
            "area": result.get('area'),
            "display_name": result.get('display_name'),
            "geometry": result.get('geometry'),
            "provider": p.provider_key,
        }
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Unable to geocode location: {location}",
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