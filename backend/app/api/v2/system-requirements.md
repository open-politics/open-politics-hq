

1. Broad Vector Stores
2. Specific Scrape Jobs
3. Search & Ingest
4. Classify, Stor

Engines
Quick Search:
Result: Lists of Entries
- Opol (Open Politics Data Engine)
- SearXng (OSS Google, Wikipedia Proxy)
- Tavily (Proprietary Engine)
- OWLER (EU Webindex)

--> Press into one unified Ingestion Format

Classification
via Natural Language "Pydantic Models"
Model-Field Architecture
Result Types:
- int
- List[str]
- Dict[str, any]
- ...

Classification(BaseModel):
    """ What is the top location and the content relevance?"""
    topLoc: str = Field(description="Main Geo Entity")
    relevance: int = Field(description="From a political news perspective, 1-10")

input = "Your input text here" 

classification_result = opol.classify(Classification, "No extra instruction", input)

assert isinstance(classification_result, Classification)

Creating structured data types via nlp pydantic models. A regular "response" or question answering would be a string field. Quotes and similar would be complex dicts.

--> Classifying system working on any text-based content. In last instance everything can be collapsed into pure text input. Lots of articles, csv rows, pdf files or raw scrapes.

+ Certain special extractions like locations or timestamps (asking to model to find it from the text) result in special analysis and display options. Int (numeric dimensions), str (plain setence,  single word or abstract answers) and List[str] (often labels or quotes). Sorting via numerics, counting labels, using locations or using timestamps to place it correctly for time-series analysis.


Ingestion:
Works from a model where a data source can hold many data records. This allows for a upload of multiple pdfs, scraping multple urls, or unrolling data from a csv.

Ingestion schould also be considered in a queue-worker based way like celery to allow special recurring tasks. At the moment this is only limitied to patterns of executing search and ingestion tasks.
Either a url list specified by the user, a search through search engines (resulting in url lists) in data sources would create new records according to the results of scheduled re-fetching.

Tasks like searching ingestion and classification should be manageable packed into classes. We need to swiftly integrate new engines. The first difficulty is pressing many result formats into one. 

Afterwards our classification system will need to recieve a unified adapter.

The results are standardisable because they are just the same as what pydantic models can yield as results.

The results are analysable in the frontend. But we need to be able to share data sources, schemas and runs/ results to others. Analysis/ research operations need to be transparently transferable and retraceble so every analysis becomes evidence.

Our tasks/ functions should be executable in a framework of organised operations. A search could be user initiated or packed as a task of a running data operation.
A task should be ad-hoc callable, run regularly or invoked as an llm tool call. So async it is.