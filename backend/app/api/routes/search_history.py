from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from sqlalchemy import func

from app.api.deps import CurrentUser, SessionDep
from app.models import SearchHistory
from app.schemas import SearchHistoryCreate, SearchHistoriesOut, SearchHistoryOut

router = APIRouter()


@router.post("/create", response_model=SearchHistoryOut)
def create_search_history(
    *, session: SessionDep, current_user: CurrentUser, search_history_in: SearchHistoryCreate
) -> Any:
    """
    Create a new search history entry.
    """
    search_history = SearchHistory.model_validate(search_history_in, update={"user_id": current_user.id})
    session.add(search_history)
    session.commit()
    session.refresh(search_history)
    return search_history


@router.get("/read", response_model=SearchHistoriesOut)
def read_search_histories(
    *, session: SessionDep, current_user: CurrentUser, skip: int = 0, limit: int = 100
) -> Any:
    """
    Retrieve search histories for the current user.
    """
    statement = select(SearchHistory).where(SearchHistory.user_id == current_user.id).offset(skip).limit(limit)
    histories = session.exec(statement).all()
    count_statement = select(func.count()).where(SearchHistory.user_id == current_user.id)
    count = session.exec(count_statement).one()
    return SearchHistoriesOut(data=histories, count=count)