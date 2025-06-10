from typing import Dict, List, Any, Literal, Optional
from pydantic import BaseModel, Field as PydanticField

# --- Initial Base Annotation Schemas ---
from app.schemas import AnnotationSchemaCreate, AssetCreate, FieldJustificationConfig, BoundingBox
from app.models import AssetKind

# --- Pydantic Models for Output Contracts ---

# For MULTI_MODAL_ARTICLE_SCHEMA
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

# For BASIC_ENTITY_SCHEMA
class BasicEntityOutputContract(BaseModel):
    persons: List[str]
    organizations: List[str]
    locations: List[str]

# Example: Multi-Modal Article Analysis Schema (based on our test case)
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

# Example: Basic Entity Extraction (Text-Only)
BASIC_ENTITY_SCHEMA = AnnotationSchemaCreate(
    name="Basic Entity Extraction",
    description="Extracts Persons, Organizations, and Locations from text.",
    instructions="Identify all persons, organizations, and locations mentioned in the text.",
    output_contract=BasicEntityOutputContract.model_json_schema(),
    field_specific_justification_configs={
        "persons": FieldJustificationConfig(enabled=True, custom_prompt="Explain how you identified each person and provide the text span."),
        "organizations": FieldJustificationConfig(enabled=True),
        "locations": FieldJustificationConfig(enabled=True)
    },
    version="1.0"
)


INITIAL_SCHEMAS: List[AnnotationSchemaCreate] = [
    MULTI_MODAL_ARTICLE_SCHEMA,
    BASIC_ENTITY_SCHEMA
    # Add other pre-configured schemas here
]


# --- Initial Base Assets ---
# For init_db, these will be conceptual or primarily text-based.
# Linking to actual binary files (images) in MinIO from init_db is complex
# as it requires ensuring those files exist at known paths during initial setup.

SAMPLE_ARTICLE_TEXT_1: str = """
Dr. Evelyn Hayes, a lead scientist at Innovatech Corp, presented her findings on advanced AI ethics today.
She emphasized the importance of transparent algorithms.
Later, during the Q&A, she pointed to a diagram of their new framework displayed on the screen (see Figure 1).
Innovatech Corp aims to release a public whitepaper next month.
"""

INITIAL_ASSETS: List[AssetCreate] = [
    AssetCreate(
        title="Sample News Article - AI Ethics",
        kind=AssetKind.TEXT, # Using 'text' for simplicity in init_db
        text_content=SAMPLE_ARTICLE_TEXT_1,
        source_metadata={"origin": "db_init", "description": "A sample article about AI ethics for testing."}
        # If we had a known image in MinIO:
        # "children": [
        #   {
        #       "title": "Figure 1 - AI Framework Diagram",
        #       "kind": AssetKind.IMAGE,
        #       "blob_path": "initial_data/sample_figure1.png", # Needs to exist in MinIO
        #       "source_metadata": {"origin": "db_init", "caption": "Conceptual diagram of AI framework"}
        #   }
        # ]
    ),
    AssetCreate(
        title="Placeholder Image Asset",
        kind=AssetKind.IMAGE,
        text_content="This is a placeholder for an image asset. Its actual binary content would be in a blob store.",
        blob_path="placeholders/generic_image.png", # Conceptual path
        source_metadata={"origin": "db_init", "description": "A generic placeholder for image assets."}
    )
    # Add other pre-configured assets here
] 