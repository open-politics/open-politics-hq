from opol import OPOL
from pydantic import BaseModel, Field
from typing import List, Tuple, Dict
import os
import numpy as np
from fastapi import APIRouter
import time

## Setup

router = APIRouter()

opol = OPOL(mode=os.getenv("OPOL_MODE"), api_key=os.getenv("OPOL_API_KEY"))

fastclass = opol.classification(provider="Google", 
                                model_name="gemini-2.0-flash", 
                                llm_api_key=os.environ["GOOGLE_API_KEY"]
                                )


## Expand Queries with Opol, Instrutor, Gemini and retrive articles from SearXNG

def expand_query(query: str) -> List[Tuple[Dict, float]]:
    class Query(BaseModel):
        query: str = None
        time_range: str = None
    
    class ExpandedQuery(BaseModel):
        """
        As a political intelligence analyst, 
        your task is to generate a set of three queries that delve deeper into geopolitical dynamics or individual profiles, 
        building upon the initial query and the insights gathered from its search results.

        For geographic queries:
        - Include country, relation level (domestic/international), domain (economics, politics, etc.), and timeframe.

        For individual queries:
        - Include aspects such as biography, political affiliations, and recent activities.

        Ensure that the context of the query is accurately interpreted to avoid incorrect assumptions. 
        If the query pertains to an individual without clear political context, 
        focus on personal aspects without inferring political affiliations or geographic relations unless explicitly stated.

        Examples:

        Geographic Query:
        "French Domestic Politics News November - December 2024"
        Components:
            - Country: France
            - Relation Level: Domestic
            - Domain: Politics
            - Timeframe: November - December 2024

        Individual Query:
        "Luigi Mangione Biography 2024"
        Components:
            - Name: Luigi Mangione
            - Aspect: Biography
            - Timeframe: 2024

        Aim to create queries that progressively explore more specific geopolitical factors, implications, related topics, or individual profiles concerning the initial query. The goal is to anticipate the analyst's potential information needs and guide them towards a more comprehensive understanding of the geopolitical landscape or individual profiles.
        Please match the language of the response to the analyst's language.

        Return three queries.
        Include one timeframe, which is a literal of: [ day, month, year ]
        Each query can have a different request timeframe.
        """
        queries: List[Query]

    current_date = time.strftime("%Y-%m-%d")
    instruction = f"""Generate three detailed queries based on the initial query. 
    For geographic queries, include country, relation level, domain, and timeframe. 
    For individual queries, include relevant aspects such as biography, affiliations, and timeframe.

    Today's date is {current_date}.
    """

    expanded_query = fastclass.classify(ExpandedQuery, instruction, query)

    return expanded_query