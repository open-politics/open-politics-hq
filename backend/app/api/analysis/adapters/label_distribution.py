import logging
from typing import Dict, Any, List, Union, Optional
from collections import Counter
from sqlmodel import Session, select
from app.models import Asset, Annotation, AnnotationRun, AnnotationSchema, User, Bundle  # Ensure User and Bundle are imported
# from app.api.analysis.protocols import AnalysisAdapterProtocol # Import if you want to explicitly inherit, not strictly needed for Protocol adherence

logger = logging.getLogger(__name__)

class LabelDistributionAdapter: # No explicit inheritance from Protocol needed if using structural subtyping
    def __init__(self, 
                 session: Session, 
                 config: Dict[str, Any], 
                 current_user: Optional[User] = None, 
                 infospace_id: Optional[int] = None):
        self.session = session
        self.config = config
        self.current_user = current_user # Store if needed later
        self.infospace_id_context = infospace_id # Store if needed for cross-checks
        
        # Validate config against input_schema_definition (can be done here or by caller)
        self.target_run_id: Optional[int] = config.get("target_run_id")
        self.target_bundle_id: Optional[int] = config.get("target_bundle_id")
        self.target_asset_ids: Optional[List[int]] = config.get("target_asset_ids")

        self.target_schema_id: Optional[int] = config.get("target_schema_id") # Made optional for wider use cases
        self.label_field_key: Optional[str] = config.get("label_field_key")
        self.handle_list_behavior: str = config.get("handle_list_behavior", "count_each_item")
        self.top_n: Optional[int] = config.get("top_n")

        # Refined validation based on what's essential
        if not self.target_run_id:
            raise ValueError("Missing required configuration: target_run_id.")
        if not self.target_schema_id:
            raise ValueError("Missing required configuration: target_schema_id.")
        if not self.label_field_key:
            raise ValueError("Missing required configuration: label_field_key.")

    def _get_value_from_data(self, data_obj: Any, key: str) -> Any:
        if not key or not isinstance(data_obj, dict):
            return None
        
        parts = key.split('.')
        current_value = data_obj
        
        for part in parts:
            if isinstance(current_value, dict):
                current_value = current_value.get(part)
            else:
                return None
            
            if current_value is None:
                break
        return current_value

    async def execute(self) -> Dict[str, Any]:
        logger.info(f"Executing LabelDistributionAdapter for run {self.target_run_id}")

        schema = self.session.get(AnnotationSchema, self.target_schema_id)
        if not schema:
            raise ValueError(f"AnnotationSchema with ID {self.target_schema_id} not found.")

        # Query annotations directly for the specified run and schema
        query = select(Annotation).where(
            Annotation.run_id == self.target_run_id,
            Annotation.schema_id == self.target_schema_id
        )
        annotations_to_process = self.session.exec(query).all()

        if not annotations_to_process:
            return self._empty_result_payload()

        label_counts: Counter = Counter()
        
        for annotation in annotations_to_process:
            value = self._get_value_from_data(annotation.value, self.label_field_key)

            if value is None:
                label_counts["N/A (Field Missing or Path Invalid)"] += 1
                continue

            if isinstance(value, list) and self.handle_list_behavior == "count_each_item":
                if not value:
                    label_counts["N/A (Empty List)"] += 1
                else:
                    for item_in_list in value:
                        label_counts[str(item_in_list if item_in_list is not None else "N/A (Null in List)")] += 1
            elif isinstance(value, list) and self.handle_list_behavior == "stringify_list":
                label_counts[str(value)] += 1
            else:
                label_counts[str(value if value is not None else "N/A (Null Value)")] += 1
        
        total_values_found = sum(label_counts.values())
        total_unique_values_before_top_n = len(label_counts)
        
        sorted_distribution = label_counts.most_common(self.top_n if self.top_n is not None and self.top_n > 0 else None)
        
        distribution_for_output: List[Dict[str, Union[str, int, float]]] = [
            {"value": str(val), "count": count} for val, count in sorted_distribution
        ]

        # Simplified Top-N logic: if top_n is set, the less common items are already excluded by most_common()
        # If we want an "Other" category, the logic would be more complex, but for now this is cleaner.
        
        for item in distribution_for_output:
            item["percentage"] = (item["count"] / total_values_found) * 100 if total_values_found > 0 else 0
            
        return {
            "parameters_used": self.config,
            "field_processed": self.label_field_key,
            "distribution": distribution_for_output,
            "total_objects_processed": len(annotations_to_process),
            "total_values_found": total_values_found,
            "total_unique_values": total_unique_values_before_top_n
        }

    def _empty_result_payload(self) -> Dict[str, Any]:
        return {
            "parameters_used": self.config,
            "field_processed": self.label_field_key,
            "distribution": [],
            "total_objects_processed": 0,
            "total_values_found": 0,
            "total_unique_values": 0,
        } 