import logging
from typing import Dict, Any, List, Union, Optional
from collections import defaultdict
from datetime import datetime # Keep datetime for general use
import pandas as pd

from sqlmodel import Session, select
from app.models import Annotation, AnnotationRun, AnnotationSchema, Asset, User, Bundle # Ensure User and Bundle are imported
# from app.api.analysis.protocols import AnalysisAdapterProtocol # Optional for structural typing

logger = logging.getLogger(__name__)

class TimeSeriesAggregationAdapter: # No explicit inheritance for structural typing
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
        self.target_schema_id: Optional[int] = config.get("target_schema_id")
        self.timestamp_source_field: Optional[str] = config.get("timestamp_source_field")
        self.value_field_key: Optional[str] = config.get("value_field_key")
        self.aggregation_functions: List[str] = config.get("aggregation_functions", ["count"])
        self.time_bucket: str = config.get("time_bucket", "day")
        self.split_by_source_id: bool = config.get("split_by_source_id", False)
        self.fill_missing_intervals: bool = config.get("fill_missing_intervals", False)
        self.date_range_start: Optional[str] = config.get("date_range_start")
        self.date_range_end: Optional[str] = config.get("date_range_end")

        if not self.target_run_id:
            raise ValueError("Missing required configuration: target_run_id.")
        if not self.target_schema_id:
            raise ValueError("Missing required configuration: target_schema_id.")
        if not self.timestamp_source_field:
            raise ValueError("Missing required configuration: timestamp_source_field.")
        if not self.aggregation_functions:
            logger.warning("No aggregation functions specified, defaulting to ['count']")
            self.aggregation_functions = ["count"]

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
            if current_value is None: break
        return current_value

    async def execute(self) -> Dict[str, Any]:
        logger.info(f"Executing TimeSeriesAggregationAdapter for run {self.target_run_id}")

        schema = self.session.get(AnnotationSchema, self.target_schema_id)
        if not schema:
            raise ValueError(f"AnnotationSchema with ID {self.target_schema_id} not found.")

        query_elements = [
            Annotation.id,
            Annotation.timestamp,
            Annotation.value,
            Annotation.asset_id,
            Asset.source_id, 
            Asset.event_timestamp,
            Asset.created_at
        ]
        
        base_query = select(*query_elements).join(Asset, Annotation.asset_id == Asset.id).where(
            Annotation.run_id == self.target_run_id,
            Annotation.schema_id == self.target_schema_id
        )

        results = self.session.exec(base_query).all()

        if not results:
            return {"parameters_used": self.config, "time_series_data": [], "summary_statistics": {}}

        processed_data = []
        for ann_id, ann_ts, ann_val, asset_id, asset_source_id, asset_event_ts, asset_created_at in results:
            ts_val_str: Any = None
            
            if self.timestamp_source_field.startswith("annotation_value."):
                key = self.timestamp_source_field.split("annotation_value.", 1)[1]
                ts_val_str = self._get_value_from_data(ann_val, key)
            elif self.timestamp_source_field == "annotation.timestamp":
                ts_val_str = ann_ts
            elif self.timestamp_source_field == "asset.event_timestamp":
                ts_val_str = asset_event_ts
            elif self.timestamp_source_field == "asset.created_at":
                ts_val_str = asset_created_at
            
            ts_val: Optional[pd.Timestamp] = None
            if ts_val_str is not None:
                try:
                    if isinstance(ts_val_str, datetime):
                        ts_val = pd.Timestamp(ts_val_str, tz='UTC')
                    else:
                        ts_val = pd.to_datetime(str(ts_val_str), errors='coerce', utc=True)
                    if pd.isna(ts_val): ts_val = None
                except Exception:
                    ts_val = None
            
            if not ts_val:
                continue

            record: Dict[str, Any] = {"timestamp": ts_val, "annotation_id": ann_id}
            if self.split_by_source_id:
                record["source_id"] = asset_source_id
            
            if self.value_field_key:
                val_to_agg = self._get_value_from_data(ann_val, self.value_field_key)
                record["value_to_aggregate"] = pd.to_numeric(val_to_agg, errors='coerce')
            
            processed_data.append(record)

        if not processed_data:
            return {"parameters_used": self.config, "time_series_data": [], "summary_statistics": {}}

        df = pd.DataFrame(processed_data)
        df.set_index("timestamp", inplace=True)

        if self.date_range_start:
            df = df[df.index >= pd.to_datetime(self.date_range_start, utc=True)]
        if self.date_range_end:
            df = df[df.index <= pd.to_datetime(self.date_range_end, utc=True)]
        
        if df.empty:
            return {"parameters_used": self.config, "time_series_data": [], "summary_statistics": {}}

        agg_config = {"count": pd.NamedAgg(column="annotation_id", aggfunc='count')}
        if self.value_field_key and 'value_to_aggregate' in df:
            if "sum" in self.aggregation_functions: agg_config["sum"] = pd.NamedAgg(column="value_to_aggregate", aggfunc='sum')
            if "avg" in self.aggregation_functions: agg_config["avg"] = pd.NamedAgg(column="value_to_aggregate", aggfunc='mean')
            if "min" in self.aggregation_functions: agg_config["min"] = pd.NamedAgg(column="value_to_aggregate", aggfunc='min')
            if "max" in self.aggregation_functions: agg_config["max"] = pd.NamedAgg(column="value_to_aggregate", aggfunc='max')

        group_by_keys = []
        if self.split_by_source_id and "source_id" in df.columns:
            group_by_keys.append("source_id")

        bucket_map = {"day": "D", "week": "W-MON", "month": "ME", "quarter": "QE", "year": "YE"}
        resample_freq = bucket_map.get(self.time_bucket)

        if resample_freq:
            resampler = df.groupby(group_by_keys).resample(resample_freq) if group_by_keys else df.resample(resample_freq)
            aggregated_df = resampler.agg(**agg_config).reset_index()
        else: # Handle 'raw' case
            group_cols = ['timestamp'] + group_by_keys
            aggregated_df = df.reset_index().groupby(group_cols).agg(**agg_config).reset_index()

        time_series_data = []
        for _, row in aggregated_df.iterrows():
            data_point = row.to_dict()
            data_point["timestamp"] = pd.Timestamp(row["timestamp"]).isoformat()
            time_series_data.append(data_point)

        summary_stats = {}
        if self.value_field_key and 'value_to_aggregate' in df:
            valid_values = df["value_to_aggregate"].dropna()
            if not valid_values.empty:
                summary_stats = {
                    "overall_min": float(valid_values.min()),
                    "overall_max": float(valid_values.max()),
                    "overall_avg": float(valid_values.mean()),
                    "overall_sum": float(valid_values.sum()),
                    "overall_count": int(valid_values.count()),
                    "value_field_processed": self.value_field_key
                }
        
        summary_stats["total_annotations_considered"] = len(results)
        summary_stats["total_annotations_with_valid_timestamp"] = len(processed_data)

        return {
            "parameters_used": self.config,
            "time_series_data": time_series_data,
            "summary_statistics": summary_stats
        } 