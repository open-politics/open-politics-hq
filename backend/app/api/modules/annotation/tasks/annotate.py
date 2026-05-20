"""Tasks for handling annotations."""
import json
import logging
from typing import List, Dict, Any, Type, Optional, TYPE_CHECKING, Tuple
from datetime import datetime, timezone
from sqlmodel import Session, select
from sqlalchemy import func, or_, text
import asyncio 
import traceback
from app.models import (
    Annotation,
    AnnotationSchema,
    Asset,
    AssetKind,
    Bundle,
    Modality,
    RunStatus,
    AnnotationRun,
    ResultStatus,
    AnnotationSchemaTargetLevel
)
from app.schemas import AnnotationCreate
from app.core.db import engine
from app.api.modules.foundation_service_providers.registry import resolve
from app.core.task_utils import (
    create_pydantic_model_from_json_schema,
    make_python_identifier,
    run_async_in_celery,
    split_schema_for_extraction,
)
from app.core.tasks import TaskContext, task
from app.core.config import settings
from app.api.modules.content.types import get_content_type_registry

if TYPE_CHECKING:
    from app.api.dependency_injection import StorageProviderDep # Import StorageProviderDep under TYPE_CHECKING

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Configuration for parallel processing
# These will be overridden by settings values
DEFAULT_ANNOTATION_CONCURRENCY = 5  # Number of concurrent classification API calls
MAX_ANNOTATION_CONCURRENCY = 20     # Maximum allowed concurrency

def get_annotation_processing_config():
    """Get annotation processing configuration from settings."""
    try:
        return {
            'default_concurrency': settings.DEFAULT_ANNOTATION_CONCURRENCY,
            'max_concurrency': settings.MAX_ANNOTATION_CONCURRENCY,
        }
    except AttributeError:
        # Fallback to default values if settings not available
        logger.warning("Annotation processing settings not found, using defaults")
        return {
            'default_concurrency': DEFAULT_ANNOTATION_CONCURRENCY,
            'max_concurrency': MAX_ANNOTATION_CONCURRENCY,
        }

async def get_cached_provider(provider_type: str, settings_instance):
    """Get a cached provider instance. Only 'storage' is supported here."""
    from app.core.tasks import cached_resolve
    if provider_type == "storage":
        return cached_resolve("storage")
    raise ValueError(f"Unknown provider type: {provider_type}")

def _get_image_asset_kinds(process_pdfs_as_images: bool = True) -> frozenset:
    """Asset kinds that support image modality for the current run config.

    ``process_pdfs_as_images`` flips PDFs on/off as an image class. When it's
    off (whole-document-text mode) we remove BOTH the parent ``PDF`` and the
    rendered ``PDF_PAGE`` kinds — otherwise a PDF parent falls into the
    parent-is-image branch in ``assemble_multimodal_context``, which fetches
    raw PDF bytes and sends them as media (without the extracted text).
    """
    registry = get_content_type_registry()
    all_image = registry.kinds_supporting_modality(Modality.IMAGE)
    if process_pdfs_as_images:
        return all_image
    return all_image - {AssetKind.PDF_PAGE, AssetKind.PDF}


def validate_hierarchical_schema(output_contract: dict) -> bool:
    """Validate that hierarchical schema follows conventions"""
    valid_top_level = {"document", "per_image", "per_audio", "per_video", "per_page"}
    
    # Check if it looks like a hierarchical schema first
    is_hierarchical = any(key.startswith("per_") or key == "document" for key in output_contract.keys())
    has_only_valid_keys = all(key in valid_top_level for key in output_contract.keys() if key.startswith("per_") or key == "document")

    if not is_hierarchical:
        return True # Not hierarchical, so it's valid in this context (treated as flat/document-only)

    # If it is hierarchical, all top-level keys must be from the valid set
    all_keys = set(output_contract.keys())
    standard_keys_present = {key for key in all_keys if key == "document" or key.startswith("per_")}
    non_standard_keys = all_keys - standard_keys_present

    if non_standard_keys:
        logger.warning(f"Schema has mixed hierarchical and potentially flat structure with non-standard keys: {non_standard_keys}. This might be confusing.")
        return False # Contains non-standard top-level keys alongside hierarchical ones
        
    return True

def simplify_schema_for_model(schema: dict, model_name: str, provider_key: str | None = None) -> dict:
    """
    Simplify schemas for local/self-hosted models by truncating long descriptions.

    Args:
        schema: Original JSON schema (in standard JSON schema format with "type" and "properties")
        model_name: Name of the model being used
        provider_key: Provider type key (e.g. "ollama", "mistral", "openai")

    Returns:
        Potentially simplified schema (always in standard JSON schema format, all fields preserved)
    """
    # Only simplify for local/self-hosted providers (Ollama etc.), not cloud APIs
    if provider_key not in ("ollama",):
        return schema
    
    # For smaller models, truncate long descriptions to reduce token usage
    # but preserve all fields - no hardcoded field names
    def truncate_descriptions_in_schema(schema_part: dict, max_desc_length: int = 200) -> dict:
        """Recursively truncate descriptions in a schema while preserving structure."""
        if not isinstance(schema_part, dict):
            return schema_part
        
        result = schema_part.copy()
        
        # Truncate description if present
        if "description" in result and isinstance(result["description"], str):
            if len(result["description"]) > max_desc_length:
                result["description"] = result["description"][:max_desc_length] + "..."
        
        # Recursively process properties
        if "properties" in result and isinstance(result["properties"], dict):
            result["properties"] = {
                key: truncate_descriptions_in_schema(value, max_desc_length)
                for key, value in result["properties"].items()
            }
        
        # Recursively process items (for arrays)
        if "items" in result:
            result["items"] = truncate_descriptions_in_schema(result["items"], max_desc_length)
        
        return result
    
    # Apply description truncation to the entire schema
    simplified = truncate_descriptions_in_schema(schema, max_desc_length=200)
    
    if simplified != schema:
        logger.info(f"Truncated long descriptions in schema for Ollama model {model_name} (all fields preserved)")
    
    return simplified

def detect_schema_structure(output_contract: dict) -> dict:
    """Detect which sections apply to which asset types"""
    structure = {
        "document_fields": {},
        "per_modality_fields": {}
    }
    
    # Unwrap if schema is wrapped in type/properties
    schema_to_check = output_contract
    if output_contract.get("type") == "object" and "properties" in output_contract:
        schema_to_check = output_contract["properties"]
    
    for key, value in schema_to_check.items():
        if key == "document":
            structure["document_fields"] = value
        elif key.startswith("per_"):
            modality = key[4:]  # Extract modality name
            # The `value` here is the schema for the array, so we need `value["items"]` for the item schema
            if isinstance(value, dict) and value.get("type") == "array" and "items" in value:
                structure["per_modality_fields"][modality] = value["items"]
            else:
                logger.warning(f"Per-modality field '{key}' in output_contract is not a valid array schema with items. Skipping for structure detection.")
    
    # If no hierarchical structure, assume all fields are document-level
    if not structure["document_fields"] and not structure["per_modality_fields"]:
        # If no "document" or "per_*" keys, assume the whole output_contract is for the document.
        # And it must be an object schema with properties to be useful here.
        if output_contract.get("type") == "object" and "properties" in output_contract:
            structure["document_fields"] = output_contract
        else: # It's a flat schema but not an object (e.g. just a string type), or empty.
              # In this case, no properties to iterate for justification prompts.
            logger.debug(f"Output contract is flat but not an object with properties. No document fields extracted for justification prompt generation. Contract: {output_contract}")
            
    return structure

def simplify_schema_for_standalone_image(output_contract: dict) -> dict:
    """
    Simplify schema for standalone image assets (PDF_PAGE, IMAGE, IMAGE_REGION).
    Removes per_modality_fields to eliminate ambiguity - standalone images should only use document field.
    
    Args:
        output_contract: The original schema output contract (from Pydantic model_json_schema())
        
    Returns:
        Simplified schema with only document field (if it exists), with $ref references resolved
    """
    # Create a copy to avoid mutating the original
    simplified = json.loads(json.dumps(output_contract))
    
    # Get definitions for resolving $ref references
    definitions = simplified.get("$defs", simplified.get("definitions", {}))
    
    # Helper function to resolve $ref references recursively
    def resolve_ref(schema_part: dict) -> dict:
        """Resolve $ref references in a schema part."""
        if not isinstance(schema_part, dict):
            return schema_part
        
        # If this is a $ref, resolve it
        if "$ref" in schema_part:
            ref_path = schema_part["$ref"]
            # Extract the reference name (e.g., "#/$defs/DocumentSchema" -> "DocumentSchema")
            if ref_path.startswith("#/$defs/"):
                ref_name = ref_path.replace("#/$defs/", "")
            elif ref_path.startswith("#/definitions/"):
                ref_name = ref_path.replace("#/definitions/", "")
            else:
                # Unknown ref format, return as-is
                logger.warning(f"Unknown $ref format: {ref_path}")
                return schema_part
            
            if ref_name in definitions:
                # Resolve the reference and recursively resolve any nested $refs
                resolved = json.loads(json.dumps(definitions[ref_name]))
                return resolve_ref(resolved)
            else:
                logger.warning(f"Reference '{ref_name}' not found in definitions")
                return schema_part
        
        # Recursively resolve $ref in nested objects
        resolved = {}
        for key, value in schema_part.items():
            if isinstance(value, dict):
                resolved[key] = resolve_ref(value)
            elif isinstance(value, list):
                resolved[key] = [resolve_ref(item) if isinstance(item, dict) else item for item in value]
            else:
                resolved[key] = value
        
        return resolved
    
    # Unwrap if schema is wrapped in type/properties
    schema_to_check = simplified
    if simplified.get("type") == "object" and "properties" in simplified:
        schema_to_check = simplified["properties"]
    
    # Remove all per_* fields
    keys_to_remove = [key for key in schema_to_check.keys() if key.startswith("per_")]
    for key in keys_to_remove:
        del schema_to_check[key]
        logger.info(f"Removed '{key}' field from schema for standalone image processing")
    
    # Update required fields if present
    if "required" in schema_to_check:
        schema_to_check["required"] = [field for field in schema_to_check["required"] if not field.startswith("per_")]
    
    # Helper function to flatten anyOf/oneOf/allOf and extract a concrete schema
    def flatten_combinators(schema_part: dict) -> dict:
        """Flatten anyOf/oneOf/allOf combinators to extract a concrete schema."""
        if not isinstance(schema_part, dict):
            return schema_part
        
        # Handle anyOf - take the first option that has a type or can be inferred
        if "anyOf" in schema_part:
            any_of_options = schema_part["anyOf"]
            for option in any_of_options:
                if isinstance(option, dict):
                    # Prefer options with explicit type
                    if "type" in option:
                        logger.debug(f"Selected anyOf option with explicit type: {option.get('type')}")
                        return flatten_combinators(option)
                    # Or options with properties (objects)
                    elif "properties" in option:
                        flattened = flatten_combinators(option)
                        if "type" not in flattened:
                            flattened["type"] = "object"
                        logger.debug(f"Selected anyOf option with properties, inferred type='object'")
                        return flattened
            
            # If no good option found, take the first one and try to infer
            if any_of_options:
                first_option = any_of_options[0]
                flattened = flatten_combinators(first_option)
                if "type" not in flattened:
                    if "properties" in flattened:
                        flattened["type"] = "object"
                    elif "items" in flattened:
                        flattened["type"] = "array"
                logger.debug(f"Selected first anyOf option, inferred type if needed")
                return flattened
        
        # Handle oneOf - similar to anyOf
        if "oneOf" in schema_part:
            one_of_options = schema_part["oneOf"]
            for option in one_of_options:
                if isinstance(option, dict) and "type" in option:
                    logger.debug(f"Selected oneOf option with explicit type: {option.get('type')}")
                    return flatten_combinators(option)
            if one_of_options:
                first_option = one_of_options[0]
                flattened = flatten_combinators(first_option)
                if "type" not in flattened:
                    if "properties" in flattened:
                        flattened["type"] = "object"
                    elif "items" in flattened:
                        flattened["type"] = "array"
                logger.debug(f"Selected first oneOf option, inferred type if needed")
                return flattened
        
        # Handle allOf - merge all schemas
        if "allOf" in schema_part:
            all_of_options = schema_part["allOf"]
            merged = {}
            for option in all_of_options:
                if isinstance(option, dict):
                    flattened_option = flatten_combinators(option)
                    merged.update(flattened_option)
            logger.debug(f"Merged allOf options")
            return merged
        
        # Recursively process nested combinators
        result = {}
        for key, value in schema_part.items():
            if isinstance(value, dict):
                result[key] = flatten_combinators(value)
            elif isinstance(value, list):
                result[key] = [flatten_combinators(item) if isinstance(item, dict) else item for item in value]
            else:
                result[key] = value
        
        return result
    
    # CRITICAL: Resolve $ref references and flatten combinators for all remaining properties
    # OpenAI API doesn't support $ref, anyOf, oneOf, allOf - we need inline types
    for prop_name, prop_schema in schema_to_check.items():
        if isinstance(prop_schema, dict):
            # First resolve $ref references
            resolved_schema = resolve_ref(prop_schema)
            # Then flatten anyOf/oneOf/allOf combinators
            resolved_schema = flatten_combinators(resolved_schema)
            
            # If resolved schema still doesn't have a type key, infer it from structure
            if "type" not in resolved_schema:
                if "properties" in resolved_schema:
                    # Has properties -> it's an object
                    resolved_schema["type"] = "object"
                    logger.debug(f"Inferred type='object' for property '{prop_name}' based on 'properties' key")
                elif "items" in resolved_schema:
                    # Has items -> it's an array
                    resolved_schema["type"] = "array"
                    logger.debug(f"Inferred type='array' for property '{prop_name}' based on 'items' key")
                elif "enum" in resolved_schema:
                    # Has enum -> it's likely a string
                    resolved_schema["type"] = "string"
                    logger.debug(f"Inferred type='string' for property '{prop_name}' based on 'enum' key")
                else:
                    # Can't infer - log error
                    logger.error(f"Property '{prop_name}' is missing 'type' key after $ref resolution and cannot be inferred. Keys: {list(resolved_schema.keys())}")
            
            schema_to_check[prop_name] = resolved_schema
            
            # Validate that document field has type key (required by OpenAI)
            if prop_name == "document":
                if "type" not in resolved_schema:
                    logger.error(f"Property 'document' is missing 'type' key after $ref resolution and inference - this will cause OpenAI API errors")
                    logger.debug(f"Resolved document schema keys: {list(resolved_schema.keys())}")
                else:
                    logger.debug(f"Successfully resolved document schema with type: {resolved_schema.get('type')}")
    
    return simplified

async def fetch_asset_content(asset: Asset, storage_provider: 'StorageProviderDep') -> bytes:
    """Fetch asset content from storage or web URL using the injected storage_provider."""
    # Priority 1: Try blob_path (downloaded content in storage)
    if asset.blob_path:
        logger.info(f"Fetching content for asset {asset.id} from blob_path: {asset.blob_path}")
        try:
            file_stream = await storage_provider.get_file(asset.blob_path)
            # The stream needs to be read. Minio's get_object returns a urllib3.response.HTTPResponse
            # whose `read()` method is synchronous. We need to handle this carefully in an async context.
            # For now, assuming `read()` can be awaited or is non-blocking, or using `asyncio.to_thread` if it's blocking.
            # Let's assume the provider's get_file or the returned stream object handles async reading appropriately
            # or we adapt it. For Minio, response.read() is blocking.
            # A common pattern is to use `asyncio.to_thread` for blocking I/O in async code.
            
            # Simplification: if storage_provider.get_file already returns bytes or an awaitable stream that yields bytes:
            # content = await file_stream.read() # if file_stream has an async read method
            # For Minio, this needs care. Let's assume for now the provider has an async-compatible way to get bytes.
            # If direct async read is not available from the stream object itself, we need a helper.

            # Correct handling for Minio which returns a urllib3.response.HTTPResponse:
            try:
                content = await asyncio.to_thread(file_stream.read) 
            finally:
                # Ensure stream is always closed, even if read fails
                try:
                    file_stream.close()
                except Exception as close_error:
                    logger.warning(f"Error closing file stream for asset {asset.id}: {close_error}")
            logger.info(f"Successfully fetched {len(content)} bytes for asset {asset.id}")
            return content
        except FileNotFoundError:
            logger.error(f"File not found in storage for asset {asset.id} at blob_path: {asset.blob_path}")
            return b""
        except Exception as e:
            logger.error(f"Failed to fetch content for asset {asset.id} from {asset.blob_path}: {e}", exc_info=True)
            return b""
    
    # Priority 2: For PDF_PAGE assets without blob_path, extract page image from parent PDF
    if asset.kind == AssetKind.PDF_PAGE and not asset.blob_path:
        parent_asset_id = getattr(asset, 'parent_asset_id', None)
        page_index = asset.part_index if asset.part_index is not None else 0
        
        # Get parent_asset_id and part_index from database if not loaded
        from app.core.db import engine
        with Session(engine) as session:
            # Refresh asset to get parent_asset_id if missing
            if not parent_asset_id:
                refreshed_asset = session.get(Asset, asset.id)
                if refreshed_asset:
                    parent_asset_id = refreshed_asset.parent_asset_id
                    if refreshed_asset.part_index is not None:
                        page_index = refreshed_asset.part_index
            
            if not parent_asset_id:
                logger.debug(f"PDF_PAGE asset {asset.id} has no parent_asset_id, cannot extract page image")
                return b""
            
            logger.info(f"PDF_PAGE asset {asset.id} has no blob_path. Attempting to extract page {page_index} from parent PDF {parent_asset_id}")
            # Get parent PDF asset
            parent_asset = session.get(Asset, parent_asset_id)
            if not parent_asset or parent_asset.kind != AssetKind.PDF or not parent_asset.blob_path:
                logger.warning(
                    f"Parent PDF asset {parent_asset_id} not found or invalid for PDF_PAGE {asset.id}. "
                    f"Parent exists: {parent_asset is not None}, "
                    f"Kind: {parent_asset.kind if parent_asset else 'None'}, "
                    f"Blob: {bool(parent_asset.blob_path) if parent_asset else False}"
                )
                return b""
            
            # Fetch parent PDF content (outside session to avoid holding DB connection)
            pdf_blob_path = parent_asset.blob_path
        
        # Extract page image using PyMuPDF (outside session)
        try:
            pdf_file_stream = await storage_provider.get_file(pdf_blob_path)
            pdf_bytes = await asyncio.to_thread(pdf_file_stream.read)
            pdf_file_stream.close()
            
            import fitz
            
            def extract_page_image(pdf_bytes: bytes, page_num: int) -> bytes:
                """Extract a single page as PNG image."""
                doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                try:
                    if page_num >= doc.page_count:
                        logger.warning(f"Page {page_num} out of range for PDF with {doc.page_count} pages")
                        return b""
                    page = doc.load_page(page_num)
                    # Render page as PNG image (matrix controls DPI - 2.0 = 144 DPI)
                    pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
                    return pix.tobytes("png")
                finally:
                    doc.close()
            
            page_image_bytes = await asyncio.to_thread(extract_page_image, pdf_bytes, page_index)
            
            if page_image_bytes:
                logger.info(f"Successfully extracted page {page_index} image ({len(page_image_bytes)} bytes) from parent PDF {parent_asset_id} for PDF_PAGE {asset.id}")
                return page_image_bytes
            else:
                logger.warning(f"Failed to extract page {page_index} image from parent PDF {parent_asset_id}")
                return b""
                
        except Exception as e:
            logger.error(f"Failed to extract PDF page image for asset {asset.id}: {e}", exc_info=True)
            return b""
    
    # Priority 3: Try source_identifier (web URL) for image assets without blob_path
    # This handles RSS images and other web-referenced images
    if asset.source_identifier:
        image_asset_kinds = _get_image_asset_kinds(process_pdfs_as_images=True)
        if asset.kind in image_asset_kinds and asset.source_identifier.startswith(('http://', 'https://')):
            logger.info(f"Asset {asset.id} has no blob_path but has web URL. Attempting to fetch from: {asset.source_identifier}")
            try:
                import httpx
                # Set reasonable timeout and size limits
                timeout = httpx.Timeout(30.0, connect=10.0)
                max_size = 10 * 1024 * 1024  # 10MB limit for images
                
                async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, max_redirects=5) as client:
                    response = await client.get(asset.source_identifier)
                    response.raise_for_status()
                    
                    # Validate content type
                    content_type = response.headers.get('content-type', '').lower()
                    if not content_type.startswith('image/'):
                        logger.warning(
                            f"URL {asset.source_identifier} did not return image content. "
                            f"Content-Type: {content_type}. Skipping."
                        )
                        return b""
                    
                    # Check size
                    content_length = response.headers.get('content-length')
                    if content_length and int(content_length) > max_size:
                        logger.warning(
                            f"Image at {asset.source_identifier} exceeds size limit "
                            f"({content_length} bytes > {max_size} bytes). Skipping."
                        )
                        return b""
                    
                    content = response.content
                    if len(content) > max_size:
                        logger.warning(
                            f"Downloaded image from {asset.source_identifier} exceeds size limit "
                            f"({len(content)} bytes > {max_size} bytes). Skipping."
                        )
                        return b""
                    
                    logger.info(f"Successfully fetched {len(content)} bytes from web URL for asset {asset.id}")
                    return content
                    
            except httpx.TimeoutException:
                logger.warning(f"Timeout fetching image from {asset.source_identifier} for asset {asset.id}")
                return b""
            except httpx.HTTPStatusError as e:
                logger.warning(f"HTTP error {e.response.status_code} fetching image from {asset.source_identifier} for asset {asset.id}")
                return b""
            except Exception as e:
                logger.error(f"Failed to fetch image from URL {asset.source_identifier} for asset {asset.id}: {e}", exc_info=True)
                return b""
    
    # No blob_path and no valid source_identifier
    logger.warning(f"Asset {asset.id} has no blob_path and no valid source_identifier. Cannot fetch content.")
    return b""

def detect_image_mime_type(image_bytes: bytes, fallback: str = "image/png") -> str:
    """
    Detect image MIME type from image bytes using magic bytes.

    Returns a concrete MIME type only when the bytes actually match a known
    image format. For non-image containers we detect (PDF, Office docs) we
    return their real MIME so callers can reject them instead of silently
    mislabeling them as PNG. Only if the bytes are entirely unrecognized do
    we fall back — and even then, the caller should be suspicious.
    """
    if not image_bytes:
        return fallback

    # Known image formats — safe to send to image-only consumers.
    if image_bytes.startswith(b'\xff\xd8\xff'):
        return "image/jpeg"
    if image_bytes.startswith(b'\x89PNG\r\n\x1a\n'):
        return "image/png"
    if image_bytes.startswith(b'GIF87a') or image_bytes.startswith(b'GIF89a'):
        return "image/gif"
    if image_bytes.startswith(b'RIFF') and b'WEBP' in image_bytes[8:12]:
        return "image/webp"
    if image_bytes.startswith(b'BM'):
        return "image/bmp"

    # Not an image. Returning the real type lets callers skip or log;
    # they must check ``allowed_types`` before sending to vision APIs.
    if image_bytes.startswith(b'%PDF-'):
        return "application/pdf"
    if image_bytes.startswith(b'PK\x03\x04'):
        # ZIP container — typically DOCX/XLSX/PPTX; we don't differentiate.
        return "application/zip"

    # Genuinely unrecognized. Return fallback but log so an operator can see
    # that we guessed — the caller shouldn't blindly trust this.
    logger.warning(
        "detect_image_mime_type: unrecognized magic bytes %r — falling back to %s. "
        "This may cause downstream vision APIs to reject the payload.",
        image_bytes[:16], fallback,
    )
    return fallback


def safe_log_content(content: Any, max_length: int = 500, max_depth: int = 3) -> str:
    """
    Safely log content by truncating long strings and removing binary/base64 data.
    
    Args:
        content: Content to log (can be string, dict, list, etc.)
        max_length: Maximum length for string values
        max_depth: Maximum depth for nested structures
        
    Returns:
        Safe string representation for logging
    """
    def is_base64_like(s: str) -> bool:
        """Check if string looks like base64-encoded binary data."""
        if not isinstance(s, str) or len(s) < 100:
            return False
        # Base64 strings are long and contain only base64 characters
        base64_chars = set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n')
        if len(s) > 500 and all(c in base64_chars for c in s[:1000]):
            return True
        return False
    
    def sanitize_value(value: Any, depth: int = 0) -> Any:
        """Recursively sanitize values for logging."""
        if depth > max_depth:
            return "... (max depth reached)"
        
        if isinstance(value, str):
            if is_base64_like(value):
                return f"[BASE64_DATA: {len(value)} bytes]"
            if len(value) > max_length:
                return value[:max_length] + f"... [truncated, {len(value)} total chars]"
            return value
        elif isinstance(value, dict):
            return {k: sanitize_value(v, depth + 1) for k, v in list(value.items())[:20]}  # Limit dict size
        elif isinstance(value, list):
            return [sanitize_value(item, depth + 1) for item in value[:10]]  # Limit list size
        elif isinstance(value, bytes):
            return f"[BINARY_DATA: {len(value)} bytes]"
        else:
            return str(value)[:max_length]
    
    try:
        sanitized = sanitize_value(content)
        if isinstance(sanitized, (dict, list)):
            return json.dumps(sanitized, indent=2, default=str)[:2000]  # Limit total output
        return str(sanitized)[:2000]
    except Exception as e:
        return f"[Error sanitizing content: {e}]"

async def assemble_multimodal_context(
    parent_asset: Asset,
    run_config: dict,
    db: Session,
    storage_provider: 'StorageProviderDep'
) -> tuple[str, dict]:
    """Assemble text content and media inputs for provider"""
    # Ensure parent_asset.uuid is a string for the prompt
    parent_asset_uuid_str = str(parent_asset.uuid) if parent_asset.uuid else "UNKNOWN_PARENT_ASSET_UUID"
    
    media_inputs = []
    
    # Check if parent asset itself is an image that should be processed
    # PDF_PAGE assets are conditionally treated as images based on process_pdfs_as_images flag
    process_pdfs_as_images = run_config.get("process_pdfs_as_images", False)
    
    # Determine which asset kinds should be treated as images
    image_asset_kinds = _get_image_asset_kinds(process_pdfs_as_images)
    parent_is_image = parent_asset.kind in image_asset_kinds
    
    if parent_is_image:
        # Process the parent asset itself as the image to analyze
        if parent_asset.kind == AssetKind.PDF_PAGE and process_pdfs_as_images:
            logger.info(f"PDF_PAGE asset {parent_asset.id} will be processed as image (OCR mode enabled)")
        else:
            logger.info(f"Parent asset {parent_asset.id} is an image ({parent_asset.kind.value}), processing directly")
        image_content_bytes = await fetch_asset_content(parent_asset, storage_provider)
        
        # For PDF_PAGE assets: if no text content and we have image, use multimodal with document field
        is_pdf_page_without_text = (
            parent_asset.kind == AssetKind.PDF_PAGE and 
            (not parent_asset.text_content or not parent_asset.text_content.strip())
        )
        
        if image_content_bytes:
            # Detect actual MIME type from image bytes
            detected_mime_type = detect_image_mime_type(
                image_content_bytes,
                fallback=(parent_asset.file_info or {}).get("mime_type", "image/png")
            )
            
            # Validate image size (Anthropic limit: 5MB)
            image_size_mb = len(image_content_bytes) / (1024 * 1024)
            if image_size_mb > 5:
                logger.warning(
                    f"Image asset {parent_asset.id} is {image_size_mb:.2f}MB, "
                    f"which exceeds Anthropic's 5MB limit and may cause errors"
                )
            
            # Estimate token cost (~1600 tokens per image, scales with size)
            estimated_tokens = int(1600 * max(1, image_size_mb))
            logger.info(f"Image asset {parent_asset.id}: {image_size_mb:.2f}MB, ~{estimated_tokens} tokens, detected MIME type: {detected_mime_type}")
            
            media_inputs.append({
                "uuid": parent_asset_uuid_str,
                "type": "image",
                "content": image_content_bytes,
                "mime_type": detected_mime_type,
                "metadata": {
                    "title": parent_asset.title,
                    "original_kind": str(parent_asset.kind.value)
                }
            })
            
            # For PDF_PAGE without text: use document field for multimodal analysis
            if is_pdf_page_without_text:
                logger.info(f"PDF_PAGE {parent_asset.id} has no text content. Using multimodal analysis with document graph field.")
                text_content = (
                    f"PDF Page Asset (UUID: {parent_asset_uuid_str})\n"
                    f"Title: {parent_asset.title or 'Untitled'}\n"
                    f"Page Number: {parent_asset.part_index + 1 if parent_asset.part_index is not None else 'Unknown'}\n"
                    f"\nThis is a scanned PDF page with no extractable text. "
                    f"You must analyze the image content and extract graph nodes and edges according to the schema.\n\n"
                    f"IMPORTANT: You MUST populate the 'document' field with the graph data (nodes and edges) extracted from this image. "
                    f"The 'document' field is where the graph structure for this page should go. "
                    f"Do NOT leave 'document' as null - it must contain a valid object with 'nodes' and 'edges' arrays. "
                    f"Extract ALL relevant nodes and edges from the image, not just one. "
                    f"The 'per_image' field is only for analyzing other child images, not this page itself."
                )
            else:
                # Text content is minimal for standalone images
                text_content = f"Image Asset (UUID: {parent_asset_uuid_str})\nTitle: {parent_asset.title or 'Untitled'}\n"
        else:
            logger.warning(f"Parent asset {parent_asset.id} is an image but has no content available")
            # Fallback text content
            text_content = f"Image Asset (UUID: {parent_asset_uuid_str})\nTitle: {parent_asset.title or 'Untitled'}\n"
    else:
        # Parent is a document/text asset - use existing logic
        text_content_header = f"Parent Document (UUID: {parent_asset_uuid_str})\n---\n"
        text_content = f"{text_content_header}{parent_asset.text_content or ''}"
    
    # Determine if any per_modality processing is expected by the schema to guide media inclusion.
    # This is a simplified check based on run_config flags. A more advanced check could inspect schema_structure.
    # For now, we rely on explicit run_config flags like include_images, include_audio.

    # Check if image processing is enabled (explicitly True or auto-enabled)
    include_images_enabled = run_config.get("include_images", False)

    # "Whole document as text" mode for PDFs is an explicit user choice to
    # receive NO visual content from this PDF — not even embedded images or
    # rendered pages. The run-wide ``include_images`` flag stays useful for
    # other assets in the same run (plain image assets, non-PDF docs with
    # child images), but for a PDF parent in text mode we short-circuit the
    # child-image scan entirely. Respects the per-asset-kind mode over the
    # run-level vision toggle, which is the semantics the UI promises.
    pdf_text_mode = (
        parent_asset.kind == AssetKind.PDF
        and not process_pdfs_as_images
    )

    logger.debug(
        f"assemble_multimodal_context for Asset {parent_asset.id}: "
        f"kind={parent_asset.kind.value}, include_images={include_images_enabled}, "
        f"parent_is_image={parent_is_image}, pdf_text_mode={pdf_text_mode}"
    )
    if pdf_text_mode:
        logger.info(
            f"Asset {parent_asset.id} is a PDF in whole-document-text mode; "
            f"skipping all image-child attachment regardless of include_images."
        )
    if include_images_enabled and not parent_is_image and not pdf_text_mode:
        # Query for child assets of kind 'image' (and PDF_PAGE when OCR mode
        # is on) to attach alongside the parent's text content. This powers
        # per_image schema fields for mixed-media documents.
        image_like_kinds = list(_get_image_asset_kinds(process_pdfs_as_images=process_pdfs_as_images))
        image_like_kind_values = [kind.value for kind in image_like_kinds]

        image_children = db.query(Asset).filter(
            Asset.parent_asset_id == parent_asset.id,
            Asset.kind.in_(image_like_kind_values) 
        ).order_by(Asset.part_index, Asset.id).all()  # Order by part_index first (e.g., PDF pages), then ID
        
        logger.info(
            f"Found {len(image_children)} child image assets for parent Asset {parent_asset.id}. "
            f"Will process up to {run_config.get('max_images_per_asset', 10)} images."
        )
        
        images_added = 0
        images_skipped = 0
        added_image_uuids = []  # Track UUIDs of successfully added images
        for img_asset in image_children[:run_config.get("max_images_per_asset", 10)]:
            image_content_bytes = await fetch_asset_content(img_asset, storage_provider)
            if image_content_bytes:
                # Detect actual MIME type from image bytes
                detected_mime_type = detect_image_mime_type(
                    image_content_bytes,
                    fallback=(img_asset.file_info or {}).get("mime_type", "image/png")
                )
                
                # Validate image size and log token estimates
                image_size_mb = len(image_content_bytes) / (1024 * 1024)
                if image_size_mb > 5:
                    logger.warning(
                        f"Child image asset {img_asset.id} is {image_size_mb:.2f}MB, "
                        f"which exceeds Anthropic's 5MB limit and may cause errors"
                    )
                estimated_tokens = int(1600 * max(1, image_size_mb))
                logger.debug(f"Child image asset {img_asset.id}: {image_size_mb:.2f}MB, ~{estimated_tokens} tokens, detected MIME type: {detected_mime_type}")
                
                media_inputs.append({
                    "uuid": str(img_asset.uuid),
                    "type": "image", 
                    "content": image_content_bytes, 
                    "mime_type": detected_mime_type,
                    "metadata": {
                        "title": img_asset.title,
                        "original_kind": str(img_asset.kind.value) # e.g. "pdf_page"
                    }
                })
                images_added += 1
                added_image_uuids.append(str(img_asset.uuid))
                logger.info(
                    f"Added child image Asset {img_asset.id} (UUID: {img_asset.uuid}) to media inputs. "
                    f"Size: {len(image_content_bytes)} bytes, MIME type: {detected_mime_type}."
                )
            else:
                images_skipped += 1
                logger.warning(
                    f"Skipping image-like asset {img_asset.id} (Kind: {img_asset.kind.value}, "
                    f"UUID: {img_asset.uuid}) due to missing content. "
                    f"blob_path: {img_asset.blob_path}, source_identifier: {img_asset.source_identifier}"
                )
        
        logger.info(
            f"Image processing summary for Asset {parent_asset.id}: "
            f"{images_added} images added to media inputs, {images_skipped} skipped."
        )
        
        # NEW: Append UUID information for child images to text content
        # This is critical so the LLM knows which UUID to return for each image
        if added_image_uuids:
            text_content += "\n\n--- Included Images ---\n"
            for idx, img_uuid in enumerate(added_image_uuids, 1):
                text_content += f"Image {idx}: UUID {img_uuid}\n"
            text_content += "\nFor each image you analyze, you MUST include the exact UUID shown above in the 'system_asset_source_uuid' field of your response."
            logger.debug(f"Added UUID information for {len(added_image_uuids)} child images to text prompt")
    
    # Example for audio:
    if run_config.get("include_audio", False):
        audio_like_kinds = [AssetKind.AUDIO, AssetKind.AUDIO_SEGMENT]
        audio_like_kind_values = [kind.value for kind in audio_like_kinds]

        audio_children = db.query(Asset).filter(
            Asset.parent_asset_id == parent_asset.id,
            Asset.kind.in_(audio_like_kind_values)
        ).order_by(Asset.part_index, Asset.id).all()  # Order by part_index first, then ID

        for audio_asset in audio_children[:run_config.get("max_audio_per_asset", 5)]:
            audio_content_bytes = await fetch_asset_content(audio_asset, storage_provider)
            if audio_content_bytes:
                media_inputs.append({
                    "uuid": str(audio_asset.uuid),
                    "type": "audio",
                    "content": audio_content_bytes,
                    "mime_type": (audio_asset.file_info or {}).get("mime_type", "audio/mpeg"),
                    "metadata": {
                        "title": audio_asset.title,
                        "original_kind": str(audio_asset.kind.value)
                    }
                })
            else:
                logger.warning(f"Skipping audio-like asset {audio_asset.id} (Kind: {audio_asset.kind.value}) due to missing content.")
       
    provider_config_out = {
        "media_inputs": media_inputs,
        "enable_thinking": run_config.get("enable_thinking", False),
        "thinking_budget": run_config.get("thinking_budget", 10000)
    }
    
    return text_content, provider_config_out

async def demultiplex_results(
    result: dict, # This is the raw dict from the LLM provider
    schema_structure: dict, # From detect_schema_structure
    parent_asset: Asset,
    schema: AnnotationSchema, # The AnnotationSchema instance used
    run: AnnotationRun, # The AnnotationRun instance
    db: Session
) -> list[Annotation]:
    """Map hierarchical results back to appropriate assets"""
    annotations = []
    
    # DEBUG: Log what we received (safely, without binary data)
    logger.debug(f"DEBUG: demultiplex_results called for Run {run.id}, Asset {parent_asset.id}")
    logger.debug(f"DEBUG: result keys: {list(result.keys()) if result and isinstance(result, dict) else 'None'}")
    logger.debug(f"DEBUG: result type: {type(result)}, content preview: {safe_log_content(result) if result is not None else 'None'}")
    logger.debug(f"DEBUG: schema_structure document_fields: {bool(schema_structure.get('document_fields'))}")
    
    # Check if parent is a standalone image (PDF_PAGE or IMAGE/IMAGE_REGION without text)
    # PDF_PAGE is only treated as image if process_pdfs_as_images flag is enabled
    process_pdfs_as_images = run.configuration.get("process_pdfs_as_images", False) if run.configuration else False
    
    image_asset_kinds = _get_image_asset_kinds(process_pdfs_as_images)
    parent_is_image = parent_asset.kind in image_asset_kinds
    is_standalone_image = (
        (parent_asset.kind == AssetKind.PDF_PAGE and process_pdfs_as_images) or
        (parent_asset.kind in {AssetKind.IMAGE, AssetKind.IMAGE_REGION} and 
         (not parent_asset.text_content or not parent_asset.text_content.strip()))
    )
    is_flat_schema = not schema_structure["per_modality_fields"]
    
    if parent_is_image and is_flat_schema:
        # Flat schema on image: entire result goes to the image asset
        logger.info(f"Flat schema on image asset {parent_asset.id}, storing full result as annotation")
        annotation = Annotation(
            asset_id=parent_asset.id,
            schema_id=schema.id,
            run_id=run.id,
            value=result,  # All extracted fields go directly here
            status=ResultStatus.SUCCESS,
            infospace_id=run.infospace_id,
            user_id=run.user_id
        )
        annotations.append(annotation)
        return annotations  # No child processing needed for standalone images
    
    # Special handling for standalone images with hierarchical schema (document + per_image)
    # Merge document fields and per_image fields into a single annotation
    if is_standalone_image and schema_structure.get("per_modality_fields"):
        logger.info(
            f"Standalone image {parent_asset.id} with hierarchical schema. "
            f"Merging document and per_image fields into single annotation."
        )
        
        merged_value = {}
        
        # Add document fields if present
        if "document" in result and isinstance(result["document"], dict):
            merged_value.update(result["document"])
            logger.debug(f"Merged document fields: {list(result['document'].keys())}")
        
        # Merge per_image fields (take first item if array, or merge all items)
        for modality, _ in schema_structure["per_modality_fields"].items():
            per_key = f"per_{modality}"
            if per_key in result:
                modality_data = result[per_key]
                if isinstance(modality_data, list) and len(modality_data) > 0:
                    # For standalone images, typically there's one image, so take the first item
                    # Merge its fields into the main annotation
                    first_item = modality_data[0]
                    if isinstance(first_item, dict):
                        # Remove system UUID field as it's not needed in the final annotation
                        first_item_clean = {k: v for k, v in first_item.items() if k != "system_asset_source_uuid"}
                        merged_value.update(first_item_clean)
                        logger.debug(f"Merged {per_key} fields: {list(first_item_clean.keys())}")
                    else:
                        logger.warning(f"per_{modality} item is not a dict, skipping merge")
                elif isinstance(modality_data, dict):
                    # If it's already a dict (not a list), merge it directly
                    modality_clean = {k: v for k, v in modality_data.items() if k != "system_asset_source_uuid"}
                    merged_value.update(modality_clean)
                    logger.debug(f"Merged {per_key} fields directly: {list(modality_clean.keys())}")
        
        # Create single merged annotation
        annotation = Annotation(
            asset_id=parent_asset.id,
            schema_id=schema.id,
            run_id=run.id,
            value=merged_value,
            status=ResultStatus.SUCCESS,
            infospace_id=run.infospace_id,
            user_id=run.user_id
        )
        annotations.append(annotation)
        logger.info(f"Created merged annotation for standalone image {parent_asset.id} with {len(merged_value)} fields")
        return annotations
    
    # NEW: Handle nested document structure where result["document"] contains {"document": {...}, "per_image": [...]}
    # This can happen when the LLM wraps the response incorrectly
    if "document" in result and isinstance(result["document"], dict):
        doc_value = result["document"]
        # Check if document contains nested document and per-modality keys
        has_nested_doc = "document" in doc_value
        has_nested_per_modality = any(f"per_{modality}" in doc_value for modality in schema_structure["per_modality_fields"].keys())
        
        if has_nested_doc or has_nested_per_modality:
            logger.warning(
                f"Detected nested document structure for Asset {parent_asset.id}, Run {run.id}. "
                f"Unwrapping: document contains keys: {list(doc_value.keys())[:10]}"
            )
            # Unwrap: use the nested document as the actual document, and merge per-modality fields to top level
            if has_nested_doc:
                result["document"] = doc_value["document"]
            # Move per-modality fields to top level
            for modality in schema_structure["per_modality_fields"].keys():
                per_key = f"per_{modality}"
                if per_key in doc_value:
                    result[per_key] = doc_value[per_key]
                    logger.info(f"Unwrapped {per_key} from nested document structure")
    
        # Create annotation for parent asset from document fields
    if schema_structure["document_fields"] and "document" in result:
        parent_annotation_value = result["document"]
        logger.debug(f"DEBUG: Found document result, type: {type(parent_annotation_value)}, value preview: {safe_log_content(parent_annotation_value)}")

        # Always persist a parent annotation when ``document`` is a dict — even
        # if it's empty. Previously we silently dropped empty documents when the
        # schema also had per_modality fields, on the assumption per_modality
        # children would carry the data. But in whole-document-text mode the
        # per_modality arrays are always empty (no images reach the LLM), so
        # dropping the parent produced "0 annotations" despite a successful
        # response. Storing the empty-but-structured document lets the UI show
        # the result and makes the "nothing extracted" case visible.
        if isinstance(parent_annotation_value, dict):
            parent_annotation = Annotation(
                asset_id=parent_asset.id,
                schema_id=schema.id,
                run_id=run.id,
                value=parent_annotation_value,
                status=ResultStatus.SUCCESS,
                infospace_id=run.infospace_id,
                user_id=run.user_id
            )
            annotations.append(parent_annotation)
            if not parent_annotation_value:
                logger.info(
                    f"Asset {parent_asset.id} Run {run.id}: LLM returned empty document. "
                    f"Persisting empty annotation so the result is visible."
                )
        else:
            logger.warning(f"LLM result for 'document' in Run {run.id}, Asset {parent_asset.id} was not a dict. Got: {type(parent_annotation_value)}. Skipping parent annotation.")
    else:
        logger.debug(f"DEBUG: No 'document' key in result or no document_fields. Available keys: {list(result.keys()) if result and isinstance(result, dict) else 'None'}")
        
        # NEW: Handle schema envelope format that wasn't normalized earlier
        if isinstance(result, dict) and "$schema" in result and "$content" in result:
            logger.warning(
                f"demultiplex_results: Received schema envelope format for Asset {parent_asset.id}, Run {run.id}. "
                f"This should have been normalized earlier. Attempting fallback handling."
            )
            content_data = result.get("$content")
            
            # Try to parse $content if it's a string
            if isinstance(content_data, str):
                try:
                    content_data = json.loads(content_data)
                except json.JSONDecodeError:
                    pass  # Keep as string
            
            # Create partial annotation with error metadata for manual review
            fallback_annotation = Annotation(
                asset_id=parent_asset.id,
                schema_id=schema.id,
                run_id=run.id,
                value={
                    "error": "Schema envelope format received - requires manual review",
                    "raw_content": content_data if isinstance(content_data, dict) else str(content_data)[:500],
                    "requires_manual_review": True,
                    "original_format": "schema_envelope"
                },
                status=ResultStatus.FAILED,
                infospace_id=run.infospace_id,
                user_id=run.user_id
            )
            annotations.append(fallback_annotation)
            logger.warning(f"Created fallback annotation with error metadata for Asset {parent_asset.id}, Run {run.id}")
            return annotations
        
        # FALLBACK: If no hierarchical structure, treat the entire result as document-level
        if not schema_structure["per_modality_fields"] and result:
            logger.debug(f"DEBUG: No hierarchical structure detected, using entire result as document annotation")
            parent_annotation = Annotation(
                asset_id=parent_asset.id,
                schema_id=schema.id,
                run_id=run.id,
                value=result,
                status=ResultStatus.SUCCESS,
                infospace_id=run.infospace_id,
                user_id=run.user_id
            )
            annotations.append(parent_annotation)
            logger.debug(f"DEBUG: Created fallback annotation for Asset {parent_asset.id}, Run {run.id}")
    
    for modality, _ in schema_structure["per_modality_fields"].items():
        result_key_for_modality = f"per_{modality}"
        system_uuid_field_name = "system_asset_source_uuid" # The internal field name
        
        if result_key_for_modality in result:
            modality_results = result[result_key_for_modality]
            
            if not isinstance(modality_results, list):
                logger.warning(f"LLM result for '{result_key_for_modality}' in Run {run.id}, Asset {parent_asset.id} was not a list. Got: {type(modality_results)}. Skipping child annotations for this modality.")
                continue

            for i, child_result_data_from_llm in enumerate(modality_results):
                child_asset_to_annotate: Optional[Asset] = None
                
                if not isinstance(child_result_data_from_llm, dict):
                    logger.warning(f"LLM result item for modality '{modality}', index {i}, in Run {run.id} (Parent Asset {parent_asset.id}) was not a dict. Got: {type(child_result_data_from_llm)}. Skipping this child annotation.")
                    continue

                llm_provided_uuid = child_result_data_from_llm.get(system_uuid_field_name)
                
                if not llm_provided_uuid:
                    logger.error(f"Critical: LLM failed to provide the required internal field '{system_uuid_field_name}' for modality '{modality}', item {i}, Run {run.id}, Parent Asset {parent_asset.id}. Cannot map this result. Skipping child annotation.")
                    continue # Skip this item as robust mapping is not possible
                
                if not isinstance(llm_provided_uuid, str):
                    logger.warning(f"LLM provided non-string internal UUID '{llm_provided_uuid}' ('{system_uuid_field_name}') for modality '{modality}', item {i}, Run {run.id}. Attempting to cast.")
                    try:
                        llm_provided_uuid = str(llm_provided_uuid)
                    except Exception:
                        logger.error(f"Could not cast provided internal UUID to string. Skipping child annotation for item {i}, modality '{modality}', Run {run.id}.")
                        continue
            
                # Convert modality string to AssetKind enum if needed
                try:
                    if isinstance(modality, str):
                        asset_kind = AssetKind(modality.lower())
                    else:
                        asset_kind = modality
                except ValueError:
                    logger.error(f"Invalid modality '{modality}' for Run {run.id}, Asset {parent_asset.id}. Skipping child annotation.")
                    continue
                
                image_asset_kinds = _get_image_asset_kinds(process_pdfs_as_images=True)
                parent_matches_kind = (
                    parent_asset.kind == asset_kind or
                    (parent_asset.kind in image_asset_kinds and asset_kind == AssetKind.IMAGE)
                )
                
                if str(parent_asset.uuid) == llm_provided_uuid and parent_matches_kind:
                    child_asset_to_annotate = parent_asset
                    logger.info(f"Mapped LLM result for modality '{modality}' item {i} to parent Asset ID {parent_asset.id} (standalone image)")
                else:
                    # Otherwise look for child asset
                    found_asset = db.query(Asset).filter(
                        Asset.uuid == llm_provided_uuid,
                        Asset.parent_asset_id == parent_asset.id,
                        Asset.kind == asset_kind
                    ).first()
                    
                    if found_asset:
                        child_asset_to_annotate = found_asset
                        logger.info(f"Mapped LLM result for modality '{modality}' item {i} to child Asset ID {found_asset.id} using internal UUID '{llm_provided_uuid}'.")
                    else:
                        logger.error(f"Critical: LLM provided internal UUID '{llm_provided_uuid}' ('{system_uuid_field_name}') for modality '{modality}', item {i}, Run {run.id}, but no matching child asset found for Parent Asset {parent_asset.id}. Skipping child annotation.")
                        continue # Skip if no matching asset found

                # Remove the internal UUID field before storing the value
                final_child_value_for_storage = child_result_data_from_llm.copy()
                if system_uuid_field_name in final_child_value_for_storage:
                    del final_child_value_for_storage[system_uuid_field_name]
                else:
                    # This should ideally not happen if llm_provided_uuid was sourced from it, but log if it does.
                    logger.warning(f"Internal field '{system_uuid_field_name}' was expected but not found in child_result_data_from_llm for stripping. LLM output was: {child_result_data_from_llm.keys()}")

                child_annotation = Annotation(
                    asset_id=child_asset_to_annotate.id,
                    schema_id=schema.id,
                    run_id=run.id,
                    value=final_child_value_for_storage, 
                    status=ResultStatus.SUCCESS,
                    infospace_id=run.infospace_id,
                    user_id=run.user_id
                )
                annotations.append(child_annotation)
    
    logger.debug(f"DEBUG: demultiplex_results returning {len(annotations)} annotations for Run {run.id}, Asset {parent_asset.id}")
    return annotations

CHAINED_RUN_CURSOR_KEY = "_chained_asset_ids"


@task("process_annotation_run",
      check=lambda iid: (
          select(AnnotationRun.id)
          .where(
              AnnotationRun.infospace_id == iid,
              # PENDING only: this task doesn't set RUNNING itself (only the
              # retry path does). A RUNNING run is either an active retry
              # (handled by its own task) or a zombie from a prior crash —
              # picking it up here caused infinite self_chain loops.
              AnnotationRun.status == RunStatus.PENDING,
          )
          .order_by(AnnotationRun.created_at)
      ),
      schedule=None,
      triggers=["annotation_run.created"],
      batch=1,
      self_chain=True,
      queue="llm",
      timeout=7200,
      tags=frozenset({"annotation"}))
def process_annotation_run(ctx: TaskContext, run_ids: list[int]) -> None:
    """
    Process annotation runs. Discovers PENDING runs via check query.
    For large runs (> ANNOTATION_CHUNK_SIZE), processes one chunk per invocation
    and self-chains to continue. Uses Redis lock per run.
    """
    from app.core.redis_lock import annotation_run_lock

    chunk_size = settings.ANNOTATION_CHUNK_SIZE

    for run_id in run_ids:
        with annotation_run_lock(run_id) as acquired:
            if not acquired:
                logger.info("Annotation run %d already in progress, skipping (setting chain_backoff)", run_id)
                # Throttle self_chain so a live sibling-worker (or a stale
                # lock whose TTL hasn't expired) doesn't trigger a tight
                # 50-deep loop. The chain_backoff key is read in
                # @task self_chain and becomes a countdown for the next
                # invocation. Key expires so normal scheduling resumes
                # once the lock clears.
                try:
                    from app.core.redis import get_redis
                    r = get_redis()
                    if r:
                        r.set(f"task:process_annotation_run:{ctx.infospace_id}:chain_backoff", "60", ex=120)
                except Exception:
                    logger.debug("chain_backoff set failed", exc_info=True)
                continue

            # Load cursor from configuration (persisted between self-chain invocations)
            with Session(engine) as session:
                run = session.get(AnnotationRun, run_id)
                if not run:
                    continue
                if run.status in (RunStatus.COMPLETED, RunStatus.COMPLETED_WITH_ERRORS):
                    continue
                cursor = (run.configuration or {}).get("_cursor", 0)

            try:
                next_cursor = run_async_in_celery(_process_annotation_run_async, run_id, cursor, chunk_size)
                if isinstance(next_cursor, int):
                    # Store cursor for next self-chain invocation
                    with Session(engine) as session:
                        run = session.get(AnnotationRun, run_id)
                        if run:
                            cfg = dict(run.configuration or {})
                            cfg["_cursor"] = next_cursor
                            run.configuration = cfg
                            session.add(run)
                            session.commit()
                    logger.info("Annotation run %d: chunk done, cursor %d → %d", run_id, cursor, next_cursor)
                    ctx.stat("chunk_done")
                else:
                    # Async returned without an int cursor — either the run
                    # finished or the guard skipped. Only emit the completion
                    # event when the run actually reached a terminal state, so
                    # a skip can't cause resume_waiting_flows loops.
                    with Session(engine) as session:
                        run = session.get(AnnotationRun, run_id)
                        if run and run.status in (
                            RunStatus.COMPLETED,
                            RunStatus.COMPLETED_WITH_ERRORS,
                            RunStatus.FAILED,
                        ):
                            from app.core.events import emit
                            emit("annotation_run.completed", {
                                "infospace_id": run.infospace_id,
                            })
                            ctx.stat("done")
                        else:
                            logger.info(
                                "process_annotation_run run %d returned without cursor but status=%s; not emitting completion",
                                run_id,
                                run.status if run else "missing",
                            )
                            ctx.stat("skipped")
            except Exception as e:
                logger.exception("process_annotation_run failed for run %d: %s", run_id, e)
                with Session(engine) as session:
                    try:
                        run = session.get(AnnotationRun, run_id)
                        if run:
                            run.status = RunStatus.FAILED
                            run.error_message = f"Critical task error: {str(e)}"
                            run.completed_at = datetime.now(timezone.utc)
                            run.updated_at = datetime.now(timezone.utc)
                            session.add(run)
                            session.commit()
                            # Presence: push failure to watching browsers
                            fail_payload = {
                                "run_id": run_id,
                                "parent_run_id": run.parent_run_id,
                                "status": "failed",
                                "error": str(e),
                            }
                            ctx.send("annotation_run", run_id, "failed", fail_payload)
                            if run.parent_run_id:
                                ctx.send("annotation_run", run.parent_run_id, "failed", fail_payload)
                    except Exception as db_exc:
                        logger.error("Could not update run %d to FAILED: %s", run_id, db_exc)
                ctx.item_failed(run_id)
                ctx.stat("failed")

async def _drain_stream(stream_iter) -> Any:
    """Consume a streaming AsyncIterator from a provider and return the final
    accumulated GenerationResponse. The provider yields progressively-richer
    GenerationResponse objects; the last one carries the full text + thinking
    trace + tool executions. Streaming Phase A/B avoids Anthropic's
    nonstreaming-timeout check, which trips for high ``max_tokens`` values."""
    last = None
    async for chunk in stream_iter:
        last = chunk
    return last


# ─── Two-phase extraction helpers (Track 2) ────────────────────────────────
#
# When a schema has ``array<object>`` fields (triplets, key_actors, financial
# records, …) the cardinality is model-determined and a single forced-tool call
# can truncate at ``max_tokens``. The two-phase pipeline splits work:
#
#   Phase A — one forced tool call against the scalar subset (everything that
#             isn't an array-of-object). Bounded output. Thinking ON. The doc
#             is sent fresh; the response is one structured dict.
#
#   Phase B — open-ended tool loop. Tools: ``submit(field, items)`` and
#             ``done(rationale)``. The doc is sent again but marked
#             ``cacheable=True`` so the prefix lands in Anthropic's ephemeral
#             cache and every subsequent loop turn re-uses it. Thinking OFF.
#             Server-side dedup by content hash; the model gets a turn-by-turn
#             receipt of how many items it landed.
#
# Merge: the scalar dict + the per-field item lists assemble back into the
# original schema's value shape. demultiplex_results sees one combined dict
# and can't tell the difference from a single-shot call.
#
# Trigger: schema has list-of-object fields AND doc fits comfortably in
# context AND provider supports tools. Configurable via run_config
# ``extraction_strategy ∈ {auto, two-phase, single-shot}``. Default ``auto``.

_DOC_TOKEN_BUDGET_FRACTION = 0.6  # leave headroom for system + tools + thinking
_PHASE_A_MODEL_CACHE_KEY = "_phase_a_output_model_class"
_TOKENS_PER_CHAR = 0.25  # crude approximation; good enough for routing


def _wrap_user_content_with_cache_marker(text_content: Any) -> List[Dict[str, Any]]:
    """Produce a content-block list with ``cacheable=True`` on the LAST text block.

    Anthropic's prompt-cache markers attach to a single block to define a
    breakpoint; the cached prefix covers everything BEFORE and INCLUDING the
    marked block. So we mark only the last text block — that one breakpoint
    caches the whole user message (any preceding image blocks too).

    Accepts the heterogeneous shape ``assemble_multimodal_context`` returns:
    a plain string, or a list of structured content blocks.
    """
    if isinstance(text_content, str):
        if not text_content.strip():
            return []
        return [{"type": "text", "text": text_content, "cacheable": True}]
    if isinstance(text_content, list):
        out: List[Dict[str, Any]] = []
        last_text_idx = -1
        for i, b in enumerate(text_content):
            if isinstance(b, dict) and b.get("type") == "text":
                last_text_idx = i
        for i, b in enumerate(text_content):
            if i == last_text_idx and isinstance(b, dict):
                b = dict(b)
                b.setdefault("cacheable", True)
            out.append(b)
        return out
    return []


def _capture_token_usage(provider_response: Any) -> Optional[Dict[str, Any]]:
    """Extract a normalised token-usage dict from a provider response.

    Pulls input/output and the two cache fields (``cache_creation_input_tokens``
    and ``cache_read_input_tokens``) so we can verify caching is actually
    paying off. Returns ``None`` when the provider didn't surface usage —
    treated as missing telemetry, not zero usage.
    """
    usage = getattr(provider_response, "usage", None)
    if not usage:
        return None
    if hasattr(usage, "model_dump"):
        try:
            usage = usage.model_dump()
        except Exception:
            usage = None
    if not isinstance(usage, dict):
        return None
    return {
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
        "cache_creation_input_tokens": usage.get("cache_creation_input_tokens"),
        "cache_read_input_tokens": usage.get("cache_read_input_tokens"),
    }


def _estimate_tokens(text_content: Any) -> int:
    """Rough character-count → token estimate. Used only for routing decisions."""
    if isinstance(text_content, str):
        return int(len(text_content) * _TOKENS_PER_CHAR)
    if isinstance(text_content, list):
        total = 0
        for block in text_content:
            if isinstance(block, dict) and isinstance(block.get("text"), str):
                total += int(len(block["text"]) * _TOKENS_PER_CHAR)
        return total
    return 0


def _pick_extraction_strategy(
    *,
    run_config: Dict[str, Any],
    list_fields: List[Dict[str, Any]],
    doc_tokens: int,
    context_length: Optional[int],
    provider_supports_tools: bool,
) -> str:
    """Resolve single-shot vs two-phase.

    ``auto`` (default) prefers two-phase whenever a schema has any
    ``array<object>`` field and the provider supports tools — exhaustiveness
    matters more than the small per-doc cache cost. Falls back to single-shot
    when there's nothing for Phase B to do (no list fields), the provider
    can't run tools, or the doc would blow the cached-prefix budget.

    Callers can force either path via ``run_config.extraction_strategy``.

    Returns: ``"single-shot"`` or ``"two-phase"``.
    """
    explicit = (run_config.get("extraction_strategy") or "auto").strip().lower()
    if explicit in ("single-shot", "single_shot", "single"):
        return "single-shot"
    if explicit in ("two-phase", "two_phase", "two"):
        return "two-phase"
    # auto — two-phase by default; single-shot only when we have to.
    if not list_fields:
        return "single-shot"
    if not provider_supports_tools:
        return "single-shot"
    if context_length and doc_tokens > int(context_length * _DOC_TOKEN_BUDGET_FRACTION):
        # Doc would exceed the cached-prefix budget — Phase B's per-turn
        # context would explode. P7 (windowed extraction) will fix this; for
        # now we degrade to single-shot which at worst truncates output.
        return "single-shot"
    return "two-phase"


def _summarize_phase_a_for_phase_b(phase_a_data: Dict[str, Any]) -> str:
    """One-line summaries of Phase A scalars to ground Phase B's extraction.

    Sent to the model as a short context block so it knows the document-level
    judgments already on record. Non-truthy values, justification siblings, and
    obvious noise are skipped.
    """
    if not isinstance(phase_a_data, dict):
        return ""
    body = phase_a_data.get("document", phase_a_data) if isinstance(phase_a_data, dict) else {}
    if not isinstance(body, dict):
        return ""
    lines: List[str] = []
    for k, v in body.items():
        if v is None or v == "" or v == [] or v == {}:
            continue
        if k.endswith("_justification") or k == "_thinking_trace":
            continue
        if isinstance(v, (dict, list)):
            try:
                v_str = json.dumps(v, ensure_ascii=False)
            except (TypeError, ValueError):
                v_str = str(v)
        else:
            v_str = str(v)
        if len(v_str) > 240:
            v_str = v_str[:240] + "…"
        lines.append(f"  {k}: {v_str}")
    return "\n".join(lines)


async def _run_phase_b_loop(
    *,
    asset: Asset,
    provider,
    model_name: str,
    system_instructions: str,
    text_content: Any,
    media_inputs: List[Dict[str, Any]],
    list_fields: List[Dict[str, Any]],
    phase_a_data: Optional[Dict[str, Any]] = None,
    extra_provider_kwargs: Optional[Dict[str, Any]] = None,
    max_tool_iterations: int = 40,
) -> Dict[str, Any]:
    """Phase B: open-ended tool loop. Returns ``{accumulator, telemetry}``.

    The provider's own tool loop (``_tool_loop_generate`` for Anthropic)
    drives the back-and-forth — we hand it ``submit`` + ``done`` tools and a
    closure-bound executor that maintains the accumulator across turns. ONE
    ``provider.generate`` call suffices.

    ``max_tool_iterations`` caps how many submit/done turns the provider
    will run; default 40 (vs the provider's universal default of 20)
    because dense docs need more headroom. ``done()`` short-circuits the
    loop via a sentinel return so we usually don't get near the cap.
    """
    accumulator: Dict[str, list] = {f["name"]: [] for f in list_fields}
    seen_keys: Dict[str, set] = {f["name"]: set() for f in list_fields}
    items_received: Dict[str, int] = {f["name"]: 0 for f in list_fields}
    items_dropped: Dict[str, int] = {f["name"]: 0 for f in list_fields}
    field_names = [f["name"] for f in list_fields]
    done_state: Dict[str, Any] = {"done": False, "rationale": ""}

    submit_tool = {
        "name": "submit",
        "description": (
            "Submit one or more items for a single list field. Call this tool "
            "REPEATEDLY — once per batch you can extract — until you have "
            "exhausted what the document supports. Each call carries items for "
            "ONE field. The server deduplicates by content; the response tells "
            "you how many items it accepted vs dropped as duplicates. "
            "Items must conform to the schema of the named field."
        ),
        # ``parameters`` is the key the provider's tool-prep function expects
        # for bare-format tools; it gets translated into Anthropic's native
        # ``input_schema`` downstream.
        "parameters": {
            "type": "object",
            "properties": {
                "field": {
                    "type": "string",
                    "enum": field_names,
                    "description": "Which list field these items belong to.",
                },
                "items": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "One or more items matching the field's item schema.",
                },
            },
            "required": ["field", "items"],
        },
        # NOT cacheable: a single ``cache_control`` on the LAST tool (done_tool)
        # caches ALL preceding tools + the system prompt as one prefix. Anthropic
        # caps requests at 4 cache breakpoints — we can't afford to spend two on
        # the tool boundary when one suffices.
    }
    done_tool = {
        "name": "done",
        "description": (
            "Terminate the extraction loop. Call this ONLY when you have "
            "exhaustively mined every item the document supports across all "
            "list fields. Provide a one-sentence rationale citing what makes "
            "you confident you are finished."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "rationale": {"type": "string"},
            },
            "required": ["rationale"],
        },
        # NOT cacheable: Anthropic's prefix order is tools → system → messages,
        # so a cache_control on the system message (set below) covers tools +
        # system in one breakpoint. Marking a tool would only cache the tools
        # — strictly less coverage.
    }

    async def tool_executor(name: str, tool_input: Dict[str, Any]) -> Dict[str, Any]:
        if name == "done":
            done_state["done"] = True
            done_state["rationale"] = (tool_input or {}).get("rationale", "")
            # Sentinel: tells the provider's tool loop to break instead of
            # forcing another ``submit``/``done`` call on the next turn.
            # Without this, ``tool_choice={"type":"any"}`` keeps the loop
            # spinning until the iteration cap.
            return {
                "acknowledged": True,
                "received_total": {f: len(accumulator[f]) for f in field_names},
                "_terminate_loop": True,
            }
        if name == "submit":
            field = (tool_input or {}).get("field")
            items = (tool_input or {}).get("items") or []
            if field not in accumulator:
                return {"error": f"Unknown field '{field}'. Valid fields: {field_names}"}
            received = 0
            duplicates = 0
            for item in items:
                if not isinstance(item, dict):
                    continue
                try:
                    key = json.dumps(item, sort_keys=True, default=str)
                except (TypeError, ValueError):
                    key = id(item)
                if key in seen_keys[field]:
                    duplicates += 1
                    continue
                seen_keys[field].add(key)
                accumulator[field].append(item)
                received += 1
            items_received[field] += received
            items_dropped[field] += duplicates
            return {
                "received": received,
                "duplicates_dropped": duplicates,
                "total_so_far": len(accumulator[field]),
                "all_field_totals": {f: len(accumulator[f]) for f in field_names},
            }
        return {"error": f"Unknown tool: {name}"}

    # Build the per-field shape prompt. The submit tool's items shape is
    # permissive (object); the per-field schema lives in the prompt so the
    # model knows exactly what to fill.
    #
    # Entity-aware rendering: when a property is an entity reference (carries
    # the x-entityField extension) or an array of entity references, render
    # the inner {name, type} constraints inline so the model sees the closed
    # name list / declared entity_type. Without this, the model receives
    # `beguenstigte_firmen (object) — A Konzern entity reference.` and has to
    # guess the {name, type} shape from convention.
    def _format_prop_line(prop_name: str, prop: dict, required_set: set, indent: str = "    ") -> List[str]:
        if not isinstance(prop, dict):
            return []
        req_marker = "*" if prop_name in required_set else " "
        pdesc = (prop.get("description") or "").replace("\n", " ").strip()
        if pdesc and len(pdesc) > 200:
            pdesc = pdesc[:200] + "…"

        # Entity reference — show declared entity_type + the closed name enum
        # if present (typeConstrained=true on the source field).
        if prop.get("x-entityField") is True:
            etype = prop.get("x-entityType") or ""
            ename_enum = prop.get("x-entityEnum") or []
            type_label = f"entity[{etype}]" if etype else "entity"
            head = f"{indent}{req_marker} {prop_name} ({type_label})"
            if pdesc:
                head += f" — {pdesc}"
            lines = [head]
            inner = f"{indent}    For each: {{ name: string"
            if ename_enum:
                # Cap printed names at 60 to keep prompts manageable; full enum
                # remains structurally on the JSON Schema if/when we validate.
                shown = list(ename_enum)[:60]
                more = len(ename_enum) - len(shown)
                inner += f" [one of: {shown}{f' …+{more} more' if more > 0 else ''}]"
            inner += f", type: string"
            if etype:
                inner += f" [\"{etype}\"]"
            inner += " }"
            lines.append(inner)
            return lines

        # Array of entity references (array_entity).
        if prop.get("type") == "array" and isinstance(prop.get("items"), dict) and prop["items"].get("x-entityField") is True:
            items = prop["items"]
            etype = items.get("x-entityType") or ""
            ename_enum = items.get("x-entityEnum") or []
            type_label = f"list of entity[{etype}]" if etype else "list of entity"
            head = f"{indent}{req_marker} {prop_name} ({type_label})"
            if pdesc:
                head += f" — {pdesc}"
            lines = [head]
            inner = f"{indent}    Each item: {{ name: string"
            if ename_enum:
                shown = list(ename_enum)[:60]
                more = len(ename_enum) - len(shown)
                inner += f" [one of: {shown}{f' …+{more} more' if more > 0 else ''}]"
            inner += f", type: string"
            if etype:
                inner += f" [\"{etype}\"]"
            inner += " }"
            lines.append(inner)
            return lines

        # Plain property — type + enum + min/max + description.
        ptype = prop.get("type", "?")
        # Collapse array<primitive> into "list of <X>" for readability.
        if ptype == "array" and isinstance(prop.get("items"), dict):
            items = prop["items"]
            it = items.get("type", "?")
            if it != "object":
                ptype = f"list of {it}"
                if items.get("enum"):
                    ptype += f" enum={items['enum']}"
        line = f"{indent}{req_marker} {prop_name} ({ptype})"
        enum_vals = prop.get("enum")
        if enum_vals:
            line += f" enum={enum_vals}"
        if prop.get("minimum") is not None or prop.get("maximum") is not None:
            line += f" range=[{prop.get('minimum', '–')}..{prop.get('maximum', '–')}]"
        if pdesc:
            line += f" — {pdesc}"
        return [line]

    field_descriptions: List[str] = []
    any_field_has_justification = False
    for f in list_fields:
        item_props = f["item_schema"].get("properties", {}) or {}
        item_required = set(f["item_schema"].get("required", []) or [])
        prop_lines: List[str] = []
        for prop_name, prop in item_props.items():
            prop_lines.extend(_format_prop_line(prop_name, prop, item_required))
        desc = (f.get("description") or "").strip()
        section_parts = [f"\nField: `{f['name']}`"]
        if desc:
            section_parts.append(f"\n  Field description: {desc}")
        if prop_lines:
            section_parts.append("\n  Item shape (* = required):\n" + "\n".join(prop_lines))
        # When this field has per-item justification enabled (P1 inline
        # placement), describe the typed structure the model must fill.
        # Without this, the model invents free-text strings that downstream
        # graph evidence consumers reject.
        if f.get("include_justification"):
            any_field_has_justification = True
            jp = (f.get("justification_prompt") or "").strip()
            section_parts.append(
                "\n  REQUIRED inline `justification` field on each item — structured object:"
                "\n      reasoning (string): one-paragraph explanation citing the document"
                "\n      text_spans (array of {text_snippet: string}): 1-3 verbatim quotes from the document"
                + (f"\n      Author guidance: {jp}" if jp else "")
            )
        field_descriptions.append("".join(section_parts))

    user_prompt_tail_lines = [
        "Your task: extract every item the document supports for the list fields below.",
        "Call the `submit` tool repeatedly — once per batch — passing items for one field at a time.",
        "When you have genuinely exhausted what the document offers, call `done` with a one-sentence rationale.",
        "",
        "CRITICAL: You MUST respond by calling either `submit` or `done`. Free-text responses",
        "are not permitted. If the document has nothing to extract for any list field, call `done`",
        "immediately with that fact as the rationale.",
        "",
        "Rules:",
        "- Be exhaustive. If a single document mentions 30 relationships, submit all 30.",
        "  Err on the side of inclusion — mark certainty per item rather than omitting.",
        "- The server deduplicates submissions by content. Re-submitting an item is harmless but wastes tokens.",
        "- Each submitted item must match the schema of the named field. Only include a",
        "  `justification` field on items where the field schema below explicitly requires it.",
        "- Items can be submitted across many turns. There is no per-call item limit.",
        "",
        "List fields to fill:" + "".join(field_descriptions),
    ]
    if phase_a_data:
        summary = _summarize_phase_a_for_phase_b(phase_a_data)
        if summary:
            user_prompt_tail_lines.extend([
                "",
                "Phase A already produced these document-level scalars (do not re-emit them):",
                summary,
            ])
    user_prompt_tail = "\n".join(user_prompt_tail_lines)

    # Assemble messages with explicit cache breakpoints. Anthropic caps each
    # request at 4 ``cache_control`` markers; we use 3 here, positioned for
    # progressively-larger prefix coverage so a partial match (e.g. across
    # different assets sharing the same schema) still pays cache prices:
    #
    #   Anthropic prefix order:  tools → system → messages
    #
    #   1. system block          → caches tools + system
    #                              (cross-asset benefit: shared across every
    #                              run that uses this schema's instructions)
    #   2. doc text              → caches tools + system + images + doc
    #                              (cross-run benefit: same asset + same
    #                              schema retry within 5 min)
    #   3. user_prompt_tail      → caches tools + system + doc + tail
    #                              (in-loop benefit: turns 2..N of THIS
    #                              Phase B inner loop)
    #
    # Tool-result blocks appended on later turns extend beyond the prefix and
    # are intentionally NOT cached (they grow per turn).
    messages: List[Dict[str, Any]] = []
    if system_instructions:
        # Structured form + cacheable so the prefix lands in cache — covers
        # tools + system. The single most valuable marker for cross-asset
        # caching when running batches with the same schema.
        messages.append({
            "role": "system",
            "content": [{"type": "text", "text": system_instructions, "cacheable": True}],
        })

    user_content_blocks: List[Dict[str, Any]] = []
    if isinstance(text_content, list):
        # ``text_content`` is already structured. Mark only the LAST text
        # block cacheable — that single breakpoint caches all preceding
        # blocks (images, earlier text). Marking every text block would
        # waste breakpoints with no extra cache benefit.
        last_text_idx = -1
        for i, b in enumerate(text_content):
            if isinstance(b, dict) and b.get("type") == "text":
                last_text_idx = i
        for i, block in enumerate(text_content):
            if i == last_text_idx and isinstance(block, dict):
                block = dict(block)
                block.setdefault("cacheable", True)
            user_content_blocks.append(block)
    elif isinstance(text_content, str) and text_content.strip():
        user_content_blocks.append({"type": "text", "text": text_content, "cacheable": True})
    # The prompt tail varies per asset (Phase A summary is interpolated) but
    # is identical across all turns within an asset's loop. Mark it cacheable
    # so the cache window extends through it — without this marker, the tail
    # pays full input cost on every turn.
    user_content_blocks.append({"type": "text", "text": user_prompt_tail, "cacheable": True})
    messages.append({"role": "user", "content": user_content_blocks})

    # Hand off to the provider. Its tool loop drives until the model stops
    # emitting tool_use blocks (i.e. calls done() or the provider's internal
    # iteration cap is hit).
    provider_kwargs = dict(extra_provider_kwargs or {})
    provider_kwargs.pop("response_format", None)
    if media_inputs and "media_inputs" not in provider_kwargs:
        provider_kwargs["media_inputs"] = media_inputs

    response_iter = await provider.generate(
        messages=messages,
        model_name=model_name,
        tools=[submit_tool, done_tool],
        tool_executor=tool_executor,
        thinking_enabled=False,  # Phase B: thinking off (per-turn cost)
        stream=True,  # avoid Anthropic SDK nonstreaming-timeout check on long loops
        tool_choice={"type": "any"},  # the model MUST call submit or done — no free text
        max_tool_iterations=max_tool_iterations,
        **{
            k: v for k, v in provider_kwargs.items()
            if k not in (
                "thinking_config", "model_name", "api_keys", "tools",
                "tool_executor", "thinking_enabled", "stream", "tool_choice",
                "max_tool_iterations",
            )
        },
    )
    response = await _drain_stream(response_iter)
    if response is None:
        # No data streamed back — let the caller convert to a FAILED annotation.
        return {
            "accumulator": accumulator,
            "items_received": items_received,
            "items_dropped": items_dropped,
            "done_called": False,
            "done_rationale": "stream returned no events",
            "turn_count": 0,
            "_thinking_trace": None,
            "_model_used": model_name,
            "_usage": None,
        }

    tool_executions = getattr(response, "tool_executions", None) or []
    return {
        "accumulator": accumulator,
        "items_received": items_received,
        "items_dropped": items_dropped,
        "done_called": done_state["done"],
        "done_rationale": done_state["rationale"],
        "turn_count": len(tool_executions),
        "_usage": _capture_token_usage(response),
        "_thinking_trace": getattr(response, "thinking_trace", None),
        "_model_used": getattr(response, "model_used", model_name),
    }


def _merge_phase_a_b(
    phase_a_data: Optional[Dict[str, Any]],
    phase_b_accumulator: Dict[str, list],
) -> Dict[str, Any]:
    """Merge Phase A's scalar dict + Phase B's per-field list accumulators
    into one dict matching the original schema's value shape.

    Hierarchical schemas have a ``document`` wrapper; flat schemas don't.
    The merge mirrors whichever shape Phase A produced.
    """
    if not isinstance(phase_a_data, dict):
        phase_a_data = {}
    if "document" in phase_a_data and isinstance(phase_a_data["document"], dict):
        merged = {"document": dict(phase_a_data["document"])}
        for field_name, items in phase_b_accumulator.items():
            merged["document"][field_name] = items
    else:
        merged = dict(phase_a_data)
        for field_name, items in phase_b_accumulator.items():
            merged[field_name] = items
    return merged


# ────────────────────────────────────────────────────────────────────────────


async def process_single_asset_schema(
    asset: Asset,
    schema_info: Dict[str, Any],
    run: AnnotationRun,
    run_config: Dict[str, Any],
    provider,
    storage_provider_instance,
    session: Session,
    semaphore: Optional[asyncio.Semaphore] = None
) -> Dict[str, Any]:
    """
    Process a single asset with a single schema.

    Args:
        asset: The asset to process
        schema_info: Schema information dict containing schema, structure, etc.
        run: The annotation run
        run_config: Run configuration
        provider: The LanguageModelProvider instance (rate-limited)
        storage_provider_instance: Storage provider instance
        session: Database session
        semaphore: Optional semaphore for concurrency control

    Returns:
        Dict with processing results including success status, annotations, and errors.
        Per-field justifications, when enabled, are inlined into each annotation's value JSONB.
    """
    schema = schema_info["schema"]
    schema_structure = schema_info["schema_structure"]
    OutputModelClass = schema_info["output_model_class"]
    final_schema_instructions = schema_info["final_instructions"]

    result = {
        "success": False,
        "asset_id": asset.id,
        "schema_id": schema.id,
        "annotations": [],
        "error": None
    }
    
    try:
        logger.debug(f"Task: Processing Asset {asset.id} with Schema {schema.id} for Run {run.id}")
        
        # Auto-detect if image processing should be enabled
        run_config_enhanced = run_config.copy()
        process_pdfs_as_images = run_config.get("process_pdfs_as_images", False)
        
        # Determine image asset kinds based on process_pdfs_as_images flag
        image_asset_kinds = _get_image_asset_kinds(process_pdfs_as_images)
        has_per_image_schema = "per_image" in schema_structure.get("per_modality_fields", {})
        target_is_image = asset.kind in image_asset_kinds
        
        # Auto-enable image processing if not explicitly set
        if "include_images" not in run_config_enhanced:
            if has_per_image_schema or target_is_image:
                run_config_enhanced["include_images"] = True
                logger.info(
                    f"Auto-enabled image processing for Asset {asset.id}: "
                    f"asset_is_image={target_is_image}, schema_has_per_image={has_per_image_schema}"
                )
        
        # Assemble multimodal context for this asset (no semaphore needed - this is just local processing)
        text_content_for_provider, provider_specific_config = await assemble_multimodal_context(
            asset, run_config_enhanced, session, storage_provider_instance
        )
        
        # For standalone image assets, simplify schema to remove per_image field
        # This eliminates ambiguity - the LLM should only use document field for standalone images
        # PDF_PAGE assets are ALWAYS treated as standalone images (even if they have text)
        image_asset_kinds = _get_image_asset_kinds(process_pdfs_as_images=True)
        is_standalone_image = (
            asset.kind == AssetKind.PDF_PAGE or  # PDF_PAGE always treated as standalone image
            (asset.kind in {AssetKind.IMAGE, AssetKind.IMAGE_REGION} and 
             (not asset.text_content or not asset.text_content.strip()))  # IMAGE/IMAGE_REGION only if no text
        )
        
        logger.info(
            f"Asset {asset.id} standalone image check: kind={asset.kind}, "
            f"in_image_kinds={asset.kind in image_asset_kinds}, "
            f"text_content={'present' if asset.text_content else 'missing'}, "
            f"is_standalone_image={is_standalone_image}, "
            f"has_per_modality_fields={bool(schema_structure.get('per_modality_fields'))}"
        )
        
        schema_to_use = OutputModelClass.model_json_schema()
        # Create a local copy of schema_structure that we can modify for standalone images
        schema_structure_to_use = schema_structure.copy()
        
        # For standalone images, keep the full schema (document + per_image) so the LLM can return both
        # We'll merge them in demultiplex_results instead of simplifying the schema
        if is_standalone_image and schema_structure.get("per_modality_fields"):
            logger.info(
                f"Asset {asset.id} is standalone image with per_modality_fields. "
                f"Keeping full schema (document + per_image) - will merge results into single annotation."
            )
        
        full_provider_config_for_classify = {**run_config, **provider_specific_config}
        # Pass thinking_config from run_config to provider_specific_config if not already there.
        if "thinking_config" in run_config and "thinking_config" not in provider_specific_config:
            provider_specific_config["thinking_config"] = run_config["thinking_config"]

        logger.debug(f"Task: Calling provider for Asset {asset.id}, Schema {schema.id}, Run {run.id}. Text length: {len(text_content_for_provider)}, Media items: {len(provider_specific_config.get('media_inputs',[]))}")

        # Call the provider for structured classification
        # Get the model name from run config (frontend sends as ai_model and ai_provider)
        model_name = run_config.get("model") or run_config.get("ai_model") or run_config.get("model_name")
        thinking_enabled = run_config.get("thinking_config", {}).get("include_thoughts", False)

        logger.info(f"Task: Using model '{model_name}' for Asset {asset.id}, Schema {schema.id}, Run {run.id}. Run config keys: {list(run_config.keys())}")

        # ── Track 2: route between single-shot and two-phase iterative ──
        list_fields = schema_info.get("list_fields") or []
        phase_a_output_model_class = schema_info.get("phase_a_output_model_class")
        provider_model_info = provider.get_model_info(model_name) if hasattr(provider, "get_model_info") else None
        provider_supports_tools = bool(getattr(provider_model_info, "supports_tools", False))
        context_length = getattr(provider_model_info, "context_length", None)
        doc_tokens = _estimate_tokens(text_content_for_provider)
        extraction_strategy = _pick_extraction_strategy(
            run_config=run_config,
            list_fields=list_fields,
            doc_tokens=doc_tokens,
            context_length=context_length,
            provider_supports_tools=provider_supports_tools,
        )
        # Two-phase requires the Phase A model to have been pre-built.
        if extraction_strategy == "two-phase" and phase_a_output_model_class is None:
            extraction_strategy = "single-shot"
        logger.info(
            f"Task: Asset {asset.id} Schema {schema.id} extraction_strategy={extraction_strategy} "
            f"(list_fields={len(list_fields)} doc_tokens≈{doc_tokens} ctx={context_length})"
        )

        # Acquire semaphore ONLY for the actual API call to limit concurrent external requests.
        # Critical optimization: We hold the semaphore ONLY during the API call, not during
        # pre-processing (context assembly) or post-processing (result parsing, DB operations).
        # This allows many tasks to prep/process simultaneously while rate-limiting actual API calls.
        if semaphore:
            await semaphore.acquire()

        try:
            if extraction_strategy == "two-phase":
                # ── Phase A: bounded scalar pass with thinking ON ────────────
                phase_a_schema_to_use = phase_a_output_model_class.model_json_schema()
                _messages_a: List[Dict[str, Any]] = []
                if final_schema_instructions:
                    # Cacheable system block: cross-asset benefit when many
                    # assets in a batch share the same schema. Doc breakpoint
                    # (below) extends the cache through the doc.
                    _messages_a.append({
                        "role": "system",
                        "content": [{"type": "text", "text": final_schema_instructions, "cacheable": True}],
                    })
                # Mark the doc cacheable. Phase A is a single call, so the
                # benefit is only realised on retries OR when Phase B's first
                # turn lands a hit on the same doc prefix (it doesn't today
                # because tool surface differs — but flagging is cheap and
                # future-proofs against single-shot retries on the same doc).
                _messages_a.append({
                    "role": "user",
                    "content": _wrap_user_content_with_cache_marker(text_content_for_provider),
                })
                logger.info(f"Task: Asset {asset.id} Phase A start ({len(list_fields)} list fields deferred)")
                phase_a_iter = await provider.generate(
                    messages=_messages_a,
                    model_name=model_name,
                    response_format=phase_a_schema_to_use,
                    thinking_enabled=thinking_enabled,  # Phase A: thinking honors run config
                    stream=True,
                    **{k: v for k, v in full_provider_config_for_classify.items()
                       if k not in ["thinking_config", "model_name", "api_keys", "stream"]},
                )
                phase_a_response = await _drain_stream(phase_a_iter)
                if phase_a_response is None:
                    raise Exception("Phase A produced no response")
                # Streaming with response_format produces a forced tool_use
                # rather than text. The tool call's arguments JSON IS the
                # structured output — surface it as ``content`` so the existing
                # JSON-parse path works identically to non-streaming.
                if not getattr(phase_a_response, "content", None):
                    for tc in (getattr(phase_a_response, "tool_calls", None) or []):
                        fn = tc.get("function") or {}
                        if fn.get("name") == "extract":
                            phase_a_response.content = fn.get("arguments") or "{}"
                            break
                # Parse Phase A response
                try:
                    phase_a_data = (
                        json.loads(phase_a_response.content)
                        if phase_a_response.content else {}
                    )
                except json.JSONDecodeError as e:
                    logger.error(
                        f"Task: Phase A invalid JSON for Asset {asset.id}, Schema {schema.id}: {e}"
                    )
                    raise Exception(f"Phase A returned invalid JSON: {e}")

                # ── Phase B: open-ended tool loop with cached doc prefix ─────
                logger.info(f"Task: Asset {asset.id} Phase B start (tool loop)")
                # Caller can raise the cap via run_config for dense docs.
                # Bounded [1, 100] inside the provider; default 40 here.
                phase_b_max_iters = run_config.get("max_tool_iterations", 40)
                phase_b_result = await _run_phase_b_loop(
                    asset=asset,
                    provider=provider,
                    model_name=model_name,
                    system_instructions=final_schema_instructions or "",
                    text_content=text_content_for_provider,
                    media_inputs=provider_specific_config.get("media_inputs", []) or [],
                    list_fields=list_fields,
                    phase_a_data=phase_a_data,
                    max_tool_iterations=phase_b_max_iters,
                    extra_provider_kwargs={
                        k: v for k, v in full_provider_config_for_classify.items()
                        if k not in [
                            "thinking_config", "model_name", "api_keys",
                            "tools", "tool_executor", "thinking_enabled",
                            "media_inputs", "max_tool_iterations",
                        ]
                    },
                )
                logger.info(
                    f"Task: Asset {asset.id} Phase B done — turns={phase_b_result['turn_count']} "
                    f"received={phase_b_result['items_received']} dropped_dupes={phase_b_result['items_dropped']} "
                    f"done_called={phase_b_result['done_called']} rationale={phase_b_result['done_rationale'][:140]!r}"
                )

                # Merge phase results into a single envelope so downstream
                # demultiplex sees the same shape as a single-shot call.
                merged_data = _merge_phase_a_b(phase_a_data, phase_b_result["accumulator"])
                # Synthesize a provider_response stand-in for the rest of the
                # function. Combine thinking traces if both phases produced them.
                phase_a_thinking = phase_a_response.thinking_trace
                phase_b_thinking = phase_b_result.get("_thinking_trace")
                combined_thinking = "\n\n".join(t for t in (phase_a_thinking, phase_b_thinking) if t) or None

                # Sum usage across Phase A + Phase B so the parent annotation
                # carries one combined cost ledger. cache_read on Phase B's
                # 2nd+ turns is the only signal that prompt caching is paying
                # off; it MUST land on the annotation for cost auditing.
                phase_a_usage = _capture_token_usage(phase_a_response) or {}
                phase_b_usage = phase_b_result.get("_usage") or {}
                combined_usage: Dict[str, int] = {}
                for src in (phase_a_usage, phase_b_usage):
                    for k in ("input_tokens", "output_tokens",
                              "cache_creation_input_tokens",
                              "cache_read_input_tokens"):
                        v = src.get(k) or 0
                        combined_usage[k] = combined_usage.get(k, 0) + v

                class _MergedResponse:
                    pass
                provider_response = _MergedResponse()
                provider_response.content = json.dumps(merged_data)
                provider_response.model_used = phase_a_response.model_used
                provider_response.thinking_trace = combined_thinking
                provider_response.usage = combined_usage if combined_usage else None
            else:
                # ── Single-shot path ──────────────────────────────────────────
                # Mark system + doc cacheable so retries within the 5-min
                # ephemeral window — and concurrent runs on the same doc with
                # the same model — pay ~10% input cost instead of full freight.
                # For huge docs (200k+ tokens) this is the difference between
                # $3 and $0.30 per retry.
                _messages = []
                if final_schema_instructions:
                    # Cacheable system block: cross-asset cache benefit when
                    # many assets in a batch run share the same schema.
                    _messages.append({
                        "role": "system",
                        "content": [{"type": "text", "text": final_schema_instructions, "cacheable": True}],
                    })
                _messages.append({
                    "role": "user",
                    "content": _wrap_user_content_with_cache_marker(text_content_for_provider),
                })
                provider_response = await provider.generate(
                    messages=_messages,
                    model_name=model_name,
                    response_format=schema_to_use,
                    thinking_enabled=thinking_enabled,
                    **{k: v for k, v in full_provider_config_for_classify.items()
                       if k not in ['thinking_config', 'model_name', 'api_keys']}
                )
        finally:
            # Release semaphore immediately after API call completes
            if semaphore:
                semaphore.release()
        
        # Convert to envelope format for compatibility (after semaphore is released)
        try:
            parsed_data = json.loads(provider_response.content) if provider_response.content else {}
            
            # Check if we got empty content but a successful response
            if not provider_response.content or provider_response.content.strip() == "":
                logger.warning(f"Provider returned empty content for Asset {asset.id}, Schema {schema.id}, Run {run.id}")
                logger.warning(f"Model used: {provider_response.model_used}")
                logger.warning(f"This often happens with complex schemas. The model may need a simpler schema or different prompting.")
            
            # NEW: Normalize response format - handle schema envelope format
            # Anthropic sometimes returns {"$schema": {...}, "$content": "...", "$existing_data": {}}
            # instead of the expected structured data format
            if isinstance(parsed_data, dict):
                if "$schema" in parsed_data and "$content" in parsed_data:
                    logger.warning(
                        f"Received schema envelope format for Asset {asset.id}, Schema {schema.id}, Run {run.id}. "
                        f"Attempting to extract actual data from $content."
                    )
                    content_data = parsed_data.get("$content")
                    
                    # Try to parse $content as JSON if it's a string
                    if isinstance(content_data, str):
                        try:
                            content_data = json.loads(content_data)
                        except json.JSONDecodeError:
                            # $content is plain text, not JSON - this is unusual
                            logger.warning(
                                f"$content is plain text, not JSON. This may indicate a parsing issue. "
                                f"Content preview: {content_data[:200]}"
                            )
                            # Keep as string for now, demultiplex will handle it
                    
                    # If content_data is now a dict and looks like structured data, use it
                    if isinstance(content_data, dict):
                        # Check if it has expected keys (document, per_image, etc.)
                        if any(key in content_data for key in ["document", "per_image", "per_audio", "per_video"]):
                            logger.info(f"Successfully extracted structured data from $content")
                            parsed_data = content_data
                        else:
                            # content_data doesn't have expected structure - log for investigation
                            logger.warning(
                                f"$content does not contain expected structure. Keys: {list(content_data.keys())[:10]}. "
                                f"Will attempt to use as-is."
                            )
                            parsed_data = content_data
                    else:
                        # content_data is not a dict - this is problematic
                        logger.error(
                            f"$content is not a dict after parsing. Type: {type(content_data)}. "
                            f"Cannot normalize response format."
                        )
                        # Keep original parsed_data, demultiplex will handle the error
                
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse provider response JSON for Asset {asset.id}, Schema {schema.id}, Run {run.id}: {e}")
            logger.error(f"Raw response content length: {len(provider_response.content) if provider_response.content else 0} chars")
            logger.error(f"Raw response preview: {safe_log_content(provider_response.content[:1000] if provider_response.content else '')}")
            raise Exception(f"Invalid JSON response from provider: {str(e)}")
        
        provider_response_envelope = {
            "data": parsed_data,
            "_model_name": provider_response.model_used,
            "_thinking_trace": provider_response.thinking_trace
        }
        
        # DEBUG: Log provider response details (safely, without binary data)
        logger.debug(f"DEBUG: Provider response for Asset {asset.id}, Schema {schema.id}, Run {run.id}")
        logger.debug(f"DEBUG: Raw provider response content length: {len(provider_response.content) if provider_response.content else 0} chars")
        logger.debug(f"DEBUG: Parsed envelope data preview: {safe_log_content(provider_response_envelope.get('data'))}")
        logger.debug(f"DEBUG: Schema structure keys: {list(schema_structure_to_use.keys())}")
        
        # Demultiplex results to create annotations
        # Use schema_structure_to_use (which may be simplified for standalone images)
        created_annotations_for_asset = await demultiplex_results(
            result=provider_response_envelope.get("data", provider_response_envelope),
            schema_structure=schema_structure_to_use,
            parent_asset=asset,
            schema=schema,
            run=run,
            db=session
        )
        
        result["annotations"] = created_annotations_for_asset
        
        # Inline thinking trace into the parent annotation's value JSONB.
        thinking_trace_content = provider_response_envelope.get("_thinking_trace")
        include_thoughts = run_config.get("thinking_config", {}).get("include_thoughts", False)
        # Always-on cache observability: stamp token usage onto the parent
        # doc annotation regardless of include_thoughts. Without this, the
        # only way to verify prompt caching is firing is to trawl worker
        # logs — and after a 5-min log rotation the evidence is gone.
        token_usage = _capture_token_usage(provider_response)
        parent_doc_annotation = next(
            (ann for ann in created_annotations_for_asset if ann.asset_id == asset.id),
            None,
        )

        if parent_doc_annotation:
            value = dict(parent_doc_annotation.value or {})
            if include_thoughts and thinking_trace_content:
                value["_thinking_trace"] = {
                    "reasoning": thinking_trace_content,
                    "model_name": provider_response_envelope.get("_model_name", run_config.get("model_name", "unknown")),
                    "trace_type": "provider_summary",
                }
            if token_usage and any(token_usage.values()):
                in_tok = token_usage.get("input_tokens") or 0
                cache_create = token_usage.get("cache_creation_input_tokens") or 0
                cache_read = token_usage.get("cache_read_input_tokens") or 0
                cached_pct = (
                    int(round(100 * cache_read / max(1, in_tok + cache_create + cache_read)))
                    if (in_tok + cache_create + cache_read) else 0
                )
                value["_token_usage"] = {
                    **token_usage,
                    "cached_pct": cached_pct,
                    "model_name": provider_response_envelope.get(
                        "_model_name", run_config.get("model_name", "unknown")
                    ),
                }
                logger.info(
                    f"Asset {asset.id} Schema {schema.id}: usage stamped "
                    f"input={in_tok} cache_create={cache_create} cache_read={cache_read} "
                    f"({cached_pct}% cached) output={token_usage.get('output_tokens') or 0}"
                )
            if value != (parent_doc_annotation.value or {}):
                parent_doc_annotation.value = value

        result["success"] = True
        logger.debug(f"Task: Successfully processed Asset {asset.id} with Schema {schema.id} for Run {run.id}. Created {len(created_annotations_for_asset)} annotations.")
        
    except Exception as e_classify:
        error_msg = f"Asset {asset.id}/Schema {schema.id} classification error: {str(e_classify)}"
        logger.error(f"Task: Error classifying Asset {asset.id} with Schema {schema.id} for Run {run.id}: {e_classify}", exc_info=True)
        
        # Create a FAILED annotation for tracking
        failed_ann = Annotation(
            asset_id=asset.id,
            schema_id=schema.id,
            run_id=run.id,
            value={"error": str(e_classify), "details": traceback.format_exc()},
            status=ResultStatus.FAILED,
            infospace_id=run.infospace_id,
            user_id=run.user_id
        )
        result["annotations"] = [failed_ann]
        result["error"] = error_msg
        result["success"] = False
    
    return result

async def process_assets_parallel(
    assets_map: Dict[int, Asset],
    validated_schemas: List[Dict[str, Any]],
    run: AnnotationRun,
    run_config: Dict[str, Any],
    provider,
    storage_provider_instance,
    session: Session,
    concurrency_limit: int = DEFAULT_ANNOTATION_CONCURRENCY
) -> Tuple[List[Annotation], List[str], bool]:
    """
    Process assets and schemas in parallel with controlled concurrency.

    Commits each annotation to the DB as soon as its LLM call returns (via
    ``asyncio.as_completed``) and emits a ``progress`` presence event per
    result. This lets the frontend see rows fill in live instead of waiting
    for the chunk boundary.

    Returns:
        Tuple of (all_annotations, errors, already_committed).
        ``already_committed=True`` signals the caller to skip the chunk-boundary
        ``session.add_all`` + progress_current bump (we've done both inline).
        Justifications, when enabled, travel inline inside each annotation's
        ``value`` JSONB — no separate persistence path.
    """
    import asyncio
    from app.core.stream import stream_key, StreamWriter

    # Create semaphore for concurrency control
    semaphore = asyncio.Semaphore(concurrency_limit)

    # Create tasks for all asset-schema combinations
    tasks = []
    for schema_info in validated_schemas:
        for asset_id, asset in assets_map.items():
            task = process_single_asset_schema(
                asset=asset,
                schema_info=schema_info,
                run=run,
                run_config=run_config,
                provider=provider,
                storage_provider_instance=storage_provider_instance,
                session=session,
                semaphore=semaphore
            )
            tasks.append(task)

    total_tasks = len(tasks)
    logger.info(f"Task: Starting parallel processing of {total_tasks} asset-schema combinations with concurrency limit {concurrency_limit}")

    from app.core.stream import FamilyStreamWriter
    parent_key = (
        stream_key(run.infospace_id, "annotation_run", run.parent_run_id)
        if run.parent_run_id else None
    )
    writer = FamilyStreamWriter(
        stream_key(run.infospace_id, "annotation_run", run.id),
        parent_key,
    )
    base_progress = run.progress_current or 0

    # Collect results
    all_created_annotations = []
    errors_run_level = []

    completed = 0
    # as_completed yields tasks as they finish so we can emit per-row progress
    # AND commit each annotation to the DB immediately. This lets the frontend
    # poll/stream see rows fill in live instead of waiting for the chunk commit
    # boundary (which could be 30-60s away for small-but-slow runs). We still
    # return the accumulated lists so the caller's post-loop bookkeeping
    # (errors, run.progress_current update) stays consistent.
    for coro in asyncio.as_completed(tasks):
        try:
            result = await coro
        except Exception as ex:
            logger.error(f"Task: Parallel processing task failed with exception: {ex}", exc_info=True)
            errors_run_level.append(f"Task failed: {ex}")
            completed += 1
            try:
                writer.send("progress", {
                    "run_id": run.id,
                    "progress_current": base_progress + completed,
                    "progress_total": run.progress_total,
                    "status": run.status.value if hasattr(run.status, "value") else str(run.status),
                })
            except Exception:
                logger.debug("progress emit failed", exc_info=True)
            continue

        if not isinstance(result, dict):
            logger.error(f"Task: Unexpected result type from parallel task: {type(result)}")
            errors_run_level.append("Task returned unexpected result type")
            completed += 1
            continue

        result_annotations = result.get("annotations") or []

        # Commit THIS result's annotations immediately so the frontend can
        # fetch them via polling / render live. Errors here are logged but
        # don't abort the rest of the parallel batch.
        try:
            if result_annotations:
                session.add_all(result_annotations)
                # Bump progress_current in DB so polling clients see the count
                # tick without needing the SSE stream.
                run.progress_current = (run.progress_current or 0) + len(result_annotations)
                run.updated_at = datetime.now(timezone.utc)
                session.add(run)
                session.commit()
                session.refresh(run)
        except Exception as commit_exc:
            logger.error(f"Task: Incremental commit failed for run {run.id}: {commit_exc}", exc_info=True)
            try:
                session.rollback()
            except Exception:
                pass
            errors_run_level.append(f"Commit failed: {commit_exc}")

        # Keep accumulators for the caller (they'll skip the re-commit since
        # these rows already have PKs, but still used for error summary).
        all_created_annotations.extend(result_annotations)

        if result.get("error"):
            errors_run_level.append(result["error"])

        completed += 1
        try:
            writer.send("progress", {
                "run_id": run.id,
                "progress_current": run.progress_current or (base_progress + completed),
                "progress_total": run.progress_total,
                "status": run.status.value if hasattr(run.status, "value") else str(run.status),
            })
        except Exception:
            logger.debug("progress emit failed", exc_info=True)

    logger.info(f"Task: Parallel processing completed. Created {len(all_created_annotations)} annotations, {len(errors_run_level)} errors")

    return all_created_annotations, errors_run_level, True

async def _process_annotation_run_async(
    run_id: int, cursor: int = 0, chunk_size: int = 50
) -> Optional[int]:
    """
    Process an annotation run. When cursor=0, does full setup; when cursor>0, uses
    stored asset IDs. Returns next_cursor for self-chaining, or None if done.
    """
    import time
    start_time = time.time()
    logger.info(f"Task: Processing annotation run {run_id} with multi-modal engine.")
    
    with Session(engine) as session:
        try:
            run = session.get(AnnotationRun, run_id)
            if not run:
                logger.error(f"Task: AnnotationRun {run_id} not found")
                return
            
            if run.status == RunStatus.COMPLETED or run.status == RunStatus.COMPLETED_WITH_ERRORS:
                logger.warning(f"Task: AnnotationRun {run_id} is already completed. Skipping.")
                return None
            if cursor == 0 and run.status == RunStatus.RUNNING:
                logger.warning(f"Task: AnnotationRun {run_id} is already processing. Skipping.")
                return None

            if cursor == 0:
                    run.started_at = datetime.now(timezone.utc)
            run.updated_at = datetime.now(timezone.utc)
            session.add(run)
            session.commit()
            session.refresh(run)

            # Chained call: load asset IDs from previous run's stored list
            if cursor > 0:
                stored_ids = (run.configuration or {}).get(CHAINED_RUN_CURSOR_KEY)
                if not stored_ids:
                    logger.error(f"Task: Run {run_id} cursor={cursor} but no {CHAINED_RUN_CURSOR_KEY} in config")
                    run.status = RunStatus.FAILED
                    run.error_message = "Chained run missing asset ID list"
                    session.add(run)
                    session.commit()
                    return None
                target_asset_ids_to_process = stored_ids[cursor : cursor + chunk_size]
                if not target_asset_ids_to_process:
                    run.status = RunStatus.COMPLETED
                    run.completed_at = datetime.now(timezone.utc)
                    session.add(run)
                    session.commit()
                    return None
                # Clear stored list on last chunk to free memory
                if cursor + len(target_asset_ids_to_process) >= len(stored_ids):
                    cfg = dict(run.configuration or {})
                    cfg.pop(CHAINED_RUN_CURSOR_KEY, None)
                    run.configuration = cfg
                    session.add(run)
                    session.commit()
                # Skip asset resolution - we have our chunk
                # target_asset_ids_to_process already set above
            # Create providers (needed for both cursor=0 and cursor>0)
            provider_start_time = time.time()
            app_settings = settings
            try:
                run_config_for_provider = run.configuration or {}
                model_name_for_resolve = run_config_for_provider.get("model") or run_config_for_provider.get("ai_model") or run_config_for_provider.get("model_name")
                runtime_api_keys = run_config_for_provider.get("api_keys") or {}
                type_key = run_config_for_provider.get("provider") or run_config_for_provider.get("ai_provider")
                # BYOK: extract the key for the selected provider, if supplied in the run configuration.
                runtime_key = runtime_api_keys.get(type_key) if type_key else None
                provider = resolve(
                    "language", type_key, model_name_for_resolve,
                    infospace_id=run.infospace_id,
                    context="annotation",
                    runtime_key=runtime_key,
                    session=session,
                )
                storage_provider_instance = await get_cached_provider("storage", app_settings)
                provider_creation_time = time.time() - provider_start_time
                logger.info(f"Task: Provider creation/retrieval took {provider_creation_time:.3f}s for Run {run.id}")
            except Exception as e_provider:
                logger.error(f"Task: Failed to create providers for Run {run.id}: {e_provider}", exc_info=True)
                run.status = RunStatus.FAILED
                run.error_message = f"Provider initialization failed: {str(e_provider)}"
                session.add(run)
                session.commit()
                return None

            run_config = run.configuration or {}
            if cursor == 0:
                target_asset_ids_to_process = []

                # Check for source_bundle_id first (for continuous runs watching a bundle)
                if run.source_bundle_id:
                    bundle_id = run.source_bundle_id
                    bundle = session.get(Bundle, bundle_id)
                    if bundle and bundle.infospace_id == run.infospace_id:
                        # Query asset IDs (do NOT use bundle.assets - loads all into memory)
                        path_filter = run_config.get("path_filter")  # e.g. "politics/eu" (matches logical_path from virtual folder tree)
                        stmt = select(Asset.id).where(text("bundle_ids @> ARRAY[:bid]::int[]").bindparams(bid=bundle_id))
                        if path_filter:
                            like_val = f"{path_filter}%" if not path_filter.endswith("%") else path_filter
                            # Use logical_path (matches virtual folder tree); fallback to blob_path for assets without logical_path
                            stmt = stmt.where(or_(
                                Asset.logical_path.like(like_val),
                                (Asset.logical_path.is_(None)) & (Asset.blob_path.isnot(None)) & (Asset.blob_path.like(like_val)),
                            ))
                        all_bundle_asset_ids = list(session.exec(stmt).all())
                        logger.info(f"Task: Continuous run {run.id} watching bundle {bundle_id} with {len(all_bundle_asset_ids)} total assets" + (f" (path_filter={path_filter})" if path_filter else ""))
                        
                        # ═══ DELTA TRACKING: Only process assets that don't have annotations for all required schemas ═══
                        # Get the schema IDs this run should process
                        run_schema_ids = [schema.id for schema in run.target_schemas] if run.target_schemas else []
                        
                        if run_schema_ids and all_bundle_asset_ids:
                            # Find assets that already have annotations for ALL schemas (from ANY run in this infospace)
                            # This prevents reprocessing assets that have already been annotated
                            # Note: select and func are already imported at module level
                            
                            # Query: For each asset, count how many schemas it has annotations for
                            # Check annotations from ANY run in the same infospace (not just this run)
                            # This ensures we don't reprocess assets that were annotated by previous continuous runs
                            assets_with_complete_annotations = session.exec(
                                select(Annotation.asset_id, func.count(func.distinct(Annotation.schema_id)).label('schema_count'))
                                .where(
                                    Annotation.asset_id.in_(all_bundle_asset_ids),
                                    Annotation.schema_id.in_(run_schema_ids),
                                    Annotation.infospace_id == run.infospace_id,  # Same infospace
                                    Annotation.status != ResultStatus.FAILED  # Don't count failed annotations
                                )
                                .group_by(Annotation.asset_id)
                                .having(func.count(func.distinct(Annotation.schema_id)) == len(run_schema_ids))
                            ).all()
                            
                            complete_asset_ids = {row.asset_id for row in assets_with_complete_annotations}
                            unannotated_asset_ids = [aid for aid in all_bundle_asset_ids if aid not in complete_asset_ids]
                            
                            logger.info(f"Task: Continuous run {run.id} - {len(complete_asset_ids)} assets already fully annotated (across all runs), {len(unannotated_asset_ids)} assets need processing")
                            target_asset_ids_to_process.extend(unannotated_asset_ids)
                        else:
                            # No schemas configured or no assets - process all (fallback behavior)
                            logger.warning(f"Task: Continuous run {run.id} - No schemas configured or no assets, processing all assets")
                            target_asset_ids_to_process.extend(all_bundle_asset_ids)
                    else:
                        logger.error(f"Task: Source Bundle {bundle_id} for Run {run.id} not found or not in infospace.")
                        run.status = RunStatus.FAILED
                        run.error_message = f"Source Bundle {bundle_id} not found/invalid."
                        session.add(run)
                        session.commit()
                elif run_config.get("target_asset_ids"):
                    target_asset_ids_to_process.extend(run_config["target_asset_ids"])
                elif run_config.get("target_bundle_id"):
                    bundle_id = run_config["target_bundle_id"]
                    bundle = session.get(Bundle, bundle_id)
                    if bundle and bundle.infospace_id == run.infospace_id:
                        # Query asset IDs (do NOT use bundle.assets - loads all into memory)
                        path_filter = run_config.get("path_filter")
                        stmt = select(Asset.id).where(text("bundle_ids @> ARRAY[:bid]::int[]").bindparams(bid=bundle_id))
                        if path_filter:
                            like_val = f"{path_filter}%" if not path_filter.endswith("%") else path_filter
                            stmt = stmt.where(or_(
                                Asset.logical_path.like(like_val),
                                (Asset.logical_path.is_(None)) & (Asset.blob_path.isnot(None)) & (Asset.blob_path.like(like_val)),
                            ))
                        target_asset_ids_to_process.extend(session.exec(stmt).all())
                    else:
                        logger.error(f"Task: Target Bundle {bundle_id} for Run {run.id} not found or not in infospace.")
                        run.status = RunStatus.FAILED
                        run.error_message = f"Target Bundle {bundle_id} not found/invalid."
                        session.add(run)
                        session.commit()
            
            if not target_asset_ids_to_process:
                # For continuous runs, it's normal to have no assets to process if all are already annotated
                if run.source_bundle_id:
                    logger.info(f"Task: Continuous run {run.id} - No unannotated assets to process (all assets already annotated). Completing run.")
                    run.status = RunStatus.COMPLETED
                    run.completed_at = datetime.now(timezone.utc)
                    run.updated_at = datetime.now(timezone.utc)
                    session.add(run)
                    session.commit()
                    logger.info(f"Task: Continuous run {run.id} completed successfully with 0 annotations (all assets already annotated).")
                    return None
                else:
                    logger.error(f"Task: No target assets for Run {run.id}.")
                    run.status = RunStatus.FAILED
                    run.error_message = "No target assets found."
                    session.add(run)
                    session.commit()
                    return None

            # CSV Row Expansion: Check for CSV parent assets and optionally expand to their CSV_ROW children
            csv_row_processing = run_config.get("csv_row_processing", True)  # Default to True for CSV row processing
            
            logger.info(f"Task: CSV row processing setting for Run {run.id}: {csv_row_processing}")
            logger.info(f"Task: Initial target asset IDs for Run {run.id}: {target_asset_ids_to_process}")
            
            if csv_row_processing:
                expanded_asset_ids = []
                csv_parents_processed = []
                # Bulk fetch all target assets
                target_assets = session.exec(
                    select(Asset)
                    .where(Asset.id.in_(target_asset_ids_to_process))
                    .where(Asset.infospace_id == run.infospace_id)
                ).all()
                assets_by_id = {a.id: a for a in target_assets}
                csv_parent_ids = [a.id for a in target_assets if a.kind == AssetKind.CSV]
                # Batch fetch CSV_ROW children for all CSV parents
                csv_children_by_parent: Dict[int, List[Asset]] = {}
                if csv_parent_ids:
                    csv_row_children = session.exec(
                        select(Asset)
                        .where(Asset.parent_asset_id.in_(csv_parent_ids))
                        .where(Asset.kind == AssetKind.CSV_ROW)
                        .where(Asset.infospace_id == run.infospace_id)
                        .order_by(Asset.parent_asset_id, Asset.part_index)
                    ).all()
                    for child in csv_row_children:
                        if child.parent_asset_id:
                            csv_children_by_parent.setdefault(child.parent_asset_id, []).append(child)
                for asset_id in target_asset_ids_to_process:
                    asset = assets_by_id.get(asset_id)
                    logger.debug(f"Task: Checking asset {asset_id} - Kind: {asset.kind if asset else 'NOT_FOUND'}, Infospace: {asset.infospace_id if asset else 'N/A'}")
                    if asset and asset.kind == AssetKind.CSV:
                        csv_row_children = csv_children_by_parent.get(asset.id, [])
                        logger.info(f"Task: Found {len(csv_row_children)} CSV_ROW children for CSV asset {asset.id}")
                        if csv_row_children:
                            logger.info(f"Task: Expanding CSV asset {asset.id} ({asset.title}) to {len(csv_row_children)} CSV row children for Run {run.id}")
                            expanded_asset_ids.extend([child.id for child in csv_row_children])
                            csv_parents_processed.append(asset.id)
                        else:
                            logger.warning(f"Task: CSV asset {asset.id} has no CSV_ROW children. Including parent asset for Run {run.id}")
                            expanded_asset_ids.append(asset_id)
                    else:
                        expanded_asset_ids.append(asset_id)
                
                # Update the target asset list with expanded CSV rows
                target_asset_ids_to_process = expanded_asset_ids
                
                logger.info(f"Task: Final target asset IDs after CSV expansion for Run {run.id}: {target_asset_ids_to_process}")
                
                if csv_parents_processed:
                    logger.info(f"Task: Run {run.id} expanded {len(csv_parents_processed)} CSV parent assets to {len(target_asset_ids_to_process)} total assets including CSV rows")
            else:
                logger.info(f"Task: CSV row processing disabled for Run {run.id}. Processing CSV parent assets directly.")

            # PDF Page Expansion: Check for PDF parent assets and optionally expand to their PDF_PAGE children
            pdf_page_processing = run_config.get("pdf_page_processing", True)  # Default to True for PDF page processing
            
            logger.info(f"Task: PDF page processing setting for Run {run.id}: {pdf_page_processing}")
            logger.info(f"Task: Target asset IDs before PDF expansion for Run {run.id}: {target_asset_ids_to_process}")
            
            if pdf_page_processing:
                expanded_asset_ids = []
                pdf_parents_processed = []
                # Bulk fetch all target assets
                target_assets = session.exec(
                    select(Asset)
                    .where(Asset.id.in_(target_asset_ids_to_process))
                    .where(Asset.infospace_id == run.infospace_id)
                ).all()
                assets_by_id = {a.id: a for a in target_assets}
                registry = get_content_type_registry()
                pdf_parent_ids = [
                    a.id for a in target_assets
                    if registry.by_kind(a.kind) and registry.by_kind(a.kind).is_container
                    and registry.by_kind(a.kind).child_kind == AssetKind.PDF_PAGE
                ]
                # Batch fetch PDF_PAGE children for all PDF parents
                pdf_children_by_parent: Dict[int, List[Asset]] = {}
                if pdf_parent_ids:
                    pdf_page_children = session.exec(
                        select(Asset)
                        .where(Asset.parent_asset_id.in_(pdf_parent_ids))
                        .where(Asset.kind == AssetKind.PDF_PAGE)
                        .where(Asset.infospace_id == run.infospace_id)
                        .order_by(Asset.parent_asset_id, Asset.part_index)
                    ).all()
                    for child in pdf_page_children:
                        if child.parent_asset_id:
                            pdf_children_by_parent.setdefault(child.parent_asset_id, []).append(child)
                for asset_id in target_asset_ids_to_process:
                    asset = assets_by_id.get(asset_id)
                    logger.debug(f"Task: Checking asset {asset_id} for PDF expansion - Kind: {asset.kind if asset else 'NOT_FOUND'}, Infospace: {asset.infospace_id if asset else 'N/A'}")
                    if asset and registry.by_kind(asset.kind) and registry.by_kind(asset.kind).is_container and registry.by_kind(asset.kind).child_kind == AssetKind.PDF_PAGE:
                        pdf_page_children = pdf_children_by_parent.get(asset.id, [])
                        logger.info(f"Task: Found {len(pdf_page_children)} PDF_PAGE children for PDF asset {asset.id}")
                        if pdf_page_children:
                            logger.info(f"Task: Expanding PDF asset {asset.id} ({asset.title}) to {len(pdf_page_children)} PDF page children for Run {run.id}")
                            expanded_asset_ids.extend([child.id for child in pdf_page_children])
                            pdf_parents_processed.append(asset.id)
                        else:
                            logger.warning(f"Task: PDF asset {asset.id} has no PDF_PAGE children. Including parent asset for Run {run.id}")
                            expanded_asset_ids.append(asset_id)
                    else:
                        expanded_asset_ids.append(asset_id)
                
                # Update the target asset list with expanded PDF pages
                target_asset_ids_to_process = expanded_asset_ids
                
                logger.info(f"Task: Final target asset IDs after PDF expansion for Run {run.id}: {target_asset_ids_to_process}")
                
                if pdf_parents_processed:
                    logger.info(f"Task: Run {run.id} expanded {len(pdf_parents_processed)} PDF parent assets to {len(target_asset_ids_to_process)} total assets including PDF pages")
            else:
                logger.info(f"Task: PDF page processing disabled for Run {run.id}. Processing PDF parent assets directly.")

            # Self-chain: store full list and process first chunk if run is large
            if len(target_asset_ids_to_process) > chunk_size:
                # Set progress_total to full asset count (before slicing)
                run.progress_total = len(target_asset_ids_to_process)
                run.progress_current = 0
                cfg = dict(run.configuration or {})
                cfg[CHAINED_RUN_CURSOR_KEY] = target_asset_ids_to_process
                run.configuration = cfg
                session.add(run)
                session.commit()
                session.refresh(run)
                target_asset_ids_to_process = target_asset_ids_to_process[:chunk_size]
                logger.info(f"Task: Run {run.id} has {run.progress_total} assets, processing first {chunk_size} (self-chain will continue)")
            else:
                # Small run — set progress for single invocation
                run.progress_total = len(target_asset_ids_to_process)
                run.progress_current = 0
                session.add(run)
                session.commit()
                session.refresh(run)

            schemas_to_apply = run.target_schemas
            if not schemas_to_apply:
                logger.error(f"Task: No schemas for Run {run.id}.")
                run.status = RunStatus.FAILED
                run.error_message = "No schemas specified."
                session.add(run)
                session.commit()
                return
            
            logger.info(f"Task: Run {run.id} processing {len(target_asset_ids_to_process)} assets with {len(schemas_to_apply)} schemas.")
            
            errors_run_level = [] # Errors pertaining to the whole run or asset/schema processing that isn't an annotation status
            all_created_annotations: List[Annotation] = []

            # OPTIMIZATION 2: Pre-validate all schemas before processing assets
            validated_schemas = []
            for schema in schemas_to_apply:
                if not validate_hierarchical_schema(schema.output_contract):
                    logger.error(f"Task: Schema {schema.id} ({schema.name}) for Run {run.id} has invalid hierarchical structure. Skipping this schema.")
                    errors_run_level.append(f"Schema {schema.id} ({schema.name}) invalid structure.")
                    continue
                
                # Simplify schema for local/self-hosted models
                optimized_contract = simplify_schema_for_model(schema.output_contract, model_name_for_resolve, type_key)
                
                # Validate that optimized_contract is a valid JSON schema
                if not isinstance(optimized_contract, dict):
                    logger.error(f"Task: Schema {schema.id} ({schema.name}) for Run {run.id} has invalid output_contract type: {type(optimized_contract)}. Expected dict.")
                    errors_run_level.append(f"Schema {schema.id} ({schema.name}) has invalid output_contract format.")
                    continue
                
                # Ensure optimized_contract has the expected JSON schema structure
                if optimized_contract.get("type") != "object" or "properties" not in optimized_contract:
                    logger.error(f"Task: Schema {schema.id} ({schema.name}) for Run {run.id} output_contract is not a valid object schema with properties. Got: {list(optimized_contract.keys())[:10]}")
                    errors_run_level.append(f"Schema {schema.id} ({schema.name}) output_contract missing 'type: object' or 'properties'.")
                    continue
                
                schema_structure = detect_schema_structure(optimized_contract)
                
                # Validate that schema_structure found document_fields
                if not schema_structure.get("document_fields"):
                    logger.error(f"Task: Schema {schema.id} ({schema.name}) for Run {run.id} - detect_schema_structure did not find document_fields. Schema structure: {list(schema_structure.keys())}")
                    errors_run_level.append(f"Schema {schema.id} ({schema.name}) - no document_fields detected in schema structure.")
                    continue
                
                # Per-field opt-in is read inline from the output_contract by the
                # builder; the run-level master switch lets a caller suppress
                # all justifications regardless of schema config.
                justifications_enabled = run_config.get("justifications_enabled", True)

                try:
                    OutputModelClass = create_pydantic_model_from_json_schema(
                        model_name=f"DynamicOutput_{schema.name.replace(' ', '_')}_{schema.id}",
                        json_schema=optimized_contract,
                        justifications_enabled=justifications_enabled,
                    )
                except Exception as e_model_create:
                    logger.error(f"Task: Failed to create Pydantic model for Schema {schema.id} ({schema.name}) in Run {run.id}: {e_model_create}", exc_info=True)
                    errors_run_level.append(f"Schema {schema.id} Pydantic model creation failed: {e_model_create}")
                    continue

                if not OutputModelClass.model_fields:
                    logger.error(f"Task: Schema {schema.id} ({schema.name}) for Run {run.id} resulted in an empty model with no fields. This schema cannot be used for structured output. Skipping this schema.")
                    errors_run_level.append(f"Schema {schema.id} ('{schema.name}') is invalid or empty and was skipped.")
                    continue

                # Initialize final instructions with schema-level instructions.
                # Justification prompts come exclusively from researcher-written
                # places: schema.instructions and per-field justification_prompt
                # in the output_contract. No hidden prompt injection.
                final_schema_instructions = schema.instructions or ""

                # --- System instruction for per-modality asset UUID mapping ---
                # Check if the schema structure implies per-modality outputs that would need mapping
                if schema_structure.get("per_modality_fields"):
                    system_mapping_prompt = (
                        "\\n\\n--- System Data Mapping Instructions ---\\n"
                        "For each item you generate that corresponds to a specific media input (e.g., an item in a 'per_image' list, 'per_audio' list, etc.), "
                        "you MUST include a field named 'system_asset_source_uuid'. "
                        "The value of this 'system_asset_source_uuid' field MUST be the exact UUID string that was provided to you in the input prompt for that specific media item. "
                        "This is critical for correctly associating your analysis with the source media."
                    )
                    if final_schema_instructions:
                        final_schema_instructions += system_mapping_prompt
                    else:
                        final_schema_instructions = system_mapping_prompt[4:] # Remove leading \n\n if no prior instructions

                # Track 2: pre-compute the scalar subset + list field descriptors
                # for two-phase iterative extraction. The scalar Pydantic model
                # is built once per schema (here) and re-used per asset.
                # If the schema has no array<object> fields, list_fields is
                # empty and the auto-router will pick single-shot.
                scalar_subset_contract, list_fields_for_phase_b = split_schema_for_extraction(
                    optimized_contract
                )
                phase_a_output_model_class = None
                if list_fields_for_phase_b:
                    try:
                        phase_a_output_model_class = create_pydantic_model_from_json_schema(
                            model_name=f"PhaseA_{schema.name.replace(' ', '_')}_{schema.id}",
                            json_schema=scalar_subset_contract,
                            justifications_enabled=justifications_enabled,
                        )
                    except Exception as e_phase_a:
                        logger.warning(
                            f"Task: Failed to build Phase A model for Schema {schema.id}; "
                            f"two-phase extraction unavailable for this schema: {e_phase_a}"
                        )
                        list_fields_for_phase_b = []
                        scalar_subset_contract = None

                # Store the validated schema with all computed values
                validated_schemas.append({
                    "schema": schema,
                    "schema_structure": schema_structure,
                    "output_model_class": OutputModelClass,
                    "final_instructions": final_schema_instructions,
                    "scalar_subset_contract": scalar_subset_contract,
                    "list_fields": list_fields_for_phase_b,
                    "phase_a_output_model_class": phase_a_output_model_class,
                })

            if not validated_schemas:
                logger.error(f"Task: No valid schemas for Run {run.id} after validation.")
                run.status = RunStatus.FAILED
                run.error_message = "No valid schemas after validation."
                session.add(run)
                session.commit()
                return

            # OPTIMIZATION 3: Pre-fetch all assets in a single bulk query
            assets_list = session.exec(
                select(Asset)
                .where(Asset.id.in_(target_asset_ids_to_process))
                .where(Asset.infospace_id == run.infospace_id)
            ).all()
            assets_map = {a.id: a for a in assets_list}
            for asset_id in target_asset_ids_to_process:
                if asset_id not in assets_map:
                    logger.warning(f"Task: Asset {asset_id} for Run {run.id} not found/invalid. Skipping.")
                    errors_run_level.append(f"Asset {asset_id} not found/invalid.")

            if not assets_map:
                logger.error(f"Task: No valid assets for Run {run.id}.")
                run.status = RunStatus.FAILED
                run.error_message = "No valid assets found."
                session.add(run)
                session.commit()
                return

            # OPTIMIZATION 4: Process schemas and assets with parallel or sequential processing
            # Chunked dispatch: process in chunks with per-chunk commits for large runs
            chunk_size = getattr(settings, 'ANNOTATION_CHUNK_SIZE', 50)
            asset_ids_ordered = [aid for aid in target_asset_ids_to_process if aid in assets_map]
            chunks = [asset_ids_ordered[i:i + chunk_size] for i in range(0, len(asset_ids_ordered), chunk_size)]
            processing_config = get_annotation_processing_config()
            concurrency_limit = run_config.get("annotation_concurrency", processing_config['default_concurrency'])
            concurrency_limit = min(concurrency_limit, processing_config['max_concurrency'])
            concurrency_limit = max(concurrency_limit, 1)

            # All execution flows through ``process_assets_parallel``. The
            # asyncio.Semaphore inside it gives us serial behaviour for
            # ``concurrency_limit=1`` with the bonus of per-result commits
            # and live progress emits — strictly better than the old
            # sequential body that committed only at chunk boundaries.
            for chunk_idx, chunk_asset_ids in enumerate(chunks):
                chunk_assets_map = {aid: assets_map[aid] for aid in chunk_asset_ids if aid in assets_map}
                if not chunk_assets_map:
                    continue
                chunk_annotations, chunk_errors, already_committed = await process_assets_parallel(
                    assets_map=chunk_assets_map,
                    validated_schemas=validated_schemas,
                    run=run,
                    run_config=run_config,
                    provider=provider,
                    storage_provider_instance=storage_provider_instance,
                    session=session,
                    concurrency_limit=concurrency_limit
                )
                errors_run_level.extend(chunk_errors)
                if not already_committed:
                    if chunk_annotations:
                        session.add_all(chunk_annotations)
                    # Update progress before commit so it's visible atomically with the new annotations
                    run.progress_current = (run.progress_current or 0) + len(chunk_asset_ids)
                    run.updated_at = datetime.now(timezone.utc)
                    session.add(run)
                    session.commit()
                else:
                    # parallel path already committed rows + bumped progress_current
                    # per result. Just make sure we're seeing the latest values.
                    session.refresh(run)
                logger.info(f"Task: Run {run.id} chunk {chunk_idx + 1}/{len(chunks)} committed {len(chunk_annotations)} annotations (progress: {run.progress_current}/{run.progress_total})")
                # Presence: push progress to watching browsers (and to the
                # parent's stream when this is an extension run).
                from app.core.stream import stream_key, FamilyStreamWriter
                _parent_key = (
                    stream_key(run.infospace_id, "annotation_run", run.parent_run_id)
                    if run.parent_run_id else None
                )
                FamilyStreamWriter(
                    stream_key(run.infospace_id, "annotation_run", run.id),
                    _parent_key,
                ).send("progress", {
                    "run_id": run.id,
                    "parent_run_id": run.parent_run_id,
                    "progress_current": run.progress_current,
                    "progress_total": run.progress_total,
                    "status": run.status.value if hasattr(run.status, "value") else str(run.status),
                })
                all_created_annotations.extend(chunk_annotations)

            # Chunk loop above handles add/commit per chunk; all_created_* accumulated

            session.refresh(run)

            # Self-chain: if more chunks remain, return next cursor instead of marking complete
            stored_ids = (run.configuration or {}).get(CHAINED_RUN_CURSOR_KEY)
            if stored_ids:
                next_cursor = cursor + len(target_asset_ids_to_process)
                if next_cursor < len(stored_ids):
                    logger.info(f"Task: Run {run.id} chunk done, {len(stored_ids) - next_cursor} assets remain. Returning next_cursor={next_cursor}")
                    return next_cursor

            # Determine final run status
            has_failed_annotations = any(ann.status == ResultStatus.FAILED for ann in all_created_annotations)
            if errors_run_level or has_failed_annotations:
                run.status = RunStatus.COMPLETED_WITH_ERRORS
                error_messages = errors_run_level
                if has_failed_annotations:
                    error_messages.append(f"{sum(1 for ann in all_created_annotations if ann.status == ResultStatus.FAILED)} annotations failed.")
                run.error_message = "\n".join(error_messages)
            else:
                run.status = RunStatus.COMPLETED
            
            run.completed_at = datetime.now(timezone.utc)
            run.updated_at = datetime.now(timezone.utc)
            session.add(run)
            session.commit()
            # Presence: push terminal status to watching browsers
            from app.core.stream import stream_key, StreamWriter
            event_name = "completed" if run.status == RunStatus.COMPLETED else "completed_with_errors"
            payload = {
                "run_id": run.id,
                "parent_run_id": run.parent_run_id,
                "status": run.status.value if hasattr(run.status, "value") else str(run.status),
                "progress_current": run.progress_current,
                "progress_total": run.progress_total,
            }
            _sw = StreamWriter(stream_key(run.infospace_id, "annotation_run", run.id))
            _sw.send(event_name, payload)
            _sw.expire(3600)
            # If this is an extension, mirror the event into the parent's stream
            # so panels bound to the parent can refetch without polling.
            if run.parent_run_id:
                _psw = StreamWriter(stream_key(run.infospace_id, "annotation_run", run.parent_run_id))
                _psw.send(event_name, payload)

            # Compute aggregates for this run and update monitor aggregates if applicable
            try:
                from app.api.modules.annotation.services.annotation_service import AnnotationService
                annotation_service = AnnotationService(session=session)
                annotation_service.compute_run_aggregates(run_id=run.id)
                # Check for monitor_id attribute safely (may not exist on all AnnotationRun instances)
                monitor_id = getattr(run, 'monitor_id', None)
                if monitor_id:
                    annotation_service.update_monitor_aggregates(monitor_id=monitor_id, run_id=run.id)
            except Exception as agg_exc:
                logger.error(f"Task: Aggregation failed for run {run.id}: {agg_exc}", exc_info=True)
            
            total_time = time.time() - start_time
            logger.info(f"Task: AnnotationRun {run.id} finished. Status: {run.status}. Total Annotations: {len(all_created_annotations)}. Total time: {total_time:.2f}s")
            
        except Exception as e_task_critical:
            logger.exception(f"Task: Critical unexpected error processing AnnotationRun {run_id}: {e_task_critical}")
            # Use a fresh session for the FAILED update; the outer session may be in failed state (e.g. InFailedSqlTransaction)
            try:
                with Session(engine) as fail_session:
                    run_to_fail = fail_session.get(AnnotationRun, run_id)
                    if run_to_fail:
                        run_to_fail.status = RunStatus.FAILED
                        run_to_fail.error_message = f"Critical task error: {str(e_task_critical)}"
                        run_to_fail.updated_at = datetime.now(timezone.utc)
                        run_to_fail.completed_at = datetime.now(timezone.utc)
                        fail_session.add(run_to_fail)
                        fail_session.commit()
                        # Presence: push failure to watching browsers
                        from app.core.stream import stream_key, StreamWriter
                        fail_payload = {
                            "run_id": run_id,
                            "parent_run_id": run_to_fail.parent_run_id,
                            "status": "failed",
                            "error": str(e_task_critical),
                        }
                        _sw = StreamWriter(stream_key(run_to_fail.infospace_id, "annotation_run", run_id))
                        _sw.send("failed", fail_payload)
                        _sw.expire(3600)
                        if run_to_fail.parent_run_id:
                            _psw = StreamWriter(stream_key(run_to_fail.infospace_id, "annotation_run", run_to_fail.parent_run_id))
                            _psw.send("failed", fail_payload)
            except Exception as db_exc:
                logger.error(f"Task: Could not update run {run_id} to FAILED status: {db_exc}", exc_info=True)

async def _retry_failed_annotations_async(run_id: int) -> None:
    """
    Async function to retry failed annotations using actual LLM re-processing.
    Reuses the existing LLM processing pipeline.
    """
    logger.info(f"Task: Starting async retry of failed annotations for run {run_id}")
    
    with Session(engine) as session:
        try:
            run = session.get(AnnotationRun, run_id)
            if not run:
                logger.error(f"Task: AnnotationRun {run_id} not found for retry.")
                return
            
            if run.status not in [RunStatus.COMPLETED_WITH_ERRORS, RunStatus.FAILED]:
                logger.warning(f"Task: AnnotationRun {run_id} is not in a state that allows retry (Status: {run.status}). Skipping retry.")
                return

            original_status = run.status
            run.status = RunStatus.RUNNING # Mark run as processing again
            run.updated_at = datetime.now(timezone.utc)
            run.error_message = None # Clear previous error message
            session.add(run)
            session.commit()
            session.refresh(run)

            # Find annotations from this run that are marked as FAILED
            failed_annotations_to_retry = session.exec(
                select(Annotation).where(
                    Annotation.run_id == run.id,
                    Annotation.status == ResultStatus.FAILED
                )
            ).all()

            if not failed_annotations_to_retry:
                logger.info(f"Task: No failed annotations found to retry for Run {run_id}.")
                run.status = original_status # Revert to original status if no failed annotations
                if original_status == RunStatus.COMPLETED_WITH_ERRORS:
                     run.status = RunStatus.COMPLETED
                session.add(run)
                session.commit()
                return

            logger.info(f"Task: Found {len(failed_annotations_to_retry)} failed annotations to retry for Run {run_id}.")
            
            # Set up providers (reuse from original processing)
            app_settings = settings
            try:
                run_config_for_provider = run.configuration or {}
                model_name_for_resolve = run_config_for_provider.get("model") or run_config_for_provider.get("ai_model") or run_config_for_provider.get("model_name")
                runtime_api_keys = run_config_for_provider.get("api_keys") or {}
                type_key = run_config_for_provider.get("provider") or run_config_for_provider.get("ai_provider")
                runtime_key = runtime_api_keys.get(type_key) if type_key else None
                provider = resolve(
                    "language", type_key, model_name_for_resolve,
                    infospace_id=run.infospace_id,
                    context="annotation",
                    runtime_key=runtime_key,
                    session=session,
                )
                storage_provider_instance = await get_cached_provider("storage", app_settings)
                logger.info(f"Task: Providers initialized for retry of Run {run.id}")
            except Exception as e_provider:
                logger.error(f"Task: Failed to create providers for retry of Run {run.id}: {e_provider}", exc_info=True)
                run.status = RunStatus.FAILED
                run.error_message = f"Provider initialization failed during retry: {str(e_provider)}"
                session.add(run)
                session.commit()
                return

            run_config = run.configuration or {}
            errors = []
            retried_count = 0
            successful_retries = 0

            # Group failed annotations by asset-schema pairs to avoid redundant processing
            retry_pairs = {}
            for annotation in failed_annotations_to_retry:
                key = (annotation.asset_id, annotation.schema_id)
                if key not in retry_pairs:
                    retry_pairs[key] = []
                retry_pairs[key].append(annotation)

            logger.info(f"Task: Retrying {len(retry_pairs)} unique asset-schema pairs for Run {run_id}.")

            for (asset_id, schema_id), annotations_for_pair in retry_pairs.items():
                try:
                    asset = session.get(Asset, asset_id)
                    schema = session.get(AnnotationSchema, schema_id)

                    if not asset or not schema or asset.infospace_id != run.infospace_id or schema.infospace_id != run.infospace_id:
                        logger.warning(f"Task: Skipping retry for Asset {asset_id}, Schema {schema_id} due to invalid context.")
                        errors.append(f"Invalid context for Asset {asset_id}, Schema {schema_id}")
                        continue

                    # Validate and prepare schema (reuse from original processing)
                    if not validate_hierarchical_schema(schema.output_contract):
                        logger.error(f"Task: Schema {schema.id} has invalid hierarchical structure during retry. Skipping.")
                        errors.append(f"Schema {schema.id} invalid structure during retry.")
                        continue
                    
                    schema_structure = detect_schema_structure(schema.output_contract)
                    
                    # Create output model (reuse from original processing)
                    try:
                        OutputModelClass = create_pydantic_model_from_json_schema(
                            model_name=f"RetryOutput_{schema.name.replace(' ', '_')}_{schema.id}",
                            json_schema=schema.output_contract,
                            justifications_enabled=run_config.get("justifications_enabled", True),
                        )
                    except Exception as e_model:
                        logger.error(f"Task: Failed to create Pydantic model for Schema {schema.id} during retry: {e_model}", exc_info=True)
                        errors.append(f"Schema {schema.id} model creation failed during retry: {e_model}")
                        continue

                    if not OutputModelClass.model_fields:
                        logger.error(f"Task: Schema {schema.id} resulted in empty model during retry. Skipping.")
                        errors.append(f"Schema {schema.id} is invalid or empty during retry.")
                        continue

                    # Prepare final instructions (reuse from original processing)
                    final_schema_instructions = schema.instructions or ""

                    # Add system mapping prompt for per-modality fields if needed
                    if schema_structure.get("per_modality_fields"):
                        system_mapping_prompt = (
                            "\\n\\n--- System Data Mapping Instructions ---\\n"
                            "For each item you generate that corresponds to a specific media input (e.g., an item in a 'per_image' list, 'per_audio' list, etc.), "
                            "you MUST include a field named 'system_asset_source_uuid'. "
                            "The value of this 'system_asset_source_uuid' field MUST be the exact UUID string that was provided to you in the input prompt for that specific media item. "
                            "This is critical for correctly associating your analysis with the source media."
                        )
                        if final_schema_instructions:
                            final_schema_instructions += system_mapping_prompt
                        else:
                            final_schema_instructions = system_mapping_prompt[4:] # Remove leading \n\n if no prior instructions

                    # Mirror the validate_assets_schemas Track-2 build so retries
                    # get the two-phase strategy when the original run did. Without
                    # this, retries silently fall back to single-shot and re-truncate
                    # on the same schemas that needed Phase B in the first place.
                    scalar_subset_contract, list_fields_for_phase_b = split_schema_for_extraction(
                        schema.output_contract
                    )
                    phase_a_output_model_class = None
                    if list_fields_for_phase_b:
                        try:
                            phase_a_output_model_class = create_pydantic_model_from_json_schema(
                                model_name=f"RetryPhaseA_{schema.name.replace(' ', '_')}_{schema.id}",
                                json_schema=scalar_subset_contract,
                                justifications_enabled=run_config.get("justifications_enabled", True),
                            )
                        except Exception as e_phase_a:
                            logger.warning(
                                f"Task: Failed to build Phase A model for retry of Schema {schema.id}; "
                                f"two-phase extraction unavailable for this retry: {e_phase_a}"
                            )
                            list_fields_for_phase_b = []
                            scalar_subset_contract = None

                    schema_info = {
                        "schema": schema,
                        "schema_structure": schema_structure,
                        "output_model_class": OutputModelClass,
                        "final_instructions": final_schema_instructions,
                        "scalar_subset_contract": scalar_subset_contract,
                        "list_fields": list_fields_for_phase_b,
                        "phase_a_output_model_class": phase_a_output_model_class,
                    }

                    # Call the actual LLM processing function
                    logger.info(f"Task: Processing retry for Asset {asset.id}, Schema {schema.id} in Run {run.id}")
                    result = await process_single_asset_schema(
                        asset=asset,
                        schema_info=schema_info,
                        run=run,
                        run_config=run_config,
                        provider=provider,
                        storage_provider_instance=storage_provider_instance,
                        session=session
                    )

                    if result.get("success"):
                        # Delete old failed annotations and add new ones
                        for old_annotation in annotations_for_pair:
                            session.delete(old_annotation)

                        # Add new annotations from the result
                        new_annotations = result.get("annotations", [])
                        if new_annotations:
                            session.add_all(new_annotations)
                            successful_retries += len(new_annotations)
                            logger.info(f"Task: Successfully retried Asset {asset.id}, Schema {schema.id} - created {len(new_annotations)} new annotations")
                    else:
                        # LLM processing failed, keep original annotations as FAILED
                        error_msg = result.get("error", "Unknown error during retry")
                        logger.error(f"Task: Retry failed for Asset {asset.id}, Schema {schema.id}: {error_msg}")
                        errors.append(f"Asset {asset.id}/Schema {schema.id}: {error_msg}")

                    retried_count += len(annotations_for_pair)

                except Exception as e:
                    logger.error(f"Task: Error retrying Asset {asset_id}, Schema {schema_id}: {e}", exc_info=True)
                    errors.append(f"Asset {asset_id}/Schema {schema_id}: {str(e)}")
                    retried_count += len(annotations_for_pair)
            
            # Finalize run status based on retry outcomes
            if errors:
                run.status = RunStatus.COMPLETED_WITH_ERRORS
                run.error_message = "\n".join(errors)
            else:
                # Check if any annotations are still FAILED for this run
                still_failed_count = session.exec(
                    select(func.count(Annotation.id)).where(Annotation.run_id == run.id, Annotation.status == ResultStatus.FAILED)
                ).one_or_none() or 0
                
                if still_failed_count > 0:
                    run.status = RunStatus.COMPLETED_WITH_ERRORS
                    run.error_message = f"{still_failed_count} annotations remain in FAILED state after retry attempt."
                else:
                    run.status = RunStatus.COMPLETED
            
            run.completed_at = datetime.now(timezone.utc)
            run.updated_at = datetime.now(timezone.utc)
            session.add(run)
            session.commit()
            logger.info(f"Task: Retry for AnnotationRun {run_id} finished. Status: {run.status}. Annotations retried: {retried_count}, Successful: {successful_retries}.")

        except Exception as e:
            logger.exception(f"Task: Unexpected critical error during async retry for AnnotationRun {run_id}: {e}")
            run_to_fail_retry = session.get(AnnotationRun, run_id)
            if run_to_fail_retry:
                run_to_fail_retry.status = RunStatus.FAILED
                run_to_fail_retry.error_message = f"Critical task error during retry: {str(e)}"
                run_to_fail_retry.updated_at = datetime.now(timezone.utc)
                session.add(run_to_fail_retry)
                session.commit()


@task("retry_failed_annotations",
      check=lambda iid: (
          select(AnnotationRun.id)
          .where(
              AnnotationRun.infospace_id == iid,
              AnnotationRun.status.in_([RunStatus.COMPLETED_WITH_ERRORS, RunStatus.FAILED]),
          )
          .order_by(AnnotationRun.created_at)
      ),
      schedule=None,
      batch=1,
      queue="llm",
      timeout=7200,
      tags=frozenset({"annotation"}))
def retry_failed_annotations(ctx: TaskContext, run_ids: list[int]) -> None:
    """Retry failed annotations in runs using actual LLM re-processing."""
    for run_id in run_ids:
        try:
            run_async_in_celery(_retry_failed_annotations_async, run_id)
            ctx.stat("done")
        except Exception as e:
            logger.exception(f"Retry failed for run {run_id}: {e}")
            with ctx.session() as session:
                run = session.get(AnnotationRun, run_id)
                if run:
                    run.status = RunStatus.FAILED
                    run.error_message = f"Critical task execution error during retry: {str(e)}"
                    run.completed_at = datetime.now(timezone.utc)
                    run.updated_at = datetime.now(timezone.utc)
                    session.add(run)
                    session.commit()
            ctx.item_failed(run_id)
            ctx.stat("failed")