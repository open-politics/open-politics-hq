---
title: "Annotation Schemas & Runs"
description: "Learn how to define analysis tasks in natural language and extract structured data from any content using Open Politics HQ's powerful annotation system."
---

## Overview

Annotation Schemas define what information to extract from documents. You write instructions in plain English, specify the output format, and the system applies this analysis to your content automatically.

Schemas work like analysis templates - define once, apply to many documents.

<CardGroup cols={2}>
  <Card title="Natural Language Instructions" icon="message-lines">
    Define analysis tasks in plain English without needing to code
  </Card>
  <Card title="Structured JSON Output" icon="brackets-curly">
    Get consistent, validated results that can be analyzed and visualized
  </Card>
  <Card title="Multi-Modal Analysis" icon="images">
    Analyze text, images, and media together in unified workflows
  </Card>
  <Card title="Fragment Curation" icon="star">
    Promote key findings to permanent, searchable knowledge
  </Card>
</CardGroup>

---

## Core Concepts

### Annotation Schemas

A **Schema** defines an analysis task with three key components:

1. **Instructions**: Natural language description of what to analyze
2. **Output Contract**: JSON Schema defining the expected output structure  
3. **Justification Settings**: Configuration for evidence and reasoning capture

<Tabs>
<Tab title="Simple Entity Extraction">
  ```json Basic Schema
  {
    "name": "Basic Entity Extraction",
    "description": "Extract people, organizations, and locations from text",
    "instructions": "Identify all persons, organizations, and locations mentioned in the text. For each entity, note how many times it appears.",
    "output_contract": {
      "type": "object",
      "properties": {
        "persons": {
          "type": "array",
          "items": {
            "type": "object", 
            "properties": {
              "name": {"type": "string"},
              "mentions": {"type": "integer"},
              "role": {"type": "string"}
            }
          }
        },
        "organizations": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {"type": "string"},
              "mentions": {"type": "integer"},
              "type": {"type": "string"}
            }
          }
        },
        "locations": {
          "type": "array", 
          "items": {
            "type": "object",
            "properties": {
              "name": {"type": "string"},
              "mentions": {"type": "integer"},
              "coordinates": {"type": "string"}
            }
          }
        }
      }
    }
  }
  ```
</Tab>

<Tab title="Multi-Modal Analysis">
  ```json Multi-Modal Schema
  {
    "name": "Article with Images Analysis",
    "description": "Analyze article text and associated images together",
    "instructions": "Analyze the article text for sentiment and key topics. For each image, describe its content and relevance to the article. Identify any people mentioned in the text who are visible in the images.",
    "output_contract": {
      "type": "object",
      "properties": {
        "document": {
          "type": "object",
          "properties": {
            "overall_sentiment": {"type": "string"},
            "key_topics": {
              "type": "array",
              "items": {"type": "string"}
            },
            "summary": {"type": "string"}
          }
        },
        "per_image": {
          "type": "object", 
          "properties": {
            "description": {"type": "string"},
            "relevance_to_article": {"type": "string"},
            "identified_people": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "name": {"type": "string"},
                  "confidence": {"type": "number"},
                  "bounding_box": {"type": "string"}
                }
              }
            }
          }
        }
      }
    }
  }
  ```
</Tab>

<Tab title="Knowledge Graph Extraction">
  ```json Graph Schema
  {
    "name": "Knowledge Graph Extractor",
    "description": "Extract entities and relationships for network analysis",
    "instructions": "Identify all entities (people, organizations, locations, concepts) and the relationships between them. Create triplets showing who/what is connected to whom/what and how.",
    "output_contract": {
      "type": "object",
      "properties": {
        "document": {
          "type": "object",
          "properties": {
            "entities": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": {"type": "integer"},
                  "name": {"type": "string"},
                  "type": {"type": "string"},
                  "description": {"type": "string"}
                }
              }
            },
            "relationships": {
              "type": "array", 
              "items": {
                "type": "object",
                "properties": {
                  "source_id": {"type": "integer"},
                  "target_id": {"type": "integer"},
                  "predicate": {"type": "string"},
                  "description": {"type": "string"},
                  "confidence": {"type": "number"}
                }
              }
            }
          }
        }
      }
    }
  }
  ```
</Tab>
</Tabs>

### Annotation Runs

An **Annotation Run** applies one or more schemas to a set of assets, creating the actual analysis results. Runs provide:

- **Reproducible Analysis**: Complete audit trail of what was analyzed and how
- **Batch Processing**: Analyze hundreds or thousands of assets efficiently  
- **Progress Tracking**: Monitor processing status and handle errors gracefully
- **Result Management**: Organized storage and retrieval of analysis results

---

## Creating Annotation Schemas

### Schema Builder Interface

The easiest way to create schemas is through the visual Schema Builder:

<Steps>
<Step title="Define the Analysis Task">
  Start with a clear description of what you want to extract:
  
  <Info>
  **Good Instructions**: "Analyze this political speech for policy positions. For each position mentioned, identify the topic area, the speaker's stance (support/oppose/neutral), and any specific proposals or commitments made."
  </Info>
  
  <Warning>
  **Avoid Vague Instructions**: "Analyze the document for important things" - be specific about what constitutes "important" for your use case.
  </Warning>
</Step>

<Step title="Design the Output Structure">
  Use the visual builder to define your output schema:
  
  - **Simple Fields**: Text, numbers, dates, booleans
  - **Arrays**: Lists of items (entities, topics, events)
  - **Objects**: Nested structures for complex data
  - **Multi-Modal Fields**: Special fields for image/media analysis
</Step>

<Step title="Configure Justifications">
  Enable evidence capture for important fields:
  
  ```json Justification Config
  {
    "field_specific_justification_configs": {
      "policy_positions": {
        "enabled": true,
        "custom_prompt": "Provide the exact quote and context that supports this policy position identification."
      },
      "sentiment_score": {
        "enabled": true,
        "custom_prompt": "Explain the specific words and phrases that led to this sentiment score."
      }
    }
  }
  ```
</Step>

<Step title="Test and Refine">
  Run the schema on a few test assets and refine based on results:
  
  - Check output quality and consistency
  - Adjust instructions for better results
  - Modify output structure if needed
  - Fine-tune justification settings
</Step>
</Steps>

### Advanced Schema Patterns

<Tabs>
<Tab title="Hierarchical Analysis">
  For complex documents with multiple levels of analysis:
  
  ```json Hierarchical Schema
  {
    "output_contract": {
      "type": "object",
      "properties": {
        "document": {
          "type": "object",
          "properties": {
            "main_topic": {"type": "string"},
            "document_type": {"type": "string"},
            "overall_stance": {"type": "string"}
          }
        },
        "sections": {
          "type": "array",
          "items": {
            "type": "object", 
            "properties": {
              "section_title": {"type": "string"},
              "key_points": {
                "type": "array",
                "items": {"type": "string"}
              },
              "evidence": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "claim": {"type": "string"},
                    "support_type": {"type": "string"},
                    "source": {"type": "string"}
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  ```
</Tab>

<Tab title="Temporal Analysis">
  For tracking events and changes over time:
  
  ```json Temporal Schema
  {
    "output_contract": {
      "type": "object", 
      "properties": {
        "document": {
          "type": "object",
          "properties": {
            "time_period": {"type": "string"},
            "main_events": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "event": {"type": "string"},
                  "date": {"type": "string"},
                  "participants": {
                    "type": "array",
                    "items": {"type": "string"}
                  },
                  "outcome": {"type": "string"},
                  "significance": {"type": "string"}
                }
              }
            },
            "timeline_summary": {"type": "string"}
          }
        }
      }
    }
  }
  ```
</Tab>

<Tab title="Comparative Analysis">
  For analyzing multiple perspectives or sources:
  
  ```json Comparative Schema
  {
    "output_contract": {
      "type": "object",
      "properties": {
        "document": {
          "type": "object",
          "properties": {
            "topic": {"type": "string"},
            "perspectives": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "stakeholder": {"type": "string"},
                  "position": {"type": "string"},
                  "arguments": {
                    "type": "array",
                    "items": {"type": "string"}
                  },
                  "evidence_cited": {
                    "type": "array", 
                    "items": {"type": "string"}
                  }
                }
              }
            },
            "areas_of_agreement": {
              "type": "array",
              "items": {"type": "string"}
            },
            "key_disagreements": {
              "type": "array",
              "items": {"type": "string"}
            }
          }
        }
      }
    }
  }
  ```
</Tab>
</Tabs>

---

## Running Analysis

### Creating Annotation Runs

Once you have schemas defined, create runs to apply them to your assets:

<Tabs>
<Tab title="Single Schema Analysis">
  **Apply one schema to specific assets**
  
  - Select your target assets or bundle
  - Choose the analysis schema to apply
  - Configure model and processing options
  - Monitor progress and review results
  
  *[Screenshot: Single schema run creation interface]*
</Tab>

<Tab title="Multi-Schema Analysis">
  **Apply multiple schemas to the same content**
  
  - Select multiple complementary schemas
  - Choose target bundle for comprehensive analysis
  - Configure model settings for batch processing
  - Compare results across different analysis approaches
  
  *[Screenshot: Multi-schema run configuration]*
</Tab>

<Tab title="Multi-Modal Analysis">
  **Analyze text and media content together**
  
  - Enable image, audio, or video processing
  - Set media processing limits
  - Configure cross-modal analysis settings
  - Review integrated results
  
  *[Screenshot: Multi-modal run configuration]*
</Tab>
</Tabs>

### Run Configuration Options

<Tabs>
<Tab title="Model Settings">
  **Choose the right AI model for your analysis**
  
  **Recommended Models:**
  - **Gemini 2.5 Flash**: Best overall performance, supports thinking and multimodal
  - **GPT-4o**: High quality analysis, good for complex schemas
  - **Llama 3.1:8b**: Local processing with Ollama, privacy-focused
  
  **Settings:**
  - **Temperature**: Control randomness (0.1 for consistent, 0.7 for creative)
  - **Thinking Mode**: Enable step-by-step reasoning for complex analysis
  - **Token Limits**: Set maximum response length
  
  *[Screenshot: Model configuration interface]*
</Tab>

<Tab title="Multi-Modal Settings">
  **Configure media processing**
  
  **Processing Options:**
  - **Images**: 1-10 per asset (higher numbers slow processing)
  - **Audio**: 1-5 segments per asset
  - **Video**: 1-3 scenes per asset (coming soon)
  
  **Quality Settings:**
  - **Image Quality**: Balance between processing speed and analysis detail
  - **Audio Sampling**: Configure transcription accuracy
  
  *[Screenshot: Multi-modal configuration interface]*
</Tab>

<Tab title="Evidence & Justification">
  **Configure evidence capture settings**
  
  **Justification Modes:**
  - **None**: Fast processing without evidence capture
  - **Schema Default**: Use schema-level justification settings
  - **Field Specific**: Custom evidence prompts for important fields
  
  **Evidence Types:**
  - **Text Spans**: Exact quotes and context from documents
  - **Image Regions**: Bounding boxes and visual evidence
  - **Reasoning**: Step-by-step AI reasoning process
  
  *[Screenshot: Justification configuration interface]*
</Tab>
</Tabs>

### Monitoring Run Progress

<Steps>
<Step title="Track Processing Status">
  Monitor your analysis runs through the dashboard:
  
  **Status Values:**
  - **Pending**: Queued for processing
  - **Running**: Currently being processed  
  - **Completed**: Successfully finished
  - **Completed with Errors**: Finished but some assets failed
  - **Failed**: Run failed completely
  
  *[Screenshot: Run status monitoring dashboard]*
</Step>

<Step title="View Progress Details">
  Get detailed progress information including:
  - Total assets being processed
  - Number of successful annotations
  - Failed annotations requiring attention
  - Estimated completion time
  
  *[Screenshot: Run progress details view]*
</Step>

<Step title="Handle Errors and Retries">
  When annotations fail, you have several options:
  
  - **Retry All Failed**: Automatically retry all failed annotations
  - **Individual Retry**: Retry specific annotations with custom instructions
  - **Adjust Settings**: Modify model or processing settings and retry
  
  *[Screenshot: Error handling and retry interface]*
</Step>
</Steps>

---

## Working with Results

### Retrieving Annotations

<CodeGroup>
```bash Get Run Results
curl -X GET "/api/v1/infospaces/{id}/runs/{run_id}/annotations" \
  -G -d "limit=50" \
  -d "skip=0"
```

```bash Get Asset Annotations
curl -X GET "/api/v1/infospaces/{id}/assets/{asset_id}/annotations" \
  -G -d "schema_ids=123,456"
```

```bash Search Annotations
curl -X POST "/api/v1/annotations/search" \
  -d '{
    "query": "climate policy",
    "schema_ids": [123],
    "date_range": {
      "start": "2024-01-01",
      "end": "2024-01-31"
    }
  }'
```
</CodeGroup>

### Annotation Data Structure

<ResponseExample>
```json Annotation Result
{
  "id": 1001,
  "asset_id": 2001,
  "schema_id": 123,
  "run_id": 156,
  "status": "success",
  "value": {
    "policy_positions": [
      {
        "topic": "Climate Change",
        "stance": "support",
        "specific_proposal": "Carbon tax implementation by 2025",
        "confidence": 0.95
      }
    ],
    "key_entities": [
      {
        "name": "Environmental Protection Agency",
        "type": "organization",
        "mentions": 3,
        "role": "regulatory_body"
      }
    ],
    "document_sentiment": "neutral_positive"
  },
  "justifications": [
    {
      "field_path": "policy_positions[0]",
      "reasoning": "The document explicitly states 'we propose implementing a carbon tax by 2025' in paragraph 3.",
      "text_spans": [
        {
          "text": "we propose implementing a carbon tax by 2025",
          "start_char": 1245,
          "end_char": 1290,
          "context": "Given the urgency of climate action, we propose implementing a carbon tax by 2025 to incentivize clean energy adoption."
        }
      ]
    }
  ],
  "timestamp": "2024-01-20T10:15:00Z"
}
```
</ResponseExample>

### Result Analysis & Aggregation

<Tabs>
<Tab title="Statistical Analysis">
  Get aggregated statistics across your results:
  
  ```bash Run Statistics
  curl -X GET "/api/v1/infospaces/{id}/runs/{run_id}/statistics"
  ```
  
  ```json Statistics Response
  {
    "total_annotations": 450,
    "field_statistics": {
      "policy_positions.stance": {
        "value_counts": {
          "support": 180,
          "oppose": 120,
          "neutral": 150
        },
        "most_common": "support"
      },
      "document_sentiment": {
        "value_counts": {
          "positive": 200,
          "neutral": 180,
          "negative": 70
        },
        "distribution": {
          "positive": 0.44,
          "neutral": 0.40,
          "negative": 0.16
        }
      }
    }
  }
  ```
</Tab>

<Tab title="Export Results">
  Export annotations in various formats:
  
  ```bash Export to CSV
  curl -X GET "/api/v1/infospaces/{id}/runs/{run_id}/export" \
    -G -d "format=csv" \
    -o results.csv
  ```
  
  ```bash Export to JSON
  curl -X GET "/api/v1/infospaces/{id}/runs/{run_id}/export" \
    -G -d "format=json" \
    -d "include_justifications=true" \
    -o results.json
  ```
</Tab>

<Tab title="Create Datasets">
  Convert successful annotations into reusable datasets:
  
  ```bash Create Dataset from Run
  curl -X POST "/api/v1/infospaces/{id}/runs/{run_id}/create-dataset" \
    -d '{
      "name": "Policy Position Dataset - Q1 2024",
      "description": "Extracted policy positions from government documents"
    }'
  ```
</Tab>
</Tabs>

---

## Fragment Curation

One of the most powerful features is the ability to promote analysis results to permanent, searchable knowledge fragments.

### What are Fragments?

Fragments are key pieces of information that get promoted from temporary annotation results to permanent asset metadata. They become part of the asset's searchable knowledge base.

<Info>
**Example**: An annotation might extract "Carbon tax implementation by 2025" as a policy position. You can promote this to a fragment called "key_policy_commitment" that becomes permanently associated with that document.
</Info>

### Promoting Fragments

<Tabs>
<Tab title="Manual Curation">
  Promote important findings through the UI or API:
  
  ```bash Promote Fragment
  curl -X POST "/api/v1/infospaces/{id}/assets/{asset_id}/fragments" \
    -d '{
      "fragment_key": "key_policy_commitment",
      "fragment_value": "Implement carbon tax by 2025 with $50/ton starting rate"
    }'
  ```
  
  This creates an auditable record and adds the fragment to the asset's metadata.
</Tab>

<Tab title="Automated Promotion">
  Use the PromoteFieldAdapter in pipelines to automatically promote specific fields:
  
  ```json Pipeline Step
  {
    "step_type": "PROMOTE_FIELD",
    "configuration": {
      "source_field": "policy_positions[0].specific_proposal",
      "target_fragment": "primary_policy_proposal",
      "conditions": {
        "confidence": {">=": 0.8}
      }
    }
  }
  ```
</Tab>

<Tab title="Chat-Based Curation">
  Use the AI chat interface to curate findings:
  
  ```
  User: "Promote the main climate policy finding from document 1001 as a key commitment"
  
  AI: I'll promote that key finding for you.
  [Tool Call: curate_asset_fragment]
  
  Successfully promoted "Carbon tax implementation by 2025" as fragment "key_commitment" on asset 1001.
  ```
</Tab>
</Tabs>

### Fragment Usage

Once promoted, fragments become searchable and can be used in various ways:

<CodeGroup>
```bash Search by Fragments
curl -X GET "/api/v1/assets/search" \
  -G -d "fragment_key=key_policy_commitment" \
  -d "fragment_value_contains=carbon tax"
```

```bash Aggregate Fragments
curl -X GET "/api/v1/infospaces/{id}/fragments/aggregate" \
  -G -d "fragment_key=document_sentiment" \
  -d "group_by=value"
```

```bash Export Fragment Knowledge Base
curl -X GET "/api/v1/infospaces/{id}/fragments/export" \
  -G -d "format=json" \
  -o knowledge_base.json
```
</CodeGroup>

---

## Best Practices

### Schema Design Guidelines

<Steps>
<Step title="Start Simple">
  Begin with basic schemas and add complexity gradually:
  
  <Check>
  **Good First Schema**: Extract 3-5 key pieces of information with clear, simple output structure
  </Check>
  
  <Warning>
  **Avoid**: Trying to extract 20+ different fields in your first schema - start small and iterate
  </Warning>
</Step>

<Step title="Write Clear Instructions">
  Your instructions are the most important part:
  
  ```text Good Instructions
  "Analyze this political speech for policy positions. For each position:
  1. Identify the policy topic (healthcare, education, etc.)
  2. Determine the speaker's stance (support, oppose, neutral)
  3. Extract any specific proposals or commitments made
  4. Note the confidence level based on how explicitly it's stated"
  ```
</Step>

<Step title="Design for Analysis">
  Structure your output for the analysis you plan to do:
  
  - **For Visualization**: Include numeric fields for charts and geographic data for maps
  - **For Search**: Include categorical fields and tags
  - **For Relationships**: Include entity IDs and relationship types
</Step>
</Steps>

### Performance Optimization

<Tip>
**Batch Processing**: Process assets in batches of 50-200 for optimal performance. Larger batches may timeout, smaller batches are inefficient.
</Tip>

<Tabs>
<Tab title="Model Selection">
  Choose models based on your needs:
  
  - **Local Ollama**: Privacy, cost control, unlimited usage
  - **Gemini 2.5 Flash**: Best performance, multimodal, thinking support
  - **GPT-4o**: High quality for complex analysis tasks
</Tab>

<Tab title="Concurrency Settings">
  Adjust processing concurrency based on your resources:
  
  ```json Performance Settings
  {
    "max_concurrent_assets": 10,
    "request_timeout": 120,
    "retry_failed_after": "5m",
    "batch_size": 100
  }
  ```
</Tab>

<Tab title="Resource Management">
  Monitor and manage processing resources:
  
  - **Memory**: Large runs may require more worker memory
  - **Storage**: Results and justifications consume storage space
  - **API Limits**: Respect rate limits for cloud model providers
</Tab>
</Tabs>

### Quality Assurance

<Steps>
<Step title="Test on Sample Data">
  Always test schemas on 10-20 representative assets before running on large datasets.
</Step>

<Step title="Review Initial Results">
  Check the first batch of results and adjust instructions if needed:
  
  - Are entities being identified correctly?
  - Is the output structure consistent?
  - Are justifications providing useful evidence?
</Step>

<Step title="Handle Edge Cases">
  Plan for common issues:
  
  - **Empty Documents**: How should empty or very short documents be handled?
  - **Multiple Languages**: Do you need language-specific instructions?
  - **Poor Quality Scans**: How to handle OCR errors in PDF processing?
</Step>

<Step title="Validate Results">
  Use statistical analysis to identify potential issues:
  
  ```bash Validation Query
  curl -X GET "/api/v1/infospaces/{id}/runs/{run_id}/validation" \
    -G -d "check_consistency=true" \
    -d "flag_outliers=true"
  ```
</Step>
</Steps>

---

## Integration Examples

### Python Workflow

```python Complete Analysis Workflow
import requests
import time

# 1. Create schema
schema_response = requests.post(f'{base_url}/api/v1/infospaces/{infospace_id}/schemas', json={
    'name': 'Policy Position Extractor',
    'description': 'Extract policy positions from political documents',
    'instructions': '''
    Analyze this document for policy positions. For each position mentioned:
    1. Identify the policy topic area
    2. Determine the stance (support/oppose/neutral)  
    3. Extract specific proposals or commitments
    4. Rate confidence based on how explicitly stated
    ''',
    'output_contract': {
        'type': 'object',
        'properties': {
            'policy_positions': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'properties': {
                        'topic': {'type': 'string'},
                        'stance': {'type': 'string'},
                        'proposal': {'type': 'string'},
                        'confidence': {'type': 'number'}
                    }
                }
            }
        }
    }
})

schema_id = schema_response.json()['id']

# 2. Create annotation run
run_response = requests.post(f'{base_url}/api/v1/infospaces/{infospace_id}/runs', json={
    'name': 'Policy Analysis - Government Documents',
    'schema_ids': [schema_id],
    'target_bundle_id': bundle_id,
    'configuration': {
        'model': 'gemini-2.5-flash-preview-05-20',
        'temperature': 0.1,
        'enable_thinking': True
    }
})

run_id = run_response.json()['id']

# 3. Monitor progress
while True:
    status_response = requests.get(f'{base_url}/api/v1/infospaces/{infospace_id}/runs/{run_id}')
    run_data = status_response.json()
    
    if run_data['status'] in ['completed', 'completed_with_errors', 'failed']:
        break
        
    print(f"Progress: {run_data.get('progress', {}).get('percent_complete', 0)}%")
    time.sleep(30)

# 4. Get results
results_response = requests.get(f'{base_url}/api/v1/infospaces/{infospace_id}/runs/{run_id}/annotations')
annotations = results_response.json()['data']

# 5. Analyze results
policy_positions = []
for annotation in annotations:
    if annotation['status'] == 'success':
        positions = annotation['value'].get('policy_positions', [])
        policy_positions.extend(positions)

# Count stances
stance_counts = {}
for position in policy_positions:
    stance = position.get('stance', 'unknown')
    stance_counts[stance] = stance_counts.get(stance, 0) + 1

print(f"Analysis complete: {len(policy_positions)} positions found")
print(f"Stance distribution: {stance_counts}")
```

### Multi-Modal Analysis

```python Image + Text Analysis
# Create multi-modal schema
multimodal_schema = {
    'name': 'Article + Images Analysis',
    'instructions': '''
    Analyze the article text and associated images together.
    
    For the article:
    - Extract key topics and overall sentiment
    - Identify main entities (people, organizations, locations)
    
    For each image:
    - Describe what is shown
    - Explain how it relates to the article content
    - Identify any people mentioned in the text who appear in the image
    ''',
    'output_contract': {
        'type': 'object',
        'properties': {
            'document': {
                'type': 'object',
                'properties': {
                    'key_topics': {'type': 'array', 'items': {'type': 'string'}},
                    'overall_sentiment': {'type': 'string'},
                    'main_entities': {
                        'type': 'array',
                        'items': {
                            'type': 'object',
                            'properties': {
                                'name': {'type': 'string'},
                                'type': {'type': 'string'}
                            }
                        }
                    }
                }
            },
            'per_image': {
                'type': 'object',
                'properties': {
                    'description': {'type': 'string'},
                    'relevance': {'type': 'string'},
                    'people_identified': {
                        'type': 'array',
                        'items': {
                            'type': 'object',
                            'properties': {
                                'name': {'type': 'string'},
                                'confidence': {'type': 'number'}
                            }
                        }
                    }
                }
            }
        }
    }
}

# Run with multi-modal configuration
run_config = {
    'name': 'Multi-Modal News Analysis',
    'schema_ids': [multimodal_schema_id],
    'target_asset_ids': web_article_ids,
    'configuration': {
        'model': 'gemini-2.5-flash-preview-05-20',
        'include_images': True,
        'max_images_per_asset': 5,
        'enable_thinking': True
    }
}
```

---

## Advanced Topics

### Custom Validation & Post-Processing

Add custom validation to your schemas:

```python Schema Validation
def validate_annotation_results(annotations):
    """Custom validation for annotation results"""
    validated_results = []
    
    for annotation in annotations:
        if annotation['status'] != 'success':
            continue
            
        value = annotation['value']
        
        # Validate required fields
        if not value.get('policy_positions'):
            print(f"Warning: No policy positions found in asset {annotation['asset_id']}")
            continue
            
        # Validate data quality
        for position in value['policy_positions']:
            if position.get('confidence', 0) < 0.5:
                print(f"Low confidence position in asset {annotation['asset_id']}: {position}")
                
        validated_results.append(annotation)
        
    return validated_results
```

### Schema Versioning & Evolution

Manage schema changes over time:

```python Schema Versioning
# Create new version of existing schema
new_version = existing_schema.copy()
new_version.update({
    'version': '2.0',
    'description': 'Updated to include geographic information',
    'output_contract': {
        # ... existing fields ...
        'geographic_mentions': {
            'type': 'array',
            'items': {
                'type': 'object',
                'properties': {
                    'location': {'type': 'string'},
                    'coordinates': {'type': 'string'},
                    'relevance': {'type': 'string'}
                }
            }
        }
    }
})

# Create new schema version
schema_response = requests.post(f'{base_url}/api/v1/infospaces/{infospace_id}/schemas', 
                               json=new_version)
```

### Batch Processing Strategies

For large-scale analysis:

```python Large Scale Processing
def process_large_dataset(asset_ids, schema_id, batch_size=100):
    """Process large datasets in manageable batches"""
    
    results = []
    
    for i in range(0, len(asset_ids), batch_size):
        batch = asset_ids[i:i+batch_size]
        
        # Create run for this batch
        run_response = requests.post(f'{base_url}/api/v1/infospaces/{infospace_id}/runs', json={
            'name': f'Batch Analysis {i//batch_size + 1}',
            'schema_ids': [schema_id],
            'target_asset_ids': batch,
            'configuration': {
                'model': 'llama3.1:8b',  # Use local model for large batches
                'temperature': 0.1
            }
        })
        
        run_id = run_response.json()['id']
        
        # Monitor batch completion
        while True:
            status = requests.get(f'{base_url}/api/v1/infospaces/{infospace_id}/runs/{run_id}')
            if status.json()['status'] in ['completed', 'completed_with_errors']:
                break
            time.sleep(60)  # Check every minute
        
        # Collect results
        batch_results = requests.get(f'{base_url}/api/v1/infospaces/{infospace_id}/runs/{run_id}/annotations')
        results.extend(batch_results.json()['data'])
        
        print(f"Completed batch {i//batch_size + 1}/{(len(asset_ids)-1)//batch_size + 1}")
        
    return results
```

---

Annotation Schemas and Runs are the core of Open Politics HQ's analytical power. By combining natural language instructions with structured output definitions, you can extract meaningful insights from any type of content at scale.

Next, explore how to interact with your analysis results through [Chat Tools](/chat-tools) or visualize them with [Analysis Dashboards](/dashboards).
