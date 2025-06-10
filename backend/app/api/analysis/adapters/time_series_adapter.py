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

        self.target_scope: Optional[str] = config.get("target_scope")
        if not self.target_scope:
            raise ValueError("Missing required config: target_scope")
            
        self.target_id: Optional[Union[int, List[int]]] = config.get("target_id")
        if not self.target_id:
            raise ValueError("Missing required config: target_id")

        self.target_schema_id: Optional[int] = config.get("target_schema_id")
        
        self.timestamp_source_field: Optional[str] = config.get("timestamp_source_field")
        if not self.timestamp_source_field:
            raise ValueError("Missing required config: timestamp_source_field")

        self.value_field_key: Optional[str] = config.get("value_field_key")
        self.aggregation_functions: List[str] = config.get("aggregation_functions", ["count"])
        self.time_bucket: str = config.get("time_bucket", "day")
        self.split_by_source_id: bool = config.get("split_by_source_id", False)
        self.fill_missing_intervals: bool = config.get("fill_missing_intervals", False)
        self.date_range_start: Optional[str] = config.get("date_range_start")
        self.date_range_end: Optional[str] = config.get("date_range_end")

        if self.timestamp_source_field.startswith("annotation_value.") and not self.target_schema_id:
            raise ValueError("target_schema_id is required when timestamp_source_field is from annotation_value")
        if self.value_field_key and self.value_field_key.startswith("annotation_value.") and not self.target_schema_id:
             raise ValueError("target_schema_id is required when value_field_key refers to an annotation's value.")

        if self.target_scope == "asset_list" and not (isinstance(self.target_id, list) and all(isinstance(i, int) for i in self.target_id)):
            raise ValueError("target_id must be a list of integers for asset_list scope.")
        if self.target_scope != "asset_list" and not isinstance(self.target_id, int):
            raise ValueError("target_id must be an integer for run or bundle scope.")
        if not self.aggregation_functions:
            logger.warning("No aggregation functions specified, defaulting to ['count']")
            self.aggregation_functions = ["count"]

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
                return None 
            if current_value is None: break
        return current_value

    async def execute(self) -> Dict[str, Any]:
        logger.info(f"Executing TimeSeriesAggregationAdapter with config: {self.config}")

        schema = None
        if self.target_schema_id:
            schema = self.session.get(AnnotationSchema, self.target_schema_id)
            if not schema:
                raise ValueError(f"AnnotationSchema with ID {self.target_schema_id} not found.")

        query_elements = [
            Annotation.id.label("annotation_id"),
            Annotation.timestamp.label("annotation_timestamp"),
            Annotation.value.label("annotation_value"),
            Annotation.asset_id.label("asset_id"),
            Asset.source_id.label("asset_source_id"), 
            Asset.event_timestamp.label("asset_event_timestamp"), 
            Asset.created_at.label("asset_created_at")
        ]
        
        base_query = select(*query_elements).join(Asset, Annotation.asset_id == Asset.id)

        if self.target_schema_id:
            base_query = base_query.where(Annotation.schema_id == self.target_schema_id)

        if self.target_scope == "run" and isinstance(self.target_id, int):
            run = self.session.get(AnnotationRun, self.target_id)
            if not run: raise ValueError(f"AnnotationRun ID {self.target_id} not found.")
            if schema and run.infospace_id != schema.infospace_id: # Check if schema is infospace specific
                 logger.warning(f"Run {self.target_id} and Schema {self.target_schema_id} might be from different infospaces.")
            base_query = base_query.where(Annotation.run_id == self.target_id)
        elif self.target_scope == "asset_list" and isinstance(self.target_id, list):
            if not self.target_id : raise ValueError("Asset ID list cannot be empty for asset_list scope.")
            base_query = base_query.where(Annotation.asset_id.in_(self.target_id))
        elif self.target_scope == "bundle" and isinstance(self.target_id, int):
            bundle = self.session.get(Bundle, self.target_id)
            if not bundle:
                raise ValueError(f"Bundle ID {self.target_id} not found.")
            
            if self.infospace_id_context and bundle.infospace_id != self.infospace_id_context:
                raise ValueError(f"Bundle {self.target_id} is not in the current infospace context.")
            
            asset_ids_in_bundle = [asset.id for asset in bundle.assets]
            if not asset_ids_in_bundle:
                logger.info(f"Bundle {self.target_id} contains no assets. Returning empty result.")
                return {"parameters_used": self.config, "time_series_data": [], "summary_statistics": {}}

            base_query = base_query.where(Annotation.asset_id.in_(asset_ids_in_bundle))
        else:
            raise ValueError(f"Invalid target_scope ('{self.target_scope}') or target_id type ('{type(self.target_id)}') combination.")

        results = self.session.exec(base_query).mappings().all()

        if not results:
            return {"parameters_used": self.config, "time_series_data": [], "summary_statistics": {}}

        processed_data = []
        for row_dict in results:
            ts_val_str: Any = None 
            ts_val: Optional[pd.Timestamp] = None
            
            source_object_for_ts = None
            ts_key_for_getattr = None

            if self.timestamp_source_field.startswith("annotation_value."):
                key = self.timestamp_source_field.split("annotation_value.", 1)[1]
                ts_val_str = self._get_value_from_data(row_dict.get("annotation_value"), key)
            elif self.timestamp_source_field == "annotation.timestamp":
                ts_val_str = row_dict.get("annotation_timestamp")
            elif self.timestamp_source_field == "asset.event_timestamp":
                ts_val_str = row_dict.get("asset_event_timestamp")
            elif self.timestamp_source_field == "asset.created_at":
                ts_val_str = row_dict.get("asset_created_at")
            else:
                 logger.warning(f"Unknown timestamp_source_field format: {self.timestamp_source_field}")
            
            if ts_val_str is not None:
                try: 
                    if isinstance(ts_val_str, datetime):
                        ts_val = pd.Timestamp(ts_val_str, tz='UTC') # Ensure timezone aware
                    else:
                        ts_val = pd.Timestamp(str(ts_val_str)) # Let pandas handle various string formats
                        if ts_val.tzinfo is None: # Naive datetime, assume UTC
                            ts_val = ts_val.tz_localize('UTC')
                    if pd.isna(ts_val): ts_val = None 
                except Exception as e:
                    logger.debug(f"Could not parse timestamp string '{ts_val_str}' for ann_id {row_dict.get('annotation_id')}: {e}")
                    ts_val = None
            
            if not ts_val:
                logger.debug(f"Skipping ann_id {row_dict.get('annotation_id')} due to missing/invalid ts from '{self.timestamp_source_field}' (val: '{ts_val_str}')")
                continue 

            record: Dict[str, Any] = {"timestamp": ts_val, "annotation_id": row_dict.get("annotation_id")}
            if self.split_by_source_id:
                record["source_id"] = row_dict.get("asset_source_id")
            
            if self.value_field_key:
                value_source_object = None
                actual_value_key = self.value_field_key

                if self.value_field_key.startswith("annotation_value."):
                    actual_value_key = self.value_field_key.split("annotation_value.",1)[1]
                    value_source_object = row_dict.get("annotation_value")
                elif self.value_field_key.startswith("asset."):
                    actual_value_key = self.value_field_key.split("asset.",1)[1]
                    # We need the Asset object itself for getattr, or its dict representation if available.
                    # For now, we don't have the full Asset object here, only selected fields.
                    # This needs Asset object to be fetched or its relevant field pre-selected in query_elements.
                    # Let's assume for now if asset.X is used, it was part of query_elements with that label.
                    if actual_value_key in row_dict: # Check if pre-selected via label
                        value_source_object = row_dict
                    else:
                        logger.warning(f"Asset attribute '{actual_value_key}' for value_field_key not directly available in fetched row_dict. Full Asset fetch might be needed.")
                        value_source_object = None 
                else:
                    # Assuming it's a key within annotation_value if no prefix
                    value_source_object = row_dict.get("annotation_value")

                val_to_agg = self._get_value_from_data(value_source_object, actual_value_key)
                
                if val_to_agg is not None:
                    try: record["value_to_aggregate"] = pd.to_numeric(val_to_agg, errors='coerce')
                    except Exception: record["value_to_aggregate"] = pd.NA 
                else:
                    record["value_to_aggregate"] = pd.NA 
            
            processed_data.append(record)

        if not processed_data:
            return {"parameters_used": self.config, "time_series_data": [], "summary_statistics": {}}

        df = pd.DataFrame(processed_data)
        if df.empty or df['timestamp'].isna().all(): 
             return {"parameters_used": self.config, "time_series_data": [], "summary_statistics": {}}
        df = df.dropna(subset=["timestamp"])
        if df.empty: return {"parameters_used": self.config, "time_series_data": [], "summary_statistics": {}}

        df.set_index("timestamp", inplace=True)

        min_obs_date, max_obs_date = df.index.min(), df.index.max()
        if self.date_range_start:
            try: 
                start_filter_date = pd.to_datetime(self.date_range_start, errors='coerce').tz_localize('UTC')
                if not pd.isna(start_filter_date): df = df[df.index >= start_filter_date]
            except Exception: logger.warning(f"Invalid date_range_start: {self.date_range_start}")
        if self.date_range_end:
            try: 
                end_filter_date = pd.to_datetime(self.date_range_end, errors='coerce').tz_localize('UTC')
                if not pd.isna(end_filter_date): df = df[df.index <= end_filter_date]
            except Exception: logger.warning(f"Invalid date_range_end: {self.date_range_end}")
        
        if df.empty: return {"parameters_used": self.config, "time_series_data": [], "summary_statistics": {}}

        agg_config: Dict[str, Any] = {}
        agg_config["count"] = pd.NamedAgg(column="annotation_id", aggfunc='count')
        
        if self.value_field_key and "value_to_aggregate" in df.columns and df["value_to_aggregate"].notna().any():
            if "sum" in self.aggregation_functions: agg_config["sum"] = pd.NamedAgg(column="value_to_aggregate", aggfunc='sum')
            if "avg" in self.aggregation_functions: agg_config["avg"] = pd.NamedAgg(column="value_to_aggregate", aggfunc='mean')
            if "min" in self.aggregation_functions: agg_config["min"] = pd.NamedAgg(column="value_to_aggregate", aggfunc='min')
            if "max" in self.aggregation_functions: agg_config["max"] = pd.NamedAgg(column="value_to_aggregate", aggfunc='max')
        
        group_by_keys = []
        if self.split_by_source_id and "source_id" in df.columns:
            group_by_keys.append("source_id")

        bucket_map = {"day": "D", "week": "W-MON", "month": "ME", "quarter": "QE", "year": "YE", "raw": None}
        resample_freq = bucket_map.get(self.time_bucket)
        
        if resample_freq:
            resampler = df.groupby(group_by_keys).resample(resample_freq) if group_by_keys else df.resample(resample_freq)
            aggregated_df = resampler.agg(agg_config).reset_index()
        else: 
            temp_group_col = 'exact_timestamp_group' if not group_by_keys else None
            if temp_group_col:
                df[temp_group_col] = df.index
                effective_group_by_keys = [temp_group_col] + group_by_keys
            else:
                effective_group_by_keys = [pd.Grouper(level='timestamp')] + group_by_keys 
            aggregated_df = df.groupby(effective_group_by_keys).agg(agg_config).reset_index()
            if temp_group_col and temp_group_col in aggregated_df.columns:
                aggregated_df.rename(columns={temp_group_col: "timestamp"}, inplace=True)

        if self.fill_missing_intervals and resample_freq and not aggregated_df.empty:
            final_min_date = pd.to_datetime(self.date_range_start, errors='coerce', utc=True) if self.date_range_start else min_obs_date
            final_max_date = pd.to_datetime(self.date_range_end, errors='coerce', utc=True) if self.date_range_end else max_obs_date
            
            if pd.NaT not in [final_min_date, final_max_date] and final_min_date <= final_max_date:
                if self.split_by_source_id and "source_id" in aggregated_df.columns:
                    all_filled_dfs = []
                    for source_val, group_df in aggregated_df.groupby("source_id"):
                        group_df = group_df.set_index('timestamp')
                        idx = pd.date_range(start=final_min_date, end=final_max_date, freq=resample_freq, tz='UTC')
                        group_df = group_df.reindex(idx)
                        group_df['source_id'] = source_val 
                        all_filled_dfs.append(group_df)
                    if all_filled_dfs:
                        aggregated_df = pd.concat(all_filled_dfs).reset_index().rename(columns={'index': 'timestamp'})
                else:
                    aggregated_df = aggregated_df.set_index('timestamp')
                    idx = pd.date_range(start=final_min_date, end=final_max_date, freq=resample_freq, tz='UTC')
                    aggregated_df = aggregated_df.reindex(idx).reset_index().rename(columns={'index': 'timestamp'})
                
                fill_values:Dict[str, Any] = {col: 0 for col, agg_tuple in agg_config.items() if agg_tuple[1] == 'count'}
                for col, agg_tuple in agg_config.items():
                    if agg_tuple[1] != 'count' and col in aggregated_df.columns:
                        fill_values[col] = None 
                aggregated_df.fillna(value=fill_values, inplace=True)
                if 'count' in aggregated_df.columns: aggregated_df['count'] = aggregated_df['count'].astype(int)

        if self.time_bucket == 'raw':
            id_collector = df.groupby(df.index if not group_by_keys else [df.index] + group_by_keys)['annotation_id'].apply(list).rename('contributing_annotation_ids')
            aggregated_df = aggregated_df.set_index(["timestamp"] + group_by_keys).join(id_collector, how='left').reset_index()
            aggregated_df['contributing_annotation_ids'] = aggregated_df['contributing_annotation_ids'].apply(lambda x: x if isinstance(x, list) else [])
        else:
            aggregated_df['contributing_annotation_ids'] = [[] for _ in range(len(aggregated_df))] 

        time_series_data = []
        date_format_map = {"day": "%Y-%m-%d", "week": "%Y-W%U", "month": "%Y-%m", "quarter": "%Y-Q", "year": "%Y", "raw": "%Y-%m-%d %H:%M:%S"}
        
        for _, row in aggregated_df.iterrows():
            ts = pd.Timestamp(row["timestamp"])
            if pd.isna(ts): continue 
            
            bucket_label = ""
            if self.time_bucket == "quarter": bucket_label = f"{ts.year}-Q{ts.quarter}"
            elif self.time_bucket == "raw": bucket_label = ts.strftime(date_format_map[self.time_bucket])
            else: bucket_label = ts.strftime(date_format_map[self.time_bucket])
            
            data_point: Dict[str, Any] = {
                "timestamp": ts.isoformat(),
                "bucket_label": bucket_label,
                "source_id": int(row.get("source_id")) if pd.notna(row.get("source_id")) and self.split_by_source_id else None,
                "count": int(row.get("count", 0)),
                "sum": float(row.get("sum")) if pd.notna(row.get("sum")) else None,
                "avg": float(row.get("avg")) if pd.notna(row.get("avg")) else None,
                "min": float(row.get("min")) if pd.notna(row.get("min")) else None,
                "max": float(row.get("max")) if pd.notna(row.get("max")) else None,
                "contributing_annotation_ids": row.get("contributing_annotation_ids", [])
            }
            time_series_data.append(data_point)
        
        sort_keys: List[str] = ['timestamp']
        if self.split_by_source_id and "source_id" in time_series_data[0] if time_series_data else False:
            sort_keys.append('source_id')
        
        # Ensure consistent sorting, handling None for source_id if it can occur.
        time_series_data.sort(key=lambda x: tuple(x.get(k) if x.get(k) is not None else (float('-inf') if k == 'source_id' else datetime.min.replace(tzinfo=pd.Timestamp(x['timestamp']).tzinfo)) for k in sort_keys) )

        summary_stats = {}
        if not df.empty and "value_to_aggregate" in df.columns and df["value_to_aggregate"].notna().any():
            valid_values = df["value_to_aggregate"].dropna()
            if not valid_values.empty:
                summary_stats = {
                    "overall_min": float(valid_values.min()) if pd.notna(valid_values.min()) else None,
                    "overall_max": float(valid_values.max()) if pd.notna(valid_values.max()) else None,
                    "overall_avg": float(valid_values.mean()) if pd.notna(valid_values.mean()) else None,
                    "overall_sum": float(valid_values.sum()) if pd.notna(valid_values.sum()) else None,
                    "overall_count": int(len(valid_values)),
                    "value_field_processed": self.value_field_key
                }
        summary_stats["total_annotations_considered"] = len(results)
        summary_stats["total_annotations_with_valid_timestamp"] = len(processed_data)

        return {
            "parameters_used": self.config,
            "time_series_data": time_series_data,
            "summary_statistics": summary_stats
        } 