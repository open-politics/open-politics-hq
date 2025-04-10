from sqlmodel import Session, select
from typing import Any, Dict, Optional, Union

from app.crud.base import CRUDBase
from app.models import ClassificationRun, ClassificationRunCreate, User

class CRUDClassificationRun(CRUDBase[ClassificationRun, ClassificationRunCreate, ClassificationRunCreate]): # Using Create schema for Update for now
    def create_with_owner(self, db: Session, *, obj_in: ClassificationRunCreate, user_id: int) -> ClassificationRun:
        """
        Create a new classification run, explicitly setting the user_id.
        """
        # Convert Pydantic model to dict
        obj_in_data = obj_in.model_dump()
        # Create DB model instance, adding user_id
        db_obj = self.model(**obj_in_data, user_id=user_id)
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    # You can override or add other methods here if needed, for example:
    # def get_multi_by_owner(...)
    # def update(...)

classification_run = CRUDClassificationRun(ClassificationRun) 