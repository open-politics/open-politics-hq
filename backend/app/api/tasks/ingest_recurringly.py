import logging
import time
from typing import Dict, Any, Optional, List
import hashlib
import asyncio

from celery import shared_task
from sqlmodel import Session, select
import dateutil.parser
from datetime import datetime, timezone

from app.core.db import engine
from app.core.config import settings
from app.models import (
    Task as RecurringTask,
    TaskType,
    TaskStatus,
    Source,
    Asset,
    Bundle,
    AssetBundleLink,
)
from app.schemas import AssetCreate

from app.api.providers.factory import create_scraping_provider, create_search_provider
from app.api.providers.base import ScrapingProvider, SearchProvider

from app.api.tasks.utils import update_task_status, run_async_in_celery

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=1)
def process_recurring_ingest(self, recurring_task_id: int):
    """
    Processes a recurring ingestion task.
    This task can handle different kinds of sources, including:
    - 'url_list': A static list of URLs to scrape.
    - 'search': A dynamic search query whose results are scraped.
    Assets created are optionally added to a specified bundle.
    """
    logging.info(f"Starting recurring ingestion task for Task ID: {recurring_task_id}")
    start_time = time.time()
    
    processed_count = 0
    created_count = 0
    failed_count = 0
    skipped_count = 0
    final_status = "success"
    error_message = None

    with Session(engine) as session:
        try:
            # 1. Fetch the task and its configuration
            task = session.get(RecurringTask, recurring_task_id)
            if not task:
                raise ValueError(f"Task with ID {recurring_task_id} not found.")
            
            if task.status != TaskStatus.ACTIVE:
                logger.warning(f"Task {recurring_task_id} is not ACTIVE. Skipping.")
                return

            # 2. Fetch the target Source from the task configuration
            source_id = task.configuration.get("target_source_id")
            if not source_id:
                raise ValueError(f"Task configuration for {task.id} must include 'target_source_id'")

            source = session.get(Source, source_id)
            if not source:
                raise ValueError(f"Source with ID {source_id} not found for task {task.id}.")

            logger.info(f"Processing Source '{source.name}' (ID: {source.id}) of kind '{source.kind}' for Task {task.id}")
            source.status = "processing"
            session.add(source)
            session.commit()

            # 3. Get URLs to scrape based on the source's kind
            urls_to_scrape: List[str] = []
            search_details = {} # For metadata later

            if source.kind == "url_list":
                urls_to_scrape = source.details.get("urls", [])
                logger.info(f"Found {len(urls_to_scrape)} URLs in url_list source '{source.name}'")
            
            elif source.kind == "search":
                search_details = source.details.get("search_config", {})
                query = search_details.get("query")
                if not query:
                    raise ValueError(f"Search source {source.id} is missing 'query' in its search_config")
                
                provider_name = search_details.get("provider", "opol_searxng")
                max_results = search_details.get("max_results", 10)
                search_params = search_details.get("params", {})
                
                logger.info(f"Executing search for source {source.id}: query='{query}', provider='{provider_name}'")
                
                search_provider = create_search_provider(settings)
                search_results = run_async_in_celery(search_provider.search,
                    query,
                    0,  # skip
                    max_results
                )
                
                urls_to_scrape = [result['url'] for result in search_results if result.get('url')]
                logger.info(f"Search yielded {len(urls_to_scrape)} URLs to scrape.")

            else:
                raise ValueError(f"Unsupported source kind for ingestion task: '{source.kind}'")

            if not urls_to_scrape:
                logger.warning(f"No URLs to process for source {source.id}. Task will be marked as successful.")
                update_task_status(recurring_task_id, "success", "No new URLs to process.", session)
                source.status = "complete"
                session.commit()
                return

            # 4. Scrape URLs and create assets
            scraping_config = task.configuration.get("scraping_config", {})
            timeout = scraping_config.get("timeout", 30)
            retry_attempts = scraping_config.get("retry_attempts", 1)
            scraping_provider: ScrapingProvider = create_scraping_provider(settings)
            
            target_bundle_id = task.configuration.get("target_bundle_id")
            target_bundle = session.get(Bundle, target_bundle_id) if target_bundle_id else None
            if target_bundle_id and not target_bundle:
                logger.warning(f"Target bundle with ID {target_bundle_id} not found. Assets will not be added to a bundle.")

            for url in urls_to_scrape:
                processed_count += 1
                try:
                    # Check for duplicates against the source_identifier for this source
                    existing_asset = session.exec(
                        select(Asset.id).where(
                            Asset.source_id == source.id,
                            Asset.source_identifier == url
                        )
                    ).first()
                    if existing_asset:
                        skipped_count += 1
                        logger.debug(f"Skipping duplicate URL '{url}' for Source {source.id}")
                        continue

                    # Scrape URL
                    scraped_data = run_async_in_celery(
                        scraping_provider.scrape_url, url, timeout=timeout, retry_attempts=retry_attempts
                    )

                    if not scraped_data or not scraped_data.get('text_content'):
                        raise ValueError("Scraping yielded no text content.")

                    # Create Asset from scraped data
                    asset_create_dict = build_asset_from_scraped_data(
                        scraped_data=scraped_data,
                        source=source,
                        url=url,
                        task_id=task.id,
                        search_details=search_details if source.kind == "search" else None
                    )
                    asset = Asset.model_validate(AssetCreate(**asset_create_dict))
                    
                    session.add(asset)
                    session.flush()  # Flush to get the new asset's ID

                    # Link asset to bundle if specified
                    if target_bundle:
                        link = AssetBundleLink(asset_id=asset.id, bundle_id=target_bundle.id)
                        session.add(link)
                    
                    created_count += 1
                    logger.info(f"Successfully created asset {asset.id} and linked to bundle '{target_bundle.name if target_bundle else 'N/A'}' for URL: {url}")

                except Exception as e:
                    failed_count += 1
                    logger.error(f"Failed to process URL '{url}' for task {task.id}: {e}", exc_info=True)
            
            # Commit all new assets and links at the end of the loop
            if created_count > 0 and target_bundle:
                target_bundle.asset_count = (target_bundle.asset_count or 0) + created_count
                session.add(target_bundle)

            source.status = "complete"
            source.updated_at = datetime.now(timezone.utc)
            session.add(source)
            session.commit()
            
            if failed_count > 0:
                final_status = "error"
                error_message = f"Failed to process {failed_count} URLs."

        except Exception as e:
            session.rollback()
            logger.exception(f"Critical error during ingestion task {recurring_task_id}: {e}")
            final_status = "error"
            error_message = f"Critical Task Error: {str(e)}"
            try:
                self.retry(exc=e, countdown=60)
            except self.MaxRetriesExceededError:
                logging.error(f"Max retries exceeded for task {recurring_task_id}.")

        finally:
            final_msg = error_message or f"Processed: {processed_count}, Created: {created_count}, Skipped: {skipped_count}, Failed: {failed_count}."
            update_task_status(recurring_task_id, final_status, final_msg)
            end_time = time.time()
            logger.info(f"Ingestion task {recurring_task_id} finished in {end_time - start_time:.2f}s. Status: {final_status}.")

def build_asset_from_scraped_data(
    scraped_data: Dict[str, Any], 
    source: Source, 
    url: str, 
    task_id: int,
    search_details: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Helper function to construct the asset creation dictionary from scraped data."""
    
    # Clean text content
    final_text_content = (scraped_data.get('text_content') or '').replace('\\x00', '').strip()
    if not final_text_content:
        raise ValueError("Scraping yielded empty text content after cleaning.")

    # Parse timestamp
    final_event_timestamp: Optional[datetime] = None
    scraped_publication_date = scraped_data.get('publication_date')
    if scraped_publication_date:
        try:
            parsed_dt = dateutil.parser.parse(scraped_publication_date)
            final_event_timestamp = parsed_dt.replace(tzinfo=parsed_dt.tzinfo or timezone.utc)
        except (ValueError, OverflowError, TypeError):
            logger.warning(f"Could not parse scraped date '{scraped_publication_date}' for URL: {url}")

    # Build metadata
    source_metadata = {
        'source_kind': source.kind,
        'task_id': task_id,
        'scraped_at': datetime.now(timezone.utc).isoformat(),
        'original_url': url,
        'scraped_title': scraped_data.get('title'),
        'top_image': scraped_data.get('top_image'),
        'images': scraped_data.get('images', [])
    }
    
    if search_details:
        source_metadata.update({
            'search_query': search_details.get('query'),
            'search_provider': search_details.get('provider')
        })

    return {
        "title": scraped_data.get('title') or f"Asset from {url}",
        "kind": "web",
        "source_id": source.id,
        "text_content": final_text_content,
        "source_metadata": source_metadata,
        "event_timestamp": final_event_timestamp,
        "source_identifier": url,
        "infospace_id": source.infospace_id,
        "user_id": source.user_id,
    } 