api/
  analysis/     -> analysis adapters for annotation results (RAG, graph, time series)
  handlers/     -> input adaptation (file, web, directory, archive, RSS, search, text)
                   RSSHandler also: preview_rss_feed, discover_rss_feeds_from_awesome_repo,
                   ingest_from_awesome_repo (static/class methods)
  mcp/          -> MCP server & functions
  processors/   -> content transformation only (PDF->pages, CSV->rows, Web->scraped content)
  providers/    -> external services (storage, LLM, search, embedding, geocoding)
  routes/       -> HTTP surface (FastAPI routers)
  services/     -> business logic orchestration:
      content_ingestion_service.py -> thin compatibility shim (ingest_content, compose_article, etc.)
      processing_service.py        -> Phase 1–3 pipeline, reprocess, CSV reprocessing
      search_service.py            -> text + semantic search over assets
      bundle_service.py            -> bundle CRUD
      asset_service.py             -> asset CRUD
  tasks/        -> Celery background jobs (batch_process_pending, batch_enrich, annotation)
  utils/        -> shared domain utilities:
      content_types.py      -> THE registry: what types exist, their properties, extensions, processors
      content_detection.py -> reclassification checks (flat if-checks, one function)
      facets.py             -> well-known source_metadata.facets keys + query helpers
      enrichers.py          -> enricher registry (language_detection, quality_score)
      entity_resolution.py  -> entity matching (alias + embedding similarity)
      tree_builder.py       -> tree node construction for tree API
  v1/ (legacy)  -> versioned API sub-routers (entities, locations, satellite, search)
