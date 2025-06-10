from typing import Dict, List, Any, Literal, Optional
from pydantic import BaseModel, Field as PydanticField

from app.schemas import AnnotationSchemaCreate, AssetCreate, BundleCreate, TaskCreate, SourceCreate, FieldJustificationConfig, BoundingBox
from app.models import AssetKind, TaskType, TaskStatus

# --- Pydantic Models for Scenario-Specific Output Contracts ---

class CompanyTechOutputContract(BaseModel):
    """
    Schema for analyzing company/technology related documents.
    """
    relevance_score: int = PydanticField(
        description="A score from 1 to 10 indicating the document's relevance to technology and corporate analysis.",
        ge=1, 
        le=10
    )
    technology_tags: List[str] = PydanticField(
        description="A list of specific technology keywords or concepts mentioned (e.g., 'quantum_computing', 'machine_learning', 'saas')."
    )

# --- Annotation Schema for the Scenario ---

SCENARIO_ANALYSIS_SCHEMA = AnnotationSchemaCreate(
    name="Company & Tech Analysis",
    description="Extracts a relevance score and technology tags from a document.",
    instructions="""
    Analyze the provided document. Your goal is to assess its relevance to technology and corporate analysis.
    1.  Assign a 'relevance_score' from 1 (not relevant) to 10 (highly relevant).
    2.  Extract a list of key 'technology_tags' from the text. These should be specific concepts like 'cloud_storage', 'ai_ethics', 'robotics', etc.
    Your output must strictly follow the required JSON schema.
    """,
    output_contract=CompanyTechOutputContract.model_json_schema(),
    version="1.0"
)

# --- Source and Asset Data for Phase 1 ---

# 1a. CSV Upload
SCENARIO_CSV_CONTENT = """company_name,founding_year,technology_tags
Innovatech Corp,2015,"ai_ethics,machine_learning,saas"
QuantumLeap,2018,"quantum_computing,cryptography"
BioSynth,2020,"biotechnology,gene_editing"
"""

# We will create a Source of kind 'upload_csv' and the system will process this content.
# The initial_data script will simulate the upload by creating the Source and an Asset with the content.

SCENARIO_PDF_ASSET = AssetCreate(
    title="Fictional Analyst Report on Innovatech",
    kind=AssetKind.PDF,
    text_content="""
    Analyst Report: Innovatech Corp (ITC)
    Date: 2023-11-27
    Innovatech Corp continues to lead in the Software-as-a-Service (SaaS) market.
    Their recent focus on AI ethics and transparent machine learning algorithms sets them apart.
    We project significant growth in their enterprise solutions sector.
    """,
    source_metadata={"origin": "scenario_upload", "filename": "Innovatech_Report.pdf"}
)

# 1b. URL Scraping
SCENARIO_URL_SOURCE = SourceCreate(
    name="Tech News Scrape Source",
    kind="url_list_scrape",
    details={
        "urls": [
            "https://www.wired.com/story/what-is-generative-ai/",
            "https://www.technologyreview.com/2022/11/18/1063464/chatgpt-openai-language-model-gpt-3-interview/"
        ]
    }
)

# 1c. Search Ingestion
SCENARIO_SEARCH_SOURCE = SourceCreate(
    name="AI Hardware Search Source",
    kind="search",
    details={
        "search_config": {
            "query": "future of AI hardware",
            "provider": "tavily",
            "max_results": 5
        }
    }
)

# --- Bundles for Phase 1 ---

SCENARIO_BUNDLE_1 = BundleCreate(name="Corporate Filings", description="Uploaded PDF and CSV files.")
SCENARIO_BUNDLE_2 = BundleCreate(name="Public News", description="Assets from scraped news articles.")
SCENARIO_BUNDLE_3 = BundleCreate(name="AI Research", description="Assets ingested from a recurring search.")


# --- Recurring Task for Phase 4 ---

SCENARIO_RECURRING_TASK = TaskCreate(
    name="Recurring AI Hardware Search Ingest",
    type=TaskType.INGEST,
    schedule="0 */6 * * *", # Every 6 hours
    status=TaskStatus.ACTIVE,
    configuration={
        # This task will point to the 'AI Hardware Search Source' created above.
        # The 'target_source_id' will be dynamically assigned when the source is created.
        "target_source_id": None, # To be filled in dynamically
        # It will add new assets to the 'AI Research' bundle.
        # The 'target_bundle_id' will also be filled in dynamically.
        "target_bundle_id": None,
        "scraping_config": {
            "timeout": 60,
            "retry_attempts": 2
        }
    }
) 