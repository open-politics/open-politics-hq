from opol import OPOL
from pydantic import BaseModel, Field
from typing import List, Tuple, Dict, Any
import os
import asyncio
import numpy as np
from fastapi import APIRouter

from app.api.v2.tasks.llm_query_expansion.political_websearcher import expand_query

## Setup

router = APIRouter()

opol = OPOL(mode="remote", api_key=os.environ["OPOL_API_KEY"])

fastclass = opol.classification(provider="Google", 
                                model_name="gemini-2.0-flash", 
                                llm_api_key=os.environ["GOOGLE_API_KEY"]
                                )


## Expand Queries with Opol, Instrutor, Gemini and retrive articles from SearXNG

@router.post("/report")
async def report(query: str):

    # These are just for illustration of the response structure, since it's pydantic we index with a . for the fields and not with [] like in a list or dict
    class Query(BaseModel):
        query: str = Field(description="The query to search for")
        time_range: str = Field(description="The time range to search for")

    class NewsResponse(BaseModel):
        queries: List[Query] = Field(description="The queries that were used to search for news")
        news: Any = Field(description="The news articles retrieved")

    expanded_queries = expand_query(query)
    queries = expanded_queries.queries
    news = await asyncio.gather(*[opol.search.engine(query.query, query.time_range) for query in queries])

    return NewsResponse(queries=queries, news=news)