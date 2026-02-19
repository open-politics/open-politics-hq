import logging
from typing import Dict, Any, List, Optional
from sqlmodel import Session, select
from app.models import Annotation, AnnotationRun, User
from app.api.analysis.protocols import AnalysisAdapterProtocol
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

class AlertingAdapter(AnalysisAdapterProtocol):
    """
    Analyzes annotations from a given run and generates alerts based on configurable conditions.
    """
    def __init__(self, 
                 session: Session, 
                 config: Dict[str, Any], 
                 current_user: Optional[User] = None, 
                 infospace_id: Optional[int] = None):
        self.session = session
        self.config = config
        self.current_user = current_user
        self.infospace_id_context = infospace_id

        self.target_run_id: Optional[int] = config.get("target_run_id")
        self.alert_conditions: List[Dict[str, Any]] = config.get("alert_conditions", [])

        if not self.target_run_id:
            raise ValueError("Missing required configuration: 'target_run_id' must be provided.")
        if not self.alert_conditions:
            raise ValueError("Missing required configuration: 'alert_conditions' cannot be empty.")

    def _evaluate_condition(self, value: Any, condition: Dict[str, Any]) -> bool:
        """Evaluates a single condition against a given value."""
        operator = condition.get("operator")
        condition_value = condition.get("value")

        if operator is None or condition_value is None:
            return False

        if isinstance(value, str):
            if operator == "contains":
                return str(condition_value).lower() in value.lower()
            if operator == "not_contains":
                return str(condition_value).lower() not in value.lower()
        
        if isinstance(value, (int, float)):
            if operator == ">=":
                return value >= condition_value
            if operator == ">":
                return value > condition_value
            if operator == "<=":
                return value <= condition_value
            if operator == "<":
                return value < condition_value
            if operator == "==":
                return value == condition_value
        
        return False

    async def execute(self) -> Dict[str, Any]:
        logger.info(f"Executing AlertingAdapter for AnnotationRun ID: {self.target_run_id}")

        run = self.session.get(AnnotationRun, self.target_run_id)
        if not run:
            raise ValueError(f"AnnotationRun with ID {self.target_run_id} not found.")
        
        # Security check: ensure the run belongs to the current infospace context if provided
        if self.infospace_id_context and run.infospace_id != self.infospace_id_context:
            raise ValueError(f"AnnotationRun {run.id} does not belong to the current infospace.")

        # Fetch all annotations for the run
        annotations_query = select(Annotation).where(Annotation.run_id == self.target_run_id)
        annotations = self.session.exec(annotations_query).all()
        
        alerts_triggered = []
        total_annotations_evaluated = len(annotations)
        annotations_triggering_alerts = set()

        for condition_set in self.alert_conditions:
            field_path = condition_set.get("field")
            condition_logic = condition_set.get("condition")
            
            if not field_path or not condition_logic:
                logger.warning(f"Skipping invalid alert condition: {condition_set}")
                continue

            for annotation in annotations:
                annotation_value_dict = annotation.value or {}
                
                # Simple dot notation navigation for nested fields
                keys = field_path.split('.')
                current_value = annotation_value_dict
                try:
                    for key in keys:
                        current_value = current_value[key]
                except (KeyError, TypeError):
                    continue # Field not present in this annotation, skip to next

                if self._evaluate_condition(current_value, condition_logic):
                    alert = {
                        "alert_name": condition_set.get("name", f"Alert on {field_path}"),
                        "triggered_at": datetime.now(timezone.utc).isoformat(),
                        "annotation_id": annotation.id,
                        "asset_id": annotation.asset_id,
                        "field": field_path,
                        "value": current_value,
                        "condition": condition_logic,
                    }
                    alerts_triggered.append(alert)
                    annotations_triggering_alerts.add(annotation.id)

        logger.info(f"AlertingAdapter finished. Evaluated {total_annotations_evaluated} annotations, triggered {len(alerts_triggered)} alerts.")
        
        return {
            "parameters_used": self.config,
            "summary": {
                "target_run_id": self.target_run_id,
                "total_annotations_evaluated": total_annotations_evaluated,
                "total_alerts_triggered": len(alerts_triggered),
                "unique_annotations_triggering_alerts": len(annotations_triggering_alerts),
            },
            "alerts": alerts_triggered
        } 