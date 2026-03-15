"""
Ollama Embedding Provider Implementation
"""
import logging
import re
import httpx
from typing import List, Dict, Any, Optional

from app.api.modules.foundation_service_providers.base import EmbeddingProvider

logger = logging.getLogger(__name__)

# Conservative chars-per-token ratio for truncation.
# Real tokenizers vary (3–5 chars/token depending on language/content).
# Using 3.2 errs on the safe side — better to truncate slightly early
# than to hit Ollama's context limit.
_CHARS_PER_TOKEN = 3.2


class OllamaEmbeddingProvider(EmbeddingProvider):
    """
    Ollama implementation of the EmbeddingProvider interface.
    Uses Ollama's /api/embed endpoint for generating embeddings.

    Model metadata (dimension, context length) is probed from Ollama's
    /api/show endpoint on first use and cached for the provider's lifetime.
    """

    def __init__(self, base_url: str = "http://host.docker.internal:11434"):
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient(timeout=600.0)  # CPU embedding is slow
        self._model_cache: Dict[str, Dict[str, Any]] = {}
        logger.info(f"Ollama embedding provider initialized with base_url: {self.base_url}")

    # ── Model probing ────────────────────────────────────────────────────────

    async def _probe_model(self, model_name: str) -> Dict[str, Any]:
        """Probe Ollama for model metadata via /api/show. Cached per model.

        Extracts dimension and context_length from the structured model_info
        section of the response (e.g. ``bert.context_length``,
        ``bert.embedding_length``). Falls back to a test embedding for
        dimension if the metadata is unavailable.

        Returns a dict with at least ``dimension`` and ``context_length`` keys.
        """
        if model_name in self._model_cache:
            return self._model_cache[model_name]

        info: Dict[str, Any] = {
            "name": model_name,
            "provider": "ollama",
            "dimension": 0,
            "context_length": 0,
            "description": "",
            "is_embedding": False,
        }

        # Try /api/show for structured metadata
        try:
            resp = await self.client.post(
                f"{self.base_url}/api/show",
                json={"model": model_name},
            )
            if resp.status_code == 200:
                show_data = resp.json() or {}
                model_info = show_data.get("model_info", {}) or {}

                # Architecture key prefix (e.g. "bert", "nomic-bert")
                arch = (model_info.get("general.architecture") or "").lower()

                # Context length: {arch}.context_length in model_info
                ctx = model_info.get(f"{arch}.context_length", 0) if arch else 0
                if not ctx:
                    # Fallback: parse num_ctx from parameters string
                    params_str = show_data.get("parameters", "")
                    m = re.search(r"num_ctx\s+(\d+)", params_str)
                    if m:
                        ctx = int(m.group(1))
                info["context_length"] = ctx

                # Embedding dimension: {arch}.embedding_length in model_info
                dim = model_info.get(f"{arch}.embedding_length", 0) if arch else 0
                info["dimension"] = dim

                # Check if this is an embedding model
                details = show_data.get("details", {}) or {}
                family = details.get("family", "").lower()
                fmt = details.get("format", "").lower()
                modelfile = show_data.get("modelfile", "").lower()
                info["is_embedding"] = (
                    "embed" in family
                    or "embed" in fmt
                    or "embedding" in modelfile
                    or details.get("is_embedding", False)
                )

                info["description"] = f"Ollama {model_name} ({dim}d, ctx={ctx})"

        except Exception as e:
            logger.debug(f"Could not probe {model_name} metadata: {e}")

        # If dimension not obtained from metadata, get it from a test embedding
        if not info["dimension"]:
            try:
                test = await self._embed_batch([" "], model_name)
                info["dimension"] = len(test[0])
            except Exception as e:
                logger.debug(f"Could not probe {model_name} dimension via test embed: {e}")

        self._model_cache[model_name] = info
        return info

    def _max_chars_for_model(self, model_name: str) -> Optional[int]:
        """Compute max character limit from cached context_length.

        Returns None if context length is unknown (no truncation applied).
        """
        cached = self._model_cache.get(model_name)
        if not cached or not cached.get("context_length"):
            return None
        return int(cached["context_length"] * _CHARS_PER_TOKEN)

    # ── Embedding ────────────────────────────────────────────────────────────

    async def embed_texts(self, texts: List[str], model_name: Optional[str] = None) -> List[List[float]]:
        """Generate embeddings for a list of texts.

        On first call for a model, probes Ollama for context length and caches
        it. Truncates inputs that exceed the context window. If the batch call
        still fails, retries each text individually.
        """
        if not texts:
            return []
        if not model_name:
            raise ValueError("model_name is required for Ollama embeddings")

        # Ensure model metadata is cached (context_length, dimension)
        await self._probe_model(model_name)

        max_chars = self._max_chars_for_model(model_name)
        if max_chars:
            prepared = []
            for t in texts:
                if len(t) > max_chars:
                    logger.debug(
                        f"Truncating text from {len(t)} to {max_chars} chars "
                        f"(ctx={self._model_cache[model_name]['context_length']} tokens)"
                    )
                    prepared.append(t[:max_chars])
                else:
                    prepared.append(t)
        else:
            prepared = texts

        try:
            return await self._embed_batch(prepared, model_name)
        except RuntimeError:
            # Batch failed — retry each text individually
            logger.warning(
                f"Batch embed failed for {model_name}, "
                f"retrying {len(prepared)} texts individually"
            )
            results = []
            for i, t in enumerate(prepared):
                try:
                    batch = await self._embed_batch([t], model_name)
                    results.append(batch[0])
                except RuntimeError as e:
                    logger.error(
                        f"Failed to embed text {i} ({len(t)} chars) "
                        f"for {model_name}: {e}"
                    )
                    raise
            return results

    async def _embed_batch(self, texts: List[str], model_name: str) -> List[List[float]]:
        """Send a batch of texts to Ollama's /api/embed endpoint."""
        try:
            payload = {
                "model": model_name,
                "input": texts,
                "truncate": True,
            }
            response = await self.client.post(
                f"{self.base_url}/api/embed", json=payload
            )
            response.raise_for_status()
            data = response.json()

            embeddings = data.get("embeddings", [])
            if not embeddings:
                logger.error(
                    f"No embeddings returned from Ollama for model {model_name}"
                )
                return []

            logger.debug(f"Generated {len(embeddings)} embeddings using {model_name}")
            return embeddings

        except httpx.HTTPStatusError as e:
            logger.error(
                f"Ollama embedding API error: "
                f"{e.response.status_code} - {e.response.text}"
            )
            raise RuntimeError(f"Ollama embedding failed: {e.response.text}")
        except Exception as e:
            logger.error(f"Ollama embedding error: {e}")
            raise RuntimeError(f"Ollama embedding failed: {str(e)}")

    async def embed_single(self, text: str, model_name: Optional[str] = None) -> List[float]:
        """Generate embedding for a single text."""
        embeddings = await self.embed_texts([text], model_name)
        if not embeddings:
            raise RuntimeError("Failed to generate embedding")
        return embeddings[0]

    # ── Discovery ────────────────────────────────────────────────────────────

    async def discover_models(self) -> List[Dict[str, Any]]:
        """Discover available embedding models from Ollama.

        Probes each model via /api/show for embedding capability and metadata.
        Models that aren't detected as embedding models via metadata are tested
        with a single embedding call as a fallback.
        """
        try:
            response = await self.client.get(f"{self.base_url}/api/tags")
            response.raise_for_status()
            all_models = response.json().get("models", [])
        except Exception as e:
            logger.error(f"Failed to discover Ollama models: {e}")
            return []

        logger.info(
            f"Checking {len(all_models)} Ollama models for embedding capability..."
        )
        embedding_models = []

        for model_data in all_models:
            name = model_data.get("name", "")
            info = await self._probe_model(name)

            if not info.get("is_embedding"):
                # Metadata didn't flag it — try a test embedding
                try:
                    test = await self._embed_batch([" "], name)
                    info["dimension"] = len(test[0])
                    info["is_embedding"] = True
                    info["description"] = (
                        f"Ollama {name} ({info['dimension']}d, "
                        f"ctx={info.get('context_length', '?')})"
                    )
                    self._model_cache[name] = info
                except Exception:
                    logger.debug(f"✗ {name} cannot generate embeddings")
                    continue

            if info.get("is_embedding") and info.get("dimension"):
                embedding_models.append({
                    "name": name,
                    "provider": "ollama",
                    "dimension": info["dimension"],
                    "description": info.get("description", ""),
                    "max_sequence_length": info.get("context_length") or None,
                })
                logger.info(
                    f"✓ Discovered: {name} "
                    f"({info['dimension']}d, ctx={info.get('context_length', '?')})"
                )

        logger.info(f"Discovered {len(embedding_models)} Ollama embedding models")
        return embedding_models

    def get_available_models(self) -> List[Dict[str, Any]]:
        """Get cached available models."""
        return [
            {
                "name": v["name"],
                "provider": "ollama",
                "dimension": v.get("dimension", 0),
                "description": v.get("description", ""),
                "max_sequence_length": v.get("context_length") or None,
            }
            for v in self._model_cache.values()
            if v.get("is_embedding")
        ]

    def get_model_dimension(self, model_name: str) -> int:
        """Get the embedding dimension for a model from cache.

        If not cached, runs a synchronous probe. This is a fallback for
        callers that can't use async — prefer ``_probe_model()`` in async code.
        """
        cached = self._model_cache.get(model_name)
        if cached and cached.get("dimension"):
            return cached["dimension"]

        import asyncio
        try:
            loop = asyncio.get_event_loop()
            info = loop.run_until_complete(self._probe_model(model_name))
            return info.get("dimension", 0)
        except Exception as e:
            logger.error(f"Failed to detect dimension for {model_name}: {e}")
            return 0
