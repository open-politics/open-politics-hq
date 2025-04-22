import logging
import time
import csv
import io
import fitz # PyMuPDF
import requests # For URL fetching
from typing import List, Dict, Any, Optional
import chardet

from app.core.celery_app import celery
from sqlmodel import Session, select, func

from app.core.db import engine
from app.models import (
    DataSource,
    DataSourceStatus,
    DataSourceType,
    DataRecord,
    DataRecordCreate
)
from app.core.minio_utils import minio_client
from app.api.routes.utils import scrape_article 

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


def update_datasource_status(session: Session, datasource_id: int, status: DataSourceStatus, error_message: str | None = None):
    """Prepares the DataSource status update within the provided session."""
    try:
        datasource = session.get(DataSource, datasource_id)
        if datasource:
            datasource.status = status
            datasource.error_message = error_message
            session.add(datasource)
        else:
            # Log error here as it's outside the main task loop's final error handling
            logging.error(f"DataSource {datasource_id} not found during status update preparation.")
    except Exception as e:
        # Log error here as it's outside the main task loop's final error handling
        logging.error(f"Error preparing status update for DataSource {datasource_id}: {e}")
        raise


def create_datarecords_batch(session: Session, records_data: List[Dict[str, Any]]):
    """Prepares a batch of DataRecords for addition to the session."""
    if not records_data:
        return 0
    try:
        records = [DataRecord(**data) for data in records_data]
        session.add_all(records)
        count = len(records)
        return count
    except Exception as e:
        # Log error here as it's outside the main task loop's final error handling
        logging.error(f"Error preparing batch of DataRecords: {e}")
        return -1


def sanitize_csv_row(row_dict: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """Converts all values in a CSV row dictionary to strings, handling None."""
    sanitized = {}
    if not row_dict:
        return sanitized
    for key, value in row_dict.items():
        clean_key = str(key) if key is not None else ""
        clean_value = str(value) if value is not None else ""
        sanitized[clean_key] = clean_value
    return sanitized


@celery.task(bind=True, max_retries=3)
def process_datasource(self, datasource_id: int):
    """
    Background task to process a DataSource based on its type,
    extract text content, and create DataRecord entries.
    """
    logging.info(f"Starting ingestion task for DataSource ID: {datasource_id}")
    start_time = time.time()
    total_records_created = 0

    with Session(engine) as session:
        try:
            datasource = session.get(DataSource, datasource_id)

            if not datasource:
                logging.error(f"DataSource {datasource_id} not found. Aborting task.")
                return

            if datasource.status != DataSourceStatus.PENDING:
                logging.warning(f"DataSource {datasource_id} is not PENDING (status: {datasource.status}). Skipping task.")
                return

            update_datasource_status(session, datasource_id, DataSourceStatus.PROCESSING)
            session.commit()
            session.refresh(datasource)

            source_metadata_update = {}
            origin_details = datasource.origin_details if isinstance(datasource.origin_details, dict) else {}

            # --- CSV Processing ---
            if datasource.type == DataSourceType.CSV:
                logging.info(f"Processing CSV DataSource: {datasource.id}")
                object_name = origin_details.get('filepath')
                if not object_name:
                    raise ValueError("Missing 'filepath' in origin_details for CSV source")

                try:
                    skip_rows = int(origin_details.get('skip_rows', 0))
                    if skip_rows < 0:
                        skip_rows = 0
                except (ValueError, TypeError):
                    skip_rows = 0

                user_delimiter = origin_details.get('delimiter')
                delimiter = None
                if user_delimiter:
                    if user_delimiter == '\\t':
                        delimiter = '\t'
                    elif len(user_delimiter) == 1:
                        delimiter = user_delimiter
                    # else: delimiter remains None, will attempt auto-detection

                default_encoding = 'utf-8'
                source_metadata_update['encoding_detected'] = None

                minio_response = None
                try:
                    minio_response = minio_client.get_file_object(object_name)
                    file_content_bytes = minio_response.read()

                    encoding_used = None
                    try:
                        file_content_text = file_content_bytes.decode(default_encoding)
                        encoding_used = default_encoding
                    except UnicodeDecodeError:
                        try:
                            file_content_text = file_content_bytes.decode('latin-1')
                            encoding_used = 'latin-1'
                        except UnicodeDecodeError:
                             try:
                                  detected = chardet.detect(file_content_bytes)
                                  if detected['encoding'] and detected['confidence'] > 0.7:
                                       encoding_used = detected['encoding']
                                       file_content_text = file_content_bytes.decode(encoding_used)
                                  else:
                                       raise UnicodeDecodeError("chardet", file_content_bytes, 0, len(file_content_bytes), f"Low confidence ({detected.get('confidence')}) or no encoding detected by chardet.")
                             except Exception as chardet_err:
                                  logging.error(f"Failed to decode CSV {object_name} with UTF-8, latin-1, and chardet failed: {chardet_err}", exc_info=True)
                                  raise ValueError(f"Could not determine encoding for CSV file {object_name}.")
                    source_metadata_update['encoding_used'] = encoding_used

                    lines = file_content_text.splitlines()
                    if not lines or skip_rows >= len(lines):
                         raise ValueError(f"Skipping {skip_rows} rows leaves no data/header in the file ({len(lines)} lines total).")

                    content_lines = lines[skip_rows:]
                    if not content_lines:
                         raise ValueError(f"No lines remaining after skipping {skip_rows} rows.")

                    header_line = content_lines[0]
                    data_lines = content_lines[1:]

                    if delimiter is None:
                         try:
                             sample_lines = content_lines[:10]
                             sample_text = "\n".join(sample_lines)
                             sniffer = csv.Sniffer()
                             dialect = sniffer.sniff(sample_text)
                             delimiter = dialect.delimiter
                         except csv.Error as sniff_err:
                             logging.warning(f"CSV Sniffer could not detect delimiter: {sniff_err}. Falling back to default ','.")
                             delimiter = ','

                    source_metadata_update['delimiter_used'] = repr(delimiter)

                    csv_content_for_reader = header_line + '\n' + '\n'.join(data_lines)
                    csv_data_io = io.StringIO(csv_content_for_reader)
                    reader = csv.DictReader(csv_data_io, delimiter=delimiter)

                    columns = reader.fieldnames
                    if not columns:
                        raise ValueError(f"Could not parse header row (line {skip_rows + 1}) with delimiter '{repr(delimiter)}'. Check configuration.")

                    valid_columns = [col for col in columns if col and col.strip()]
                    if len(valid_columns) != len(columns):
                         logging.warning(f"CSV {object_name} header contains empty or whitespace-only column names. These columns will be skipped.")
                         columns = valid_columns

                    source_metadata_update['columns'] = columns

                    row_count = 0
                    batch_records = []
                    batch_size = 500
                    processed_lines_count = 0
                    field_count_mismatches = 0

                    for i, row in enumerate(reader):
                        processed_lines_count += 1
                        original_file_line_num = skip_rows + 1 + (i + 1)

                        if row is None:
                            continue

                        if len(row) != len(columns):
                             field_count_mismatches += 1
                             # Log only the first few mismatches to avoid flooding logs
                             if field_count_mismatches <= 5:
                                 logging.warning(
                                     f"Field count mismatch on original file line ~{original_file_line_num} "
                                     f"in CSV {object_name}. Expected {len(columns)} fields, found {len(row)}. "
                                     f"(Further mismatches will not be logged individually)"
                                 )

                        sanitized_row = sanitize_csv_row(row)
                        sanitized_row_filtered = {k: v for k, v in sanitized_row.items() if k in columns}

                        if not sanitized_row_filtered:
                            continue

                        text_parts = [f"{col_name}: {cell_value}" for col_name, cell_value in sanitized_row_filtered.items()]
                        text_content = "\n".join(text_parts)

                        if not text_content.strip():
                            continue

                        record_meta = {
                            'row_number': original_file_line_num,
                            'source_columns': sanitized_row_filtered
                        }
                        batch_records.append({
                            "datasource_id": datasource_id,
                            "text_content": text_content,
                            "source_metadata": record_meta
                        })
                        row_count += 1

                        if len(batch_records) >= batch_size:
                            created_count = create_datarecords_batch(session, batch_records)
                            if created_count == -1:
                                 raise ValueError("Error preparing batch of DataRecords.")
                            total_records_created += created_count
                            batch_records = []
                            session.flush()

                    if batch_records:
                        created_count = create_datarecords_batch(session, batch_records)
                        if created_count == -1:
                             raise ValueError("Error preparing final batch of DataRecords.")
                        total_records_created += created_count
                        session.flush()

                    source_metadata_update['row_count_processed'] = row_count
                    source_metadata_update['field_count_mismatches'] = field_count_mismatches
                    logging.info(f"Processed {row_count} data rows from CSV: {object_name}. Found {field_count_mismatches} rows with field count mismatches.")

                except (FileNotFoundError, ValueError, csv.Error, UnicodeDecodeError) as specific_err:
                    logging.error(f"CSV processing error for {object_name}: {specific_err}")
                    raise
                except Exception as csv_err:
                    logging.error(f"Unexpected error processing CSV content from {object_name}: {csv_err}", exc_info=True)
                    raise ValueError(f"Failed to process CSV file: {csv_err}") from csv_err
                finally:
                     if minio_response:
                         try:
                             minio_response.close()
                             minio_response.release_conn()
                         except Exception as release_err:
                             logging.warning(f"Error closing/releasing MinIO connection for {object_name}: {release_err}")

            # --- PDF Processing ---
            elif datasource.type == DataSourceType.PDF:
                 logging.info(f"Processing PDF DataSource: {datasource.id}")
                 object_name = origin_details.get('filepath')
                 if not object_name: raise ValueError("Missing 'filepath' for PDF")
                 minio_response = None
                 try:
                     minio_response = minio_client.get_file_object(object_name)
                     pdf_data = minio_response.read()
                     all_pdf_text = ""
                     total_processed_pages = 0
                     with fitz.open(stream=pdf_data, filetype="pdf") as doc:
                         page_count = doc.page_count
                         source_metadata_update['page_count'] = page_count
                         for page_num in range(page_count):
                             try:
                                 page = doc.load_page(page_num)
                                 text = page.get_text("text")
                                 cleaned_text = text.replace('\x00', '').strip()
                                 if cleaned_text:
                                     all_pdf_text += cleaned_text + "\n\n"
                                     total_processed_pages += 1
                             except Exception as page_err:
                                 logging.error(f"Error processing page {page_num + 1} in PDF {object_name}: {page_err}")
                         if all_pdf_text:
                              records_to_create_list = [{
                                  "datasource_id": datasource_id,
                                  "text_content": all_pdf_text.strip(),
                                  "source_metadata": {
                                      'processed_page_count': total_processed_pages,
                                      'original_filename': origin_details.get('filename', 'N/A')
                                  }
                              }]
                              created_count = create_datarecords_batch(session, records_to_create_list)
                              if created_count == -1: raise ValueError("Error preparing PDF DataRecord.")
                              total_records_created += created_count
                              session.flush()
                         else: logging.warning(f"No text extracted from PDF {object_name}.")
                         source_metadata_update['processed_page_count'] = total_processed_pages
                         logging.info(f"Processed PDF {object_name}, extracted text from {total_processed_pages}/{page_count} pages.")
                 except (FileNotFoundError, fitz.PyMuPDFError) as specific_err:
                     logging.error(f"PDF processing error: {specific_err}")
                     raise ValueError(f"Failed to open/parse PDF: {specific_err}") from specific_err
                 except Exception as pdf_err:
                     logging.error(f"Unexpected PDF error: {pdf_err}", exc_info=True)
                     raise ValueError(f"Failed processing PDF: {pdf_err}") from pdf_err
                 finally:
                     if minio_response:
                         try: minio_response.close(); minio_response.release_conn()
                         except Exception as e: logging.warning(f"MinIO close error: {e}")

            # --- URL List Processing ---
            elif datasource.type == DataSourceType.URL_LIST:
                 logging.info(f"Processing URL_LIST DataSource: {datasource.id}")
                 urls = origin_details.get('urls')
                 if not urls or not isinstance(urls, list): raise ValueError("Missing/invalid 'urls' list")
                 processed_count = 0
                 failed_urls = []
                 batch_records = []
                 batch_size = 100 # Keep batching for DB efficiency
                 for i, url in enumerate(urls):
                     error_msg = None
                     scraped_data = None
                     try:
                         # --- Call the centralized scraping logic ---
                         # Option 1: Call the endpoint (might require async context or adjustments)
                         # This is less ideal within a Celery task but demonstrates the concept.
                         # A better approach might involve a shared scraping utility function.
                         # For now, let's assume a function `internal_scrape_article` exists
                         # that mirrors the logic of the endpoint.

                         # Placeholder for actual scraping call
                         # Replace this with the appropriate call to your scraping utility
                         # Example: scraped_data = await internal_scrape_article(url) # If using async helper
                         # Example: scraped_data = opol.scraping.url(url) # If directly using OPOL sdk here
                         
                         # Simulate getting the expected structure back
                         # In a real scenario, you'd make the actual call
                         response = requests.get(url, timeout=20, headers={'User-Agent': 'Mozilla/5.0'}, allow_redirects=True)
                         response.raise_for_status()
                         from bs4 import BeautifulSoup # Keep temp import for simulation
                         soup = BeautifulSoup(response.text, 'html.parser')
                         simulated_text = soup.get_text(separator='\\n', strip=True)
                         simulated_title = soup.title.string if soup.title else url

                         scraped_data = {
                             "title": simulated_title,
                             "text_content": simulated_text,
                             "original_data": {"url": url} # Simulate minimal original data
                         }
                         # --- End of Scraping Call Simulation ---

                         if scraped_data and scraped_data.get("text_content"):
                             text_content = scraped_data["text_content"].replace('\\x00', '').strip()
                             title = scraped_data.get("title", "")
                             original_scrape_info = scraped_data.get("original_data", {})

                             if text_content:
                                 # Store title and original scrape info in source_metadata
                                 record_meta = {
                                     'original_url': url,
                                     'scraped_title': title,
                                     'original_scrape_data': original_scrape_info,
                                     'index': i # Keep original index if needed
                                 }
                                 batch_records.append({
                                     "datasource_id": datasource_id,
                                     "text_content": text_content,
                                     "source_metadata": record_meta
                                 })
                                 processed_count += 1
                             else:
                                 error_msg = "No text content extracted after scraping"
                         elif scraped_data:
                             error_msg = "Scraping successful but no text_content found"
                         else:
                            error_msg = "Scraping function returned no data"

                     except requests.Timeout as req_err:
                         error_msg = f"Request timed out: {req_err}"
                     except requests.RequestException as req_err:
                         error_msg = f"Request failed: {req_err}"
                     except Exception as extract_err:
                         # Catch potential errors from the scraping function itself
                         error_msg = f"Scraping/Extraction error: {extract_err}"
                         logging.error(f"Error processing URL {url}: {error_msg}", exc_info=True)

                     if error_msg:
                         logging.warning(f"Skipping URL {url}: {error_msg}")
                         failed_urls.append({"url": url, "error": error_msg})

                     # Commit batches periodically
                     if len(batch_records) >= batch_size:
                         created_count = create_datarecords_batch(session, batch_records)
                         if created_count == -1: raise ValueError("Error preparing URL batch.")
                         total_records_created += created_count
                         batch_records = []
                         session.flush()
                         # Consider a small sleep if hitting rate limits during scraping
                         time.sleep(0.1) # Keep the sleep

                 # Commit any remaining records in the last batch
                 if batch_records:
                     created_count = create_datarecords_batch(session, batch_records)
                     if created_count == -1: raise ValueError("Error preparing final URL batch.")
                     total_records_created += created_count
                     session.flush()

                 source_metadata_update = {
                     'url_count': len(urls),
                     'processed_count': processed_count,
                     'failed_count': len(failed_urls),
                     'failed_urls': failed_urls # Store failed URLs for debugging
                 }
                 logging.info(f"Processed {processed_count}/{len(urls)} URLs. Failed: {len(failed_urls)}.")

            # --- Text Block Processing ---
            elif datasource.type == DataSourceType.TEXT_BLOCK:
                 logging.info(f"Processing TEXT_BLOCK DataSource: {datasource.id}")
                 text_content = origin_details.get('text_content')
                 if not text_content or not isinstance(text_content, str): raise ValueError("Missing/invalid 'text_content'")
                 records_to_create_list = [{"datasource_id": datasource_id, "text_content": text_content, "source_metadata": {}}]
                 created_count = create_datarecords_batch(session, records_to_create_list)
                 if created_count == -1: raise ValueError("Error preparing TEXT_BLOCK record.")
                 total_records_created += created_count; session.flush()
                 source_metadata_update = {'character_count': len(text_content)}
                 logging.info(f"Processed text block, {len(text_content)} chars.")

            else:
                raise NotImplementedError(f"Ingestion logic not implemented for type: {datasource.type}")

            if total_records_created == 0 and datasource.type not in [DataSourceType.PDF, DataSourceType.TEXT_BLOCK]:
                 logging.warning(f"No DataRecords were created for DataSource {datasource_id} ({datasource.type}).")

            if source_metadata_update:
                 new_metadata = (datasource.source_metadata.copy() if isinstance(datasource.source_metadata, dict) else {})
                 new_metadata.update(source_metadata_update)
                 datasource.source_metadata = new_metadata
                 session.add(datasource)

            update_datasource_status(session, datasource_id, DataSourceStatus.COMPLETE)
            session.commit()
            logging.info(f"Committed COMPLETE status and data for DataSource {datasource_id}")

        except Exception as e:
            session.rollback()
            logging.exception(f"Error processing DataSource {datasource_id}: {e}")
            error_message = f"Processing failed: {type(e).__name__}: {str(e)}"
            try:
                with Session(engine) as error_session:
                    error_datasource = error_session.get(DataSource, datasource_id)
                    if error_datasource:
                        error_datasource.status = DataSourceStatus.FAILED
                        error_datasource.error_message = error_message
                        error_session.add(error_datasource)
                        error_session.commit()
                        logging.info(f"DataSource {datasource_id} status updated to FAILED.")
                    else:
                         logging.error(f"Could not find DataSource {datasource_id} to mark as FAILED.")
            except Exception as final_status_err:
                 logging.error(f"CRITICAL: Failed to update DataSource {datasource_id} status to FAILED after main error: {final_status_err}")

            try:
                retry_countdown = 30 * (self.request.retries + 1)
                logging.warning(f"Retrying task for DataSource {datasource_id} in {retry_countdown}s due to error: {e}")
                retry_exc = e if isinstance(e, BaseException) else None
                self.retry(exc=retry_exc, countdown=retry_countdown)
            except self.MaxRetriesExceededError:
                logging.error(f"Max retries exceeded for DataSource {datasource_id}. Remains FAILED.")
            except Exception as retry_err:
                 logging.error(f"Error during retry mechanism for DataSource {datasource_id}: {retry_err}")


        finally:
            end_time = time.time()
            logging.info(f"Ingestion task for DataSource {datasource_id} finished processing in {end_time - start_time:.2f} seconds. Total records created: {total_records_created}.")

# if __name__ == "__main__":
#     test_datasource_id = 1
#     print(f"Manually triggering task for DataSource ID: {test_datasource_id}")
#     # process_datasource.delay(test_datasource_id) # Use .delay() for Celery