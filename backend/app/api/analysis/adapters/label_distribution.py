import logging
from typing import Dict, Any, List, Union, Optional
from collections import Counter
from sqlmodel import Session, select
from app.models import Asset, Annotation, AnnotationRun, AnnotationSchema, User, Bundle, AssetBundleLink # Ensure User, Bundle, and AssetBundleLink are imported
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
        if not (self.target_run_id or self.target_bundle_id or self.target_asset_ids):
            raise ValueError("Missing required configuration: one of target_run_id, target_bundle_id, or target_asset_ids must be provided.")
        
        if sum(bool(x) for x in [self.target_run_id, self.target_bundle_id, self.target_asset_ids]) > 1:
            raise ValueError("Provide only one of target_run_id, target_bundle_id, or target_asset_ids.")
        
        if not self.label_field_key:
            raise ValueError("Missing required configuration: label_field_key.")
        
        # target_schema_id is essential if we are looking into annotation.value for the label_field_key
        if self.label_field_key.startswith("annotation_value.") and not self.target_schema_id:
            raise ValueError("target_schema_id is required when label_field_key refers to an annotation's value.")

    def _get_value_from_data(self, data_obj: Any, key: str) -> Any:
        # Handles direct attribute access or dict key access, including dot notation for nested dicts.
        if not key: return None
        
        parts = key.split('.')
        current_value = data_obj
        
        for part in parts:
            if isinstance(current_value, dict):
                current_value = current_value.get(part)
            elif hasattr(current_value, part):
                current_value = getattr(current_value, part)
            else:
                return None # Path invalid or key not found
            
            if current_value is None: # Path was valid up to a point, but resulted in None
                break
        return current_value

    async def execute(self) -> Dict[str, Any]:
        logger.info(f"Executing LabelDistributionAdapter with config: {self.config} by user {self.current_user.id if self.current_user else 'N/A'} in infospace {self.infospace_id_context if self.infospace_id_context else 'N/A'}")

        # Base query on Annotation table if schema_id is provided
        # If label_field_key refers to an Asset attribute, we might start query from Asset table or join differently.
        # This adapter currently focuses on Annotation.value or potentially direct Asset attributes if schema_id is None.

        annotations_to_process: List[Annotation] = []
        source_objects_to_process: List[Union[Asset, Annotation]] = []
        
        field_source_type = "annotation_value" # Default
        actual_label_key = self.label_field_key

        if self.label_field_key.startswith("annotation_value."):
            actual_label_key = self.label_field_key.split("annotation_value.", 1)[1]
            if not self.target_schema_id:
                 raise ValueError("target_schema_id is required to process annotation_value fields.")
            schema = self.session.get(AnnotationSchema, self.target_schema_id)
            if not schema: raise ValueError(f"AnnotationSchema with ID {self.target_schema_id} not found.")
            
            query = select(Annotation).where(Annotation.schema_id == self.target_schema_id)
            source_objects_to_process = self.session.exec(query).all()
            field_source_type = "annotation_value"

        elif self.label_field_key.startswith("asset."):
            actual_label_key = self.label_field_key.split("asset.", 1)[1]
            # If target_schema_id is provided, we might be analyzing assets that *have* such annotations.
            # If not, we are analyzing assets directly.
            query = select(Asset)
            source_objects_to_process = self.session.exec(query).all()
            field_source_type = "asset_attribute"
        else:
            raise ValueError(f"Unsupported label_field_key format: {self.label_field_key}. Must start with 'annotation_value.' or 'asset.'")

        # Filter source_objects based on target_scope (run, bundle, asset_list)
        # This part needs to be robust based on how these scopes relate to Annotations or Assets
        # For simplicity, current logic assumes the primary query above fetches relevant items and then we filter.
        # A more optimized approach might integrate scope into the initial SQL query.

        final_objects_for_counting: List[Any] = []
        if self.target_run_id:
            run = self.session.get(AnnotationRun, self.target_run_id)
            if not run: raise ValueError(f"AnnotationRun ID {self.target_run_id} not found.")
            # Filter objects if they are annotations and belong to the run
            if field_source_type == "annotation_value":
                final_objects_for_counting = [obj for obj in source_objects_to_process if isinstance(obj, Annotation) and obj.run_id == self.target_run_id]
            else: # asset attribute - need to get assets linked to run (e.g. via annotations in run)
                asset_ids_in_run = self.session.exec(select(Annotation.asset_id).where(Annotation.run_id == self.target_run_id).distinct()).all()
                final_objects_for_counting = [obj for obj in source_objects_to_process if isinstance(obj, Asset) and obj.id in asset_ids_in_run]

        elif self.target_asset_ids:
            if not self.target_asset_ids: raise ValueError("target_asset_ids list cannot be empty.")
            final_objects_for_counting = [obj for obj in source_objects_to_process if obj.id in self.target_asset_ids] 
        
        elif self.target_bundle_id:
            # This logic is complex and depends on Bundle model structure and relationships
            bundle = self.session.get(Bundle, self.target_bundle_id)
            if not bundle: raise ValueError(f"Bundle ID {self.target_bundle_id} not found.")
            
            # Ensure bundle is in the correct infospace if context is available
            if self.infospace_id_context and bundle.infospace_id != self.infospace_id_context:
                raise ValueError(f"Bundle {self.target_bundle_id} is not in the current infospace context.")

            asset_ids_in_bundle = [asset.id for asset in bundle.assets]
            if not asset_ids_in_bundle: return self._empty_result_payload()

            if field_source_type == "annotation_value":
                 # Filter annotations that are linked to assets in the bundle
                 final_objects_for_counting = [obj for obj in source_objects_to_process if isinstance(obj, Annotation) and obj.asset_id in asset_ids_in_bundle]
            elif field_source_type == "asset_attribute":
                 # Filter assets that are in the bundle
                 final_objects_for_counting = [obj for obj in source_objects_to_process if isinstance(obj, Asset) and obj.id in asset_ids_in_bundle]
        else:
             final_objects_for_counting = source_objects_to_process # Use all if no specific scope filter beyond initial query

        if not final_objects_for_counting:
            return self._empty_result_payload()

        label_counts: Counter = Counter()
        total_objects_processed = 0
        
        for item_to_process in final_objects_for_counting:
            data_source_dict = None
            if field_source_type == "annotation_value" and isinstance(item_to_process, Annotation):
                data_source_dict = item_to_process.value # This should be a dict
            elif field_source_type == "asset_attribute" and isinstance(item_to_process, Asset):
                data_source_dict = item_to_process # We'll use getattr on the Asset object itself
            else:
                continue # Should not happen if logic above is correct

            if field_source_type == "annotation_value" and not isinstance(data_source_dict, dict):
                # This specific annotation has a non-dict value, cannot process further for keys
                label_counts["N/A (Annotation Value Not a Dict)"] += 1
                total_objects_processed +=1
                continue
            
            total_objects_processed += 1
            value = self._get_value_from_data(data_source_dict, actual_label_key)

            if value is None:
                label_counts["N/A (Field Missing or Path Invalid)"] += 1
                continue

            if isinstance(value, list) and self.handle_list_behavior == "count_each_item":
                if not value: label_counts["N/A (Empty List)"] +=1
                else:
                    for item_in_list in value:
                        label_counts[str(item_in_list if item_in_list is not None else "N/A (Null in List)")] += 1
            elif isinstance(value, list) and self.handle_list_behavior == "stringify_list":
                label_counts[str(value)] += 1
            else:
                label_counts[str(value if value is not None else "N/A (Null Value)")] += 1
        
        total_values_found = sum(label_counts.values())
        total_unique_values_before_top_n = len(label_counts)
        
        sorted_distribution = label_counts.most_common()
        distribution_for_output: List[Dict[str, Union[str, int, float]]] = []

        if self.top_n is not None and len(sorted_distribution) > self.top_n and self.top_n > 0:
            num_top_items = max(0, self.top_n - 1) 
            top_n_items = sorted_distribution[:num_top_items]
            other_sum = sum(count for _, count in sorted_distribution[num_top_items:])
            distribution_for_output = [{"value": str(val), "count": count} for val, count in top_n_items]
            if other_sum > 0: distribution_for_output.append({"value": "Other", "count": other_sum})
        else:
            distribution_for_output = [{"value": str(val), "count": count} for val, count in sorted_distribution]

        for item in distribution_for_output:
            item["percentage"] = (item["count"] / total_values_found) * 100 if total_values_found > 0 else 0
            
        return {
            "parameters_used": self.config,
            "field_processed": self.label_field_key,
            "distribution": distribution_for_output,
            "total_objects_processed": total_objects_processed,
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