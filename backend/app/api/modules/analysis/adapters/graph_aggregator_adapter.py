import logging
from typing import Dict, Any, List, Optional, Set
from collections import defaultdict
from sqlmodel import Session, select
from app.models import Annotation, AnnotationRun, AnnotationSchema, User
from app.api.modules.analysis.protocols import AnalysisAdapterProtocol

logger = logging.getLogger(__name__)

class GraphAggregatorAdapter(AnalysisAdapterProtocol):
    """
    Aggregates individual graph fragments from an AnnotationRun into a single, 
    cohesive graph for visualization. Outputs react-flow compatible JSON.
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

        # Required configuration
        self.target_run_id: Optional[int] = config.get("target_run_id")
        self.target_schema_id: Optional[int] = config.get("target_schema_id")
        
        # Optional configuration
        self.include_isolated_nodes: bool = config.get("include_isolated_nodes", True)
        self.max_nodes: Optional[int] = config.get("max_nodes")
        self.node_frequency_threshold: int = config.get("node_frequency_threshold", 1)

        # Validation
        if not self.target_run_id:
            raise ValueError("Missing required configuration: target_run_id.")
        if not self.target_schema_id:
            raise ValueError("Missing required configuration: target_schema_id.")

    def _normalize_entity_key(self, entity_name: str, entity_type: str) -> str:
        """Create a normalized key for entity deduplication."""
        # Simple normalization - could be enhanced with fuzzy matching
        return f"{entity_type}:{entity_name.strip().lower()}"

    def _create_node_id(self, entity_id: int, entity_name: str, entity_type: str) -> str:
        """Create a unique node ID for react-flow."""
        # Use entity ID if available, otherwise use normalized name
        if entity_id is not None:
            return f"entity_{entity_id}"
        else:
            # Fallback for entities without IDs
            normalized = self._normalize_entity_key(entity_name, entity_type)
            return f"entity_{abs(hash(normalized))}"

    def _create_edge_id(self, source_node_id: str, target_node_id: str, predicate: str) -> str:
        """Create a unique edge ID for react-flow."""
        edge_key = f"{source_node_id}_{target_node_id}_{predicate.lower().replace(' ', '_')}"
        return f"edge_{abs(hash(edge_key))}"

    def _is_triplet_array(self, value: Any) -> bool:
        """Structure-based detection: check if array contains self-contained triplet objects.
        
        Triplet format: {subject_name, subject_type, predicate, object_name, object_type}
        """
        if not isinstance(value, list) or len(value) == 0:
            return False
        first = value[0]
        if not isinstance(first, dict):
            return False
        # Check for required triplet fields
        has_subject = 'subject_name' in first and 'subject_type' in first
        has_predicate = 'predicate' in first
        has_object = 'object_name' in first and 'object_type' in first
        return has_subject and has_predicate and has_object
    
    def _find_triplets(self, data: Dict[str, Any]) -> Optional[List[Dict]]:
        """Find triplets array in data structure."""
        # Check common locations for triplets
        if isinstance(data, dict):
            # Direct triplets key
            if 'triplets' in data and self._is_triplet_array(data['triplets']):
                return data['triplets']
            # Nested in document
            if 'document' in data and isinstance(data['document'], dict):
                if 'triplets' in data['document'] and self._is_triplet_array(data['document']['triplets']):
                    return data['document']['triplets']
        return None
    
    def _is_node_array(self, value: Any) -> bool:
        """Structure-based detection: check if array contains node-like objects (legacy format)."""
        if not isinstance(value, list) or len(value) == 0:
            return False
        first = value[0]
        if not isinstance(first, dict):
            return False
        # Check for required node fields: id, name, type
        return 'id' in first and 'name' in first and 'type' in first
    
    def _is_edge_array(self, value: Any) -> bool:
        """Structure-based detection: check if array contains edge-like objects (legacy format)."""
        if not isinstance(value, list) or len(value) == 0:
            return False
        first = value[0]
        if not isinstance(first, dict):
            return False
        # Check for required edge fields: source_id/source, target_id/target, predicate
        has_source = 'source_id' in first or 'source' in first
        has_target = 'target_id' in first or 'target' in first
        has_predicate = 'predicate' in first
        return has_source and has_target and has_predicate
    
    def _find_nodes_and_edges(self, data: Dict[str, Any]) -> tuple[Optional[str], Optional[str]]:
        """Find nodes and edges arrays using structure-based detection (legacy format)."""
        nodes_key = None
        edges_key = None
        
        def traverse(obj: Any, prefix: str = ""):
            nonlocal nodes_key, edges_key
            if isinstance(obj, dict):
                for key, value in obj.items():
                    full_key = f"{prefix}.{key}" if prefix else key
                    if self._is_node_array(value) and nodes_key is None:
                        nodes_key = full_key
                    elif self._is_edge_array(value) and edges_key is None:
                        edges_key = full_key
                    elif isinstance(value, dict):
                        traverse(value, full_key)
        
        traverse(data)
        return nodes_key, edges_key
    
    def _normalize_value(self, value: Any, dedup_config: Dict[str, Any]) -> str:
        """Normalize a value for deduplication comparison."""
        if not isinstance(value, str):
            value = str(value)
        
        if not dedup_config.get('caseSensitive', False):
            value = value.lower()
        
        if dedup_config.get('normalizeWhitespace', True):
            import re
            value = re.sub(r'\s+', ' ', value.strip())
        
        return value
    
    def _deduplicate_nodes(self, nodes: List[Dict], config: Dict[str, Any]) -> List[Dict]:
        """Deduplicate nodes based on configuration."""
        # Get deduplication config with safe defaults
        dedup_config = config.get('deduplication', {})
        
        # Default to enabled if not specified
        if not dedup_config.get('enabled', True):
            return nodes
        
        # Get strategy and fields with defaults
        strategy = dedup_config.get('strategy', 'normalized')
        fields = dedup_config.get('fields', ['name', 'type'])
        
        if strategy == 'exact':
            seen = set()
            deduplicated = []
            for node in nodes:
                key_parts = []
                for field in fields:
                    if field in node:
                        key_parts.append(str(node[field]))
                key = tuple(key_parts)
                if key not in seen:
                    seen.add(key)
                    deduplicated.append(node)
            return deduplicated
        
        elif strategy == 'normalized':
            seen = set()
            deduplicated = []
            for node in nodes:
                key_parts = []
                for field in fields:
                    if field in node:
                        normalized = self._normalize_value(node[field], dedup_config)
                        key_parts.append(normalized)
                key = tuple(key_parts)
                if key not in seen:
                    seen.add(key)
                    deduplicated.append(node)
            return deduplicated
        
        # For 'fuzzy', fall back to normalized for now
        # Future: implement fuzzy string matching
        return self._deduplicate_nodes(nodes, {**config, 'deduplication': {**dedup_config, 'strategy': 'normalized'}})

    async def execute(self) -> Dict[str, Any]:
        logger.info(f"Executing GraphAggregatorAdapter for run {self.target_run_id}")

        # Validate run and schema exist
        run = self.session.get(AnnotationRun, self.target_run_id)
        if not run:
            raise ValueError(f"AnnotationRun with ID {self.target_run_id} not found.")
        
        schema = self.session.get(AnnotationSchema, self.target_schema_id)
        if not schema:
            raise ValueError(f"AnnotationSchema with ID {self.target_schema_id} not found.")

        # Security check
        if self.infospace_id_context and run.infospace_id != self.infospace_id_context:
            raise ValueError(f"AnnotationRun {run.id} does not belong to the current infospace.")
        
        # Get graph config from run (run-scoped)
        graph_config = run.graph_config or {}

        # Fetch all annotations for the run and schema
        query = select(Annotation).where(
            Annotation.run_id == self.target_run_id,
            Annotation.schema_id == self.target_schema_id
        )
        annotations = self.session.exec(query).all()

        if not annotations:
            return self._empty_result()

        # Aggregate entities and relationships
        entity_registry = {}
        edge_registry = {}    # edge_key -> {edge_data, frequency}
        total_fragments_processed = 0
        fragments_with_errors = 0

        for annotation in annotations:
            try:
                graph_fragment = annotation.value
                if not isinstance(graph_fragment, dict):
                    logger.warning(f"Annotation {annotation.id} value is not a dict. Skipping.")
                    fragments_with_errors += 1
                    continue

                # PRIMARY: Try to find self-contained triplets (subject_name/object_name format)
                triplets_data = self._find_triplets(graph_fragment)
                
                if triplets_data:
                    # Process self-contained triplets
                    logger.info(f"Processing annotation {annotation.id} with {len(triplets_data)} self-contained triplets")
                    
                    for triplet in triplets_data:
                        if not isinstance(triplet, dict):
                            continue
                        
                        subject_name = triplet.get("subject_name", "")
                        subject_type = triplet.get("subject_type", "UNKNOWN")
                        predicate = triplet.get("predicate", "")
                        object_name = triplet.get("object_name", "")
                        object_type = triplet.get("object_type", "UNKNOWN")
                        
                        if not subject_name or not object_name or not predicate:
                            logger.debug(f"Skipping incomplete triplet: {triplet}")
                            continue
                        
                        # Register subject entity
                        subject_key = self._normalize_entity_key(subject_name, subject_type)
                        if subject_key not in entity_registry:
                            entity_registry[subject_key] = {
                                "entity_data": {
                                    "id": None,  # No ID in triplet format
                                    "name": subject_name,
                                    "type": subject_type
                                },
                                "frequency": 1,
                                "node_id": f"entity_{abs(hash(subject_key))}",
                                "source_assets": {annotation.asset_id}
                            }
                        else:
                            entity_registry[subject_key]["frequency"] += 1
                            entity_registry[subject_key]["source_assets"].add(annotation.asset_id)
                        
                        # Register object entity
                        object_key = self._normalize_entity_key(object_name, object_type)
                        if object_key not in entity_registry:
                            entity_registry[object_key] = {
                                "entity_data": {
                                    "id": None,
                                    "name": object_name,
                                    "type": object_type
                                },
                                "frequency": 1,
                                "node_id": f"entity_{abs(hash(object_key))}",
                                "source_assets": {annotation.asset_id}
                            }
                        else:
                            entity_registry[object_key]["frequency"] += 1
                            entity_registry[object_key]["source_assets"].add(annotation.asset_id)
                        
                        # Register edge
                        edge_key = f"{subject_key}|{predicate.lower()}|{object_key}"
                        if edge_key not in edge_registry:
                            edge_registry[edge_key] = {
                                "edge_data": {
                                    "source_entity": {"name": subject_name, "type": subject_type},
                                    "target_entity": {"name": object_name, "type": object_type},
                                    "predicate": predicate,
                                    "context": triplet.get("context")
                                },
                                "frequency": 1,
                                "source_assets": {annotation.asset_id}
                            }
                        else:
                            edge_registry[edge_key]["frequency"] += 1
                            edge_registry[edge_key]["source_assets"].add(annotation.asset_id)
                    
                    total_fragments_processed += 1
                    continue  # Skip legacy processing for this annotation
                
                # FALLBACK: Legacy nodes+edges format with ID references
                nodes_data = None
                edges_data = None
                
                if 'document' in graph_fragment and isinstance(graph_fragment['document'], dict):
                    document_data = graph_fragment['document']
                    nodes_key, edges_key = self._find_nodes_and_edges(document_data)
                    if nodes_key:
                        keys = nodes_key.split('.')
                        nodes_data = document_data
                        for key in keys:
                            if isinstance(nodes_data, dict):
                                nodes_data = nodes_data.get(key)
                    if edges_key:
                        keys = edges_key.split('.')
                        edges_data = document_data
                        for key in keys:
                            if isinstance(edges_data, dict):
                                edges_data = edges_data.get(key)
                else:
                    nodes_key, edges_key = self._find_nodes_and_edges(graph_fragment)
                    if nodes_key:
                        keys = nodes_key.split('.')
                        nodes_data = graph_fragment
                        for key in keys:
                            if isinstance(nodes_data, dict):
                                nodes_data = nodes_data.get(key)
                    if edges_key:
                        keys = edges_key.split('.')
                        edges_data = graph_fragment
                        for key in keys:
                            if isinstance(edges_data, dict):
                                edges_data = edges_data.get(key)
                
                # Fallback to legacy field names
                if nodes_data is None:
                    if 'document' in graph_fragment and isinstance(graph_fragment['document'], dict):
                        nodes_data = graph_fragment['document'].get("entities", [])
                    else:
                        nodes_data = graph_fragment.get("entities", [])
                
                if edges_data is None:
                    if 'document' in graph_fragment and isinstance(graph_fragment['document'], dict):
                        edges_data = graph_fragment['document'].get("triplets", [])
                    else:
                        edges_data = graph_fragment.get("triplets", [])
                
                entities = nodes_data if isinstance(nodes_data, list) else []
                triplets = edges_data if isinstance(edges_data, list) else []

                if not entities and not triplets:
                    logger.warning(f"Annotation {annotation.id} has no graph data. Skipping.")
                    fragments_with_errors += 1
                    continue

                logger.info(f"Processing annotation {annotation.id} with legacy format: {len(entities)} entities, {len(triplets)} edges")

                # Process legacy entities
                for entity in entities:
                    if not isinstance(entity, dict):
                        continue
                    
                    entity_id = entity.get("id")
                    entity_name = entity.get("name", "")
                    entity_type = entity.get("type", "UNKNOWN")

                    if not entity_name:
                        continue

                    normalized_key = self._normalize_entity_key(entity_name, entity_type)
                    
                    if normalized_key not in entity_registry:
                        node_id = self._create_node_id(entity_id, entity_name, entity_type)
                        entity_registry[normalized_key] = {
                            "entity_data": {
                                "id": entity_id,
                                "name": entity_name,
                                "type": entity_type
                            },
                            "frequency": 1,
                            "node_id": node_id,
                            "source_assets": {annotation.asset_id}
                        }
                    else:
                        entity_registry[normalized_key]["frequency"] += 1
                        entity_registry[normalized_key]["source_assets"].add(annotation.asset_id)

                # Process legacy triplets (with ID references)
                triplets_processed = 0  # Initialize counter
                for triplet in triplets:
                    if not isinstance(triplet, dict):
                        continue
                    
                    source_id = triplet.get("source_id") or triplet.get("source")
                    target_id = triplet.get("target_id") or triplet.get("target")
                    predicate = triplet.get("predicate", "")

                    if source_id is None or target_id is None or not predicate:
                        continue

                    # Find corresponding entities by ID
                    source_entity = None
                    target_entity = None
                    
                    for entity in entities:
                        if entity.get("id") == source_id:
                            source_entity = entity
                        if entity.get("id") == target_id:
                            target_entity = entity

                    if not source_entity or not target_entity:
                        logger.debug(f"Triplet references unknown entity IDs: source={source_id}, target={target_id}")
                        continue

                    # Create edge key for deduplication
                    source_key = self._normalize_entity_key(source_entity.get("name", ""), source_entity.get("type", ""))
                    target_key = self._normalize_entity_key(target_entity.get("name", ""), target_entity.get("type", ""))
                    edge_key = f"{source_key}|{predicate.lower()}|{target_key}"

                    if edge_key not in edge_registry:
                        edge_registry[edge_key] = {
                            "edge_data": {
                                "source_entity": source_entity,
                                "target_entity": target_entity,
                                "predicate": predicate
                            },
                            "frequency": 1,
                            "source_assets": {annotation.asset_id}
                        }
                        triplets_processed += 1
                        logger.info(f"DEBUG: Created edge: {source_entity.get('name')} -> {predicate} -> {target_entity.get('name')}")
                    else:
                        edge_registry[edge_key]["frequency"] += 1
                        edge_registry[edge_key]["source_assets"].add(annotation.asset_id)
                        triplets_processed += 1

                logger.info(f"DEBUG: Processed {triplets_processed} valid triplets from annotation {annotation.id}")
                total_fragments_processed += 1

            except Exception as e:
                logger.error(f"Error processing annotation {annotation.id}: {e}")
                fragments_with_errors += 1

        # Apply deduplication if enabled (before frequency filtering)
        # Ensure graph_config has default deduplication settings if missing
        dedup_config = graph_config.get('deduplication', {})
        if dedup_config.get('enabled', True):
            logger.info(f"Applying deduplication with strategy: {dedup_config.get('strategy', 'normalized')}")
            
            # Convert registry to list for deduplication
            all_entities_list = [
                {
                    **data["entity_data"],
                    "frequency": data["frequency"],
                    "source_assets": list(data["source_assets"]),
                    "_normalized_key": key  # Preserve the key for reference
                }
                for key, data in entity_registry.items()
            ]
            
            deduplicated_entities = self._deduplicate_nodes(all_entities_list, graph_config)
            
            # Rebuild registry from deduplicated list, merging frequencies and source assets
            new_entity_registry = {}
            seen_keys = set()
            
            for entity in deduplicated_entities:
                normalized_key = self._normalize_entity_key(entity.get("name", ""), entity.get("type", ""))
                
                # If we've seen this key, merge with existing entry
                if normalized_key in new_entity_registry:
                    existing = new_entity_registry[normalized_key]
                    existing["frequency"] += entity.get("frequency", 1)
                    existing["source_assets"].update(entity.get("source_assets", []))
                else:
                    node_id = self._create_node_id(entity.get("id"), entity.get("name", ""), entity.get("type", ""))
                    new_entity_registry[normalized_key] = {
                        "entity_data": {
                            "id": entity.get("id"),
                            "name": entity.get("name", ""),
                            "type": entity.get("type", "")
                        },
                        "frequency": entity.get("frequency", 1),
                        "node_id": node_id,
                        "source_assets": set(entity.get("source_assets", []))
                    }
            
            entity_registry = new_entity_registry
        
        # Filter entities by frequency threshold
        filtered_entities = {
            key: data for key, data in entity_registry.items() 
            if data["frequency"] >= self.node_frequency_threshold
        }

        logger.info(f"DEBUG: Entity filtering - Original: {len(entity_registry)}, After filtering: {len(filtered_entities)}")
        logger.info(f"DEBUG: Frequency threshold: {self.node_frequency_threshold}")
        
        # Log removed entities
        removed_entities = set(entity_registry.keys()) - set(filtered_entities.keys())
        if removed_entities:
            logger.warning(f"DEBUG: Removed {len(removed_entities)} entities due to frequency filter")
            for removed_key in list(removed_entities)[:3]:  # First 3
                logger.warning(f"DEBUG: Removed entity: {removed_key} (freq: {entity_registry[removed_key]['frequency']})")

        # Build nodes for react-flow
        nodes = []
        node_id_map = {}  # normalized_key -> node_id

        for normalized_key, entity_info in filtered_entities.items():
            entity_data = entity_info["entity_data"]
            node_id = entity_info["node_id"]
            node_id_map[normalized_key] = node_id

            node = {
                "id": node_id,
                "data": {
                    "label": entity_data["name"],
                    "type": entity_data["type"],
                    "frequency": entity_info["frequency"],
                    "source_asset_count": len(entity_info["source_assets"]),
                    "source_asset_ids": list(entity_info["source_assets"])
                },
                "position": {"x": 0, "y": 0}  # Frontend will handle layout
            }
            nodes.append(node)

        # Apply max_nodes limit if specified
        if self.max_nodes and len(nodes) > self.max_nodes:
            # Keep the most frequent nodes
            nodes.sort(key=lambda n: n["data"]["frequency"], reverse=True)
            nodes = nodes[:self.max_nodes]
            # Update node_id_map to only include kept nodes
            kept_node_ids = {node["id"] for node in nodes}
            node_id_map = {k: v for k, v in node_id_map.items() if v in kept_node_ids}

        # Build edges for react-flow
        edges = []
        connected_nodes = set()

        logger.info(f"DEBUG: Starting edge building. Edge registry has {len(edge_registry)} entries")
        logger.info(f"DEBUG: Node ID map has {len(node_id_map)} entries: {list(node_id_map.keys())[:5]}...")

        for edge_key, edge_info in edge_registry.items():
            edge_data = edge_info["edge_data"]
            source_entity = edge_data["source_entity"]
            target_entity = edge_data["target_entity"]

            source_key = self._normalize_entity_key(source_entity.get("name", ""), source_entity.get("type", ""))
            target_key = self._normalize_entity_key(target_entity.get("name", ""), target_entity.get("type", ""))

            logger.info(f"DEBUG: Checking edge - source_key: '{source_key}', target_key: '{target_key}'")
            logger.info(f"DEBUG: source_key in node_id_map: {source_key in node_id_map}")
            logger.info(f"DEBUG: target_key in node_id_map: {target_key in node_id_map}")

            # Only include edges where both nodes exist
            if source_key in node_id_map and target_key in node_id_map:
                source_node_id = node_id_map[source_key]
                target_node_id = node_id_map[target_key]
                
                edge_id = self._create_edge_id(source_node_id, target_node_id, edge_data["predicate"])
                
                edge = {
                    "id": edge_id,
                    "source": source_node_id,
                    "target": target_node_id,
                    "label": edge_data["predicate"],
                    "data": {
                        "predicate": edge_data["predicate"],
                        "frequency": edge_info["frequency"],
                        "source_asset_count": len(edge_info["source_assets"]),
                        "source_asset_ids": list(edge_info["source_assets"])
                    }
                }
                edges.append(edge)
                connected_nodes.add(source_node_id)
                connected_nodes.add(target_node_id)
                logger.info(f"DEBUG: Added edge: {source_node_id} -> {target_node_id}")
            else:
                logger.warning(f"DEBUG: Skipping edge because nodes not found in node_id_map")

        logger.info(f"DEBUG: Final edge count: {len(edges)}")

        # Filter isolated nodes if requested
        if not self.include_isolated_nodes:
            nodes = [node for node in nodes if node["id"] in connected_nodes]

        # Calculate graph metrics
        total_entities_before_filter = len(entity_registry)
        total_relationships = len(edge_registry)
        
        result = {
            "parameters_used": self.config,
            "graph_data": {
                "nodes": nodes,
                "edges": edges
            },
            "graph_metrics": {
                "total_nodes": len(nodes),
                "total_edges": len(edges),
                "connected_components": self._count_connected_components(nodes, edges),
                "isolated_nodes": len([n for n in nodes if n["id"] not in connected_nodes]),
                "node_frequency_distribution": self._get_frequency_distribution([n["data"]["frequency"] for n in nodes]),
                "edge_frequency_distribution": self._get_frequency_distribution([e["data"]["frequency"] for e in edges])
            },
            "processing_summary": {
                "total_annotations_processed": len(annotations),
                "total_fragments_processed": total_fragments_processed,
                "fragments_with_errors": fragments_with_errors,
                "total_entities_extracted": total_entities_before_filter,
                "total_relationships_extracted": total_relationships,
                "entities_after_filtering": len(nodes),
                "relationships_after_filtering": len(edges)
            }
        }

        logger.info(f"Graph aggregation complete: {len(nodes)} nodes, {len(edges)} edges")
        return result

    def _empty_result(self) -> Dict[str, Any]:
        """Return empty result structure."""
        return {
            "parameters_used": self.config,
            "graph_data": {
                "nodes": [],
                "edges": []
            },
            "graph_metrics": {
                "total_nodes": 0,
                "total_edges": 0,
                "connected_components": 0,
                "isolated_nodes": 0,
                "node_frequency_distribution": {},
                "edge_frequency_distribution": {}
            },
            "processing_summary": {
                "total_annotations_processed": 0,
                "total_fragments_processed": 0,
                "fragments_with_errors": 0,
                "total_entities_extracted": 0,
                "total_relationships_extracted": 0,
                "entities_after_filtering": 0,
                "relationships_after_filtering": 0
            }
        }

    def _count_connected_components(self, nodes: List[Dict], edges: List[Dict]) -> int:
        """Count the number of connected components in the graph."""
        if not nodes:
            return 0

        # Build adjacency list
        adjacency = defaultdict(set)
        node_ids = {node["id"] for node in nodes}
        
        for edge in edges:
            source, target = edge["source"], edge["target"]
            if source in node_ids and target in node_ids:
                adjacency[source].add(target)
                adjacency[target].add(source)

        # Find connected components using DFS
        visited = set()
        components = 0

        def dfs(node_id):
            visited.add(node_id)
            for neighbor in adjacency[node_id]:
                if neighbor not in visited:
                    dfs(neighbor)

        for node in nodes:
            node_id = node["id"]
            if node_id not in visited:
                dfs(node_id)
                components += 1

        return components

    def _get_frequency_distribution(self, frequencies: List[int]) -> Dict[str, int]:
        """Get frequency distribution statistics."""
        if not frequencies:
            return {}
        
        from collections import Counter
        dist = Counter(frequencies)
        
        return {
            "min": min(frequencies),
            "max": max(frequencies),
            "avg": sum(frequencies) / len(frequencies),
            "distribution": dict(dist.most_common(10))  # Top 10 frequency buckets
        } 