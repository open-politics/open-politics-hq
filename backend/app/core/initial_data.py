from typing import Dict, List, Any, Literal, Optional
from pydantic import BaseModel, Field as PydanticField

# --- Initial Base Annotation Schemas ---
from app.schemas import AnnotationSchemaCreate, AssetCreate, FieldJustificationConfig, BoundingBox
from app.models import AssetKind

# ==================================================================================================
# 1. PYDANTIC MODELS FOR OUTPUT CONTRACTS
# These models define the expected JSON structure for various annotation schema outputs.
# ==================================================================================================

# --- Models for Multi-Modal Article Analysis ---
class KeyEntityOutput(BaseModel):
    name: str
    type: Literal["PERSON", "ORGANIZATION", "LOCATION", "EVENT", "OTHER"]
    mentions_in_text_count: Optional[int] = None

class DocumentOutput(BaseModel):
    overall_sentiment_score: int = PydanticField(description="Overall sentiment of the article, from -10 (very negative) to 10 (very positive).")
    key_entities: List[KeyEntityOutput]

class IdentifiedPersonInImageOutput(BaseModel):
    name_match_from_text: str = PydanticField(description="Name of the person from the article text identified in this image region.")
    bounding_box: BoundingBox

class PerImageOutput(BaseModel):
    description: str = PydanticField(description="Brief description of what is depicted in this image relevant to the article.")
    identified_persons_in_image: Optional[List[IdentifiedPersonInImageOutput]] = None

class MultiModalArticleOutputContract(BaseModel):
    document: DocumentOutput
    per_image: Optional[List[PerImageOutput]] = None

# --- Model for Basic Entity Extraction ---
class BasicEntityOutputContract(BaseModel):
    persons: List[str]
    organizations: List[str]
    locations: List[str]

class BasicEntityDocument(BaseModel):
    document: BasicEntityOutputContract

# --- Models for Knowledge Graph Extraction (Grant Deliverable) ---
class KGEntity(BaseModel):
    id: int = PydanticField(description="A unique integer ID for this entity within this document.")
    name: str = PydanticField(description="The name of the entity.")
    type: str = PydanticField(description="The type of the entity (e.g., 'PERSON', 'COMPANY', 'LOCATION').")

class KGTriplet(BaseModel):
    source_id: int = PydanticField(description="The ID of the source entity.")
    target_id: int = PydanticField(description="The ID of the target entity.")
    predicate: str = PydanticField(description="The relationship between the source and target entities (e.g., 'works for', 'is located in').")
    description: Optional[str] = PydanticField(default=None, description="A brief explanation or context for this extracted relationship, including the source text snippet that supports it.")

class KnowledgeGraphOutputContract(BaseModel):
    entities: List[KGEntity] = PydanticField(description="All unique entities identified in the document.")
    triplets: List[KGTriplet] = PydanticField(description="All relationships between entities identified in the document.")

class KnowledgeGraphDocument(BaseModel):
    document: KnowledgeGraphOutputContract

# --- Models for Hierarchical Topic Modeling (Grant Deliverable) ---
class Topic(BaseModel):
    name: str = PydanticField(description="The name of the topic.")
    confidence: float = PydanticField(description="The confidence score of the topic's relevance.")
    sub_topics: Optional[List['Topic']] = PydanticField(default=None, description="A list of more specific sub-topics.")

class HierarchicalTopicOutputContract(BaseModel):
    topics: List[Topic] = PydanticField(description="A list of hierarchically organized topics identified in the document.")

class HierarchicalTopicDocument(BaseModel):
    document: HierarchicalTopicOutputContract

# --- Model for Scenario-Specific Analysis ---
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

class CompanyTechDocument(BaseModel):
    document: CompanyTechOutputContract

# ==================================================================================================
# 2. ANNOTATION SCHEMA DEFINITIONS
# These are the actual schema objects that will be loaded into the database.
# ==================================================================================================

# --- Core General-Purpose Schemas ---

MULTI_MODAL_ARTICLE_SCHEMA = AnnotationSchemaCreate(
    name="Multi-Modal Article Analysis",
    description="Analyzes article text and associated images for entities, sentiment, and image content. Includes field-specific justifications.",
    instructions="""
                  Analyze the provided article text and any associated images.
                  1. Determine the overall_sentiment_score of the article.
                  2. Extract key_entities (PERSON, ORGANIZATION, etc.) from the text, along with their mention counts.
                  3. For each image provided:
                      - Describe the image briefly, focusing on its relevance to the article.
                      - If any people mentioned in the text are visible in the image, identify them under 'identified_persons_in_image'. Provide their name_match_from_text and a bounding_box. The bounding_box label should be the matched name.
                  Ensure your output strictly adheres to the provided schema.
                  """
                  ,
    output_contract=MultiModalArticleOutputContract.model_json_schema(),
    field_specific_justification_configs={
      "overall_sentiment_score": FieldJustificationConfig(enabled=True, custom_prompt="Explain the factors and text segments that led to this sentiment score."),
      "key_entities": FieldJustificationConfig(enabled=True), # Will use default prompt from AnnotationRun
      "description": FieldJustificationConfig(enabled=True, custom_prompt="Justify why this image description is relevant and accurate."), # Applies to per_image[*].description
      "identified_persons_in_image": FieldJustificationConfig(enabled=True) # Applies to per_image[*].identified_persons_in_image (the array)
    },
    version="1.0"
)

BASIC_ENTITY_SCHEMA = AnnotationSchemaCreate(
    name="Basic Entity Extraction",
    description="Extracts Persons, Organizations, and Locations from text.",
    instructions="Identify all persons, organizations, and locations mentioned in the text.",
    output_contract=BasicEntityDocument.model_json_schema(),
    field_specific_justification_configs={
        "persons": FieldJustificationConfig(enabled=True, custom_prompt="Explain how you identified each person and provide the text span."),
        "organizations": FieldJustificationConfig(enabled=True),
        "locations": FieldJustificationConfig(enabled=True)
    },
    version="1.0"
)

# --- Grant-Specific Schemas ---

KNOWLEDGE_GRAPH_SCHEMA = AnnotationSchemaCreate(
    name="Knowledge Graph Extractor",
    description="Extracts entities (nodes) and their relationships (triplets/edges) from a document to build a knowledge graph.",
    instructions="""
    Carefully read the document and identify all distinct entities (people, organizations, locations, etc.) and the relationships between them.
    1.  First, create a list of all unique entities, assigning a unique integer ID to each.
    2.  Second, create a list of all triplets that describe a relationship. Use the integer IDs you assigned in the first step to link the source and target entities.
    3.  For each triplet, provide a brief 'description' that includes the source text snippet that supports the relationship.
    The predicate should be a short, descriptive verb phrase (e.g., 'founded', 'invested in', 'is a subsidiary of').
    Your output must strictly adhere to the required JSON schema, placing all entities and triplets inside a top-level "document" object.
    """,
    output_contract=KnowledgeGraphDocument.model_json_schema(),
    version="1.0"
)

HIERARCHICAL_TOPIC_SCHEMA = AnnotationSchemaCreate(
    name="Hierarchical Topic Model",
    description="Identifies a hierarchy of topics and sub-topics within a document.",
    instructions="Analyze the document to identify its main topics. For each main topic, identify any more specific sub-topics. Organize these in a hierarchical structure.",
    output_contract=HierarchicalTopicDocument.model_json_schema(),
    version="1.0"
)


# ==================================================================================================
# 3. LISTS FOR DB INITIALIZATION
# These lists are imported by db.py to populate the database on first run.
# ==================================================================================================

INITIAL_SCHEMAS: List[AnnotationSchemaCreate] = [
    MULTI_MODAL_ARTICLE_SCHEMA,
    BASIC_ENTITY_SCHEMA,
    KNOWLEDGE_GRAPH_SCHEMA,
    HIERARCHICAL_TOPIC_SCHEMA
    # Add other general-purpose, pre-configured schemas here
]

SAMPLE_ARTICLE_TEXT_1: str = """
Senator John Martinez announced his new healthcare reform proposal today, focusing on expanding Medicare coverage to include mental health services and prescription drug benefits. The legislation would also address climate change through a carbon tax system and increased funding for renewable energy infrastructure. Martinez emphasized that this bipartisan effort aims to tackle both healthcare costs and environmental protection simultaneously.
"""

# Add more sample articles that would match political categories
SAMPLE_ARTICLE_TEXT_2: str = """
The Department of Education released new guidelines for public school funding, proposing increased investment in STEM education and teacher training programs. Secretary Williams noted that improving educational outcomes is crucial for national competitiveness. The proposal also includes provisions for expanding access to higher education through enhanced financial aid programs.
"""

SAMPLE_ARTICLE_TEXT_3: str = """
Congress debates new immigration reform legislation that would provide pathways to citizenship for undocumented workers while strengthening border security measures. The bill addresses both humanitarian concerns and economic impacts of immigration policy. Representatives from both parties acknowledged the need for comprehensive reform that balances security with civil rights protections.
"""

INITIAL_ASSETS: List[AssetCreate] = [
    AssetCreate(
        title="Healthcare and Climate Policy Announcement",
        kind=AssetKind.TEXT,
        text_content=SAMPLE_ARTICLE_TEXT_1,
        source_metadata={"origin": "db_init", "description": "A sample political article covering healthcare and environmental policy for testing political categories."}
    ),
    AssetCreate(
        title="Education Funding Reform Proposal",
        kind=AssetKind.TEXT,
        text_content=SAMPLE_ARTICLE_TEXT_2,
        source_metadata={"origin": "db_init", "description": "A sample political article covering education policy for testing political categories."}
    ),
    AssetCreate(
        title="Immigration Reform Legislation Debate",
        kind=AssetKind.TEXT,
        text_content=SAMPLE_ARTICLE_TEXT_3,
        source_metadata={"origin": "db_init", "description": "A sample political article covering immigration and civil rights for testing political categories."}
    ),
    AssetCreate(
        title="Placeholder Image Asset",
        kind=AssetKind.IMAGE,
        text_content="This is a placeholder for an image asset. Its actual binary content would be in a blob store.",
        blob_path="placeholders/generic_image.png", # Conceptual path
        source_metadata={"origin": "db_init", "description": "A generic placeholder for image assets."}
    )
    # Add other general-purpose, pre-configured assets here
] 

# ==================================================================================================
# 4. DEMO SCENARIO DATA
# This data is used by db.py to create a rich, interactive demo environment.
# It is kept separate from the core initial data for clarity.
# ==================================================================================================

# --- Scenario-Specific Schema ---
SCENARIO_ANALYSIS_SCHEMA = AnnotationSchemaCreate(
    name="Company & Tech Analysis",
    description="Extracts a relevance score and technology tags from a document.",
    instructions="""
    Analyze the provided document. Your goal is to assess its relevance to technology and corporate analysis.
    1.  Assign a 'relevance_score' from 1 (not relevant) to 10 (highly relevant).
    2.  Extract a list of key 'technology_tags' from the text. These should be specific concepts like 'cloud_storage', 'ai_ethics', 'robotics', etc.
    Your output must strictly follow the required JSON schema.
    """,
    output_contract=CompanyTechDocument.model_json_schema(),
    version="1.0"
)

# --- Scenario Content and Assets ---
SCENARIO_CSV_CONTENT = """company_name,founding_year,technology_tags
Innovatech Corp,2015,"ai_ethics,machine_learning,saas"
QuantumLeap,2018,"quantum_computing,cryptography"
BioSynth,2020,"biotechnology,gene_editing"
"""

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

# --- Scenario Sources, Bundles, and Tasks ---
from app.models import TaskType, TaskStatus
from app.schemas import BundleCreate, TaskCreate, SourceCreate

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

SCENARIO_BUNDLE_1 = BundleCreate(name="Corporate Filings", description="Uploaded PDF and CSV files.")
SCENARIO_BUNDLE_2 = BundleCreate(name="Public News", description="Assets from scraped news articles.")
SCENARIO_BUNDLE_3 = BundleCreate(name="AI Research", description="Assets ingested from a recurring search.")

SCENARIO_RECURRING_TASK = TaskCreate(
    name="Recurring AI Hardware Search Ingest",
    type=TaskType.INGEST,
    schedule="0 */6 * * *", # Every 6 hours
    status=TaskStatus.ACTIVE,
    configuration={
        "target_source_id": None, # To be filled in dynamically
        "target_bundle_id": None, # To be filled in dynamically
        "scraping_config": {
            "timeout": 60,
            "retry_attempts": 2
        }
    }
) 