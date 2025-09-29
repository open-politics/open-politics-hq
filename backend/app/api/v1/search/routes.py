# from fastapi import APIRouter, HTTPException, Query
# from fastapi.responses import JSONResponse
# import logging
# from enum import Enum
# from typing import Optional, Dict, List
# from pydantic import BaseModel

# import httpx
# import json

# logger = logging.getLogger(__name__)

# router = APIRouter()

# class SearchType(str, Enum):
#     TEXT = "text"
#     SEMANTIC = "semantic"
#     STRUCTURED = "structured"

# @router.get("/contents", response_model=None)
# async def get_contents(
#     search_query: Optional[str] = None,
#     search_type: SearchType = SearchType.SEMANTIC,
#     skip: int = Query(0, ge=0),
#     limit: int = Query(20, ge=1, le=100),
#     news_category: Optional[str] = None,
#     secondary_categories: Optional[List[str]] = Query(None),  # Ensure this is a list
#     keyword: Optional[str] = None,
#     entities: Optional[List[str]] = Query(None),  # Ensure this is a list
#     locations: Optional[List[str]] = Query(None),  # Ensure this is a list
#     topics: Optional[List[str]] = Query(None),  # Ensure this is a list
#     classification_scores: Optional[str] = None,
#     keyword_weights: Optional[str] = None,  # New parameter for keyword weights
#     exclude_keywords: Optional[List[str]] = Query(None),  # Ensure this is a list
# ):
#     try:
#         params = {
#             "search_query": search_query,
#             "skip": skip,
#             "limit": limit,
#             "search_type": search_type.value,
#             "news_category": news_category,
#             "secondary_categories": ",".join(secondary_categories) if secondary_categories else None,  # Convert list to comma-separated string
#             "keyword": keyword,
#             "entities": ",".join(entities) if entities else None,  # Convert list to comma-separated string
#             "locations": ",".join(locations) if locations else None,  # Convert list to comma-separated string
#             "topics": ",".join(topics) if topics else None,  # Convert list to comma-separated string
#             "classification_scores": classification_scores,
#             "keyword_weights": keyword_weights,
#             "exclude_keywords": ",".join(exclude_keywords) if exclude_keywords else None,  # Convert list to comma-separated string
#         }

#         async with httpx.AsyncClient() as client:
#             response = await client.get("http://api.opol.io/postgres-service/contents", params=params)
#             response.raise_for_status()
#             data = response.json()
            
#             # Ensure the response data has the expected structure
#             if not isinstance(data, list):
#                 logger.error(f"Unexpected response format: {data}")
#                 raise HTTPException(status_code=500, detail="Invalid response format from database service")
                
#             return JSONResponse(content=data, status_code=200)
            
#     except httpx.HTTPError as e:
#         logger.error(f"HTTP error occurred while fetching articles: {e}")
#         raise HTTPException(status_code=500, detail="Failed to fetch articles")
#     except Exception as e:
#         logger.error(f"Unexpected error occurred while fetching articles: {e}")
#         raise HTTPException(status_code=500, detail="An unexpected error occurred")

# from pydantic import BaseModel
# from typing import List

# class MostRelevantEntitiesRequest(BaseModel):
#     article_ids: List[str]

# @router.post("/most_relevant_entities")
# async def get_most_relevant_entities(
#     request: MostRelevantEntitiesRequest,
# ):
#     try:
#         async with httpx.AsyncClient() as client:
#             response = await client.post("http://api.opol.io/postgres-service/most_relevant_entities", json=request.dict())
#             response.raise_for_status()
#             return response.json()
#     except httpx.HTTPError as e:
#         logger.error(f"HTTP error occurred while fetching most relevant entities: {e}")
#         raise HTTPException(status_code=500, detail="Failed to fetch most relevant entities")
#     except Exception as e:
#         logger.error(f"Unexpected error occurred while fetching most relevant entities: {e}")
#         raise HTTPException(status_code=500, detail="An unexpected error occurred")


# ## Create Search Routing
# ## We will create a list of
# ## --> Main Location, Relevant Countries, Relevant Entities, Relevant Articles, Relevant Topics

# @router.get("/search_synthesizer")
# async def search_synthesizer(search_query: str):
#    async def get_articles():
#     search_query: Optional[str] = None,

#     class QueryType(str, Enum):
#         TEXT = "text"
#         SEMANTIC = "semantic"
#         STRUCTURED = "structured"

#     class MainLocation(str, Enum):
#         CITY = Optional[str] = None
#         REGION = Optional[str] = None
#         CONTINENT = Optional[str] = None

#     class QueryContext(BaseModel):
#         context: str

#     class Query(BaseModel):
#         query: str
#         query_type: QueryType
#         query_context: Optional[QueryContext] = None

#     class QueryList(BaseModel):
#         queries: List[Query]

#     class Response(BaseModel):
#         Articles: List[Article]
#         Entities: List[Entity]
#         Locations: List[Location]
#         Topics: List[Topic]
#         Score: List[Dict[str, float]]
#         MainLocation: Optional[MainLocation] = None

#     class QueryListResponse(BaseModel):
#         response: List[Response]


#     ## 1 Convert one query to multples
#     ### 1.1 List[Queries]
#     ## 2 Retrieve Articles for queries
#     ## 3 Deduplicate
#     ## 4 Rank
#     ## 5 Return
#     ## Output Scheme    
#     class MultiQuery(BaseModel):
#         "List of queries that expands the search"
#         queries: List[str]

#     class MainLocation(BaseModel):
#         "String of main location. Either City, Region or Continent"
#         query: str


