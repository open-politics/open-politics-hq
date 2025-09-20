from app.models import (
    User,
    AnalysisAdapter,
    # ... other models
)
from app.api.analysis.adapters.rag_adapter import RAGAdapter
from app.api.analysis.adapters.promote_field_adapter import PromoteFieldAdapter

def init_db(session: Session) -> None:
    # Register RAGAdapter
    rag_adapter_entry = session.exec(
        select(AnalysisAdapter).where(AnalysisAdapter.name == "RAGAdapter")
    ).first()
    if not rag_adapter_entry:
        rag_adapter_entry = AnalysisAdapter(
            name="RAGAdapter",
            description="RAGAdapter",
            module_path="app.api.analysis.adapters.rag_adapter.RAGAdapter",
            adapter_type="curation",
            is_public=True,
            creator_user_id=user.id,
        )
        session.add(rag_adapter_entry)

    # Register PromoteFieldAdapter
    promote_adapter_entry = session.exec(
        select(AnalysisAdapter).where(AnalysisAdapter.name == "PromoteFieldAdapter")
    ).first()
    if not promote_adapter_entry:
        promote_adapter_entry = AnalysisAdapter(
            name="PromoteFieldAdapter",
            description="Promotes a field from an annotation value to a core asset field.",
            module_path="app.api.analysis.adapters.promote_field_adapter.PromoteFieldAdapter",
            adapter_type="curation",
            is_public=True,
            creator_user_id=user.id,
        )
        session.add(promote_adapter_entry)

    session.commit()
    logger.info("Database initialization complete.")

