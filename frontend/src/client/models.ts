export type AnalysisAdapterRead = {
	name: string;
	description?: string | null;
	input_schema_definition?: Record<string, unknown> | null;
	output_schema_definition?: Record<string, unknown> | null;
	version?: string;
	module_path?: string | null;
	adapter_type: string;
	is_public?: boolean;
	id: number;
	is_active: boolean;
	creator_user_id?: number | null;
	created_at: string;
	updated_at: string;
};



export type AnnotationCreate = {
	value: Record<string, unknown>;
	status?: ResultStatus;
	event_timestamp?: string | null;
	region?: Record<string, unknown> | null;
	links?: Array<Record<string, unknown>> | null;
	asset_id: number;
	schema_id: number;
	run_id: number;
};



export type AnnotationRead = {
	value: Record<string, unknown>;
	status?: ResultStatus;
	event_timestamp?: string | null;
	region?: Record<string, unknown> | null;
	links?: Array<Record<string, unknown>> | null;
	id: number;
	uuid: string;
	asset_id: number;
	schema_id: number;
	run_id: number;
	infospace_id: number;
	user_id: number;
	timestamp: string;
	created_at: string;
	updated_at: string;
};



/**
 * Request payload for retrying a single annotation with optional custom prompt.
 */
export type AnnotationRetryRequest = {
	/**
	 * Optional additional guidance or prompt override for this specific retry
	 */
	custom_prompt?: string | null;
};



export type AnnotationRunCreate = {
	name: string;
	description?: string | null;
	configuration?: Record<string, unknown>;
	include_parent_context?: boolean;
	context_window?: number;
	views_config?: Array<Record<string, unknown>> | null;
	schema_ids: Array<number>;
	target_asset_ids?: Array<number> | null;
	target_bundle_id?: number | null;
};



/**
 * Preview model for shared annotation runs.
 */
export type AnnotationRunPreview = {
	id: number;
	uuid: string;
	name: string;
	description?: string | null;
	status: RunStatus;
	created_at: string;
	updated_at: string;
	completed_at?: string | null;
	views_config?: Array<Record<string, unknown>> | null;
	configuration?: Record<string, unknown>;
	annotation_count?: number;
	target_schemas?: Array<Record<string, unknown>>;
	annotations?: Array<Record<string, unknown>>;
};



export type AnnotationRunRead = {
	name: string;
	description?: string | null;
	configuration?: Record<string, unknown>;
	include_parent_context?: boolean;
	context_window?: number;
	views_config?: Array<Record<string, unknown>> | null;
	id: number;
	uuid: string;
	infospace_id: number;
	user_id: number;
	status: RunStatus;
	created_at: string;
	updated_at: string;
	started_at: string | null;
	completed_at: string | null;
	error_message: string | null;
	annotation_count?: number | null;
	schema_ids?: Array<number> | null;
};



export type AnnotationRunUpdate = {
	name?: string | null;
	description?: string | null;
	configuration?: Record<string, unknown> | null;
	include_parent_context?: boolean | null;
	context_window?: number | null;
	views_config?: Array<Record<string, unknown>> | null;
};



export type AnnotationRunsOut = {
	data: Array<AnnotationRunRead>;
	count: number;
};



export type AnnotationSchemaCreate = {
	name: string;
	description?: string | null;
	output_contract: Record<string, unknown>;
	instructions?: string | null;
	version?: string;
	field_specific_justification_configs?: Record<string, FieldJustificationConfig> | null;
};



export type AnnotationSchemaRead = {
	name: string;
	description?: string | null;
	output_contract: Record<string, unknown>;
	instructions?: string | null;
	version?: string;
	id: number;
	uuid: string;
	infospace_id: number;
	user_id: number;
	created_at: string;
	updated_at: string;
	field_specific_justification_configs?: Record<string, FieldJustificationConfig> | null;
	annotation_count?: number | null;
	is_active: boolean;
};



export type AnnotationSchemaUpdate = {
	name?: string | null;
	description?: string | null;
	output_contract?: Record<string, unknown> | null;
	instructions?: string | null;
	version?: string | null;
	field_specific_justification_configs?: Record<string, FieldJustificationConfig> | null;
	is_active?: boolean | null;
};



export type AnnotationSchemasOut = {
	data: Array<AnnotationSchemaRead>;
	count: number;
};



export type AnnotationUpdate = {
	value?: Record<string, unknown> | null;
	status?: ResultStatus | null;
	event_timestamp?: string | null;
	region?: Record<string, unknown> | null;
	links?: Array<Record<string, unknown>> | null;
};



export type AnnotationsOut = {
	data: Array<AnnotationRead>;
	count: number;
};



export type ArticleComposition = {
	title: string;
	content: string;
	summary?: string | null;
	embedded_assets?: Array<Record<string, unknown>> | null;
	referenced_bundles?: Array<number> | null;
	metadata?: Record<string, unknown> | null;
	event_timestamp?: string | null;
};



export type AssetChunkRead = {
	asset_id: number;
	chunk_index: number;
	text_content: string;
	chunk_metadata?: Record<string, unknown> | null;
	id: number;
	created_at: string;
};



export type AssetCreate = {
	title?: string | null;
	kind: AssetKind;
	user_id?: number | null;
	infospace_id?: number | null;
	parent_asset_id?: number | null;
	part_index?: number | null;
	text_content?: string | null;
	blob_path?: string | null;
	cells?: Record<string, unknown> | null;
	source_identifier?: string | null;
	source_metadata?: Record<string, unknown> | null;
	event_timestamp?: string | null;
};



export type AssetKind = 'pdf' | 'web' | 'image' | 'video' | 'audio' | 'text' | 'csv' | 'csv_row' | 'mbox' | 'email' | 'pdf_page' | 'text_chunk' | 'image_region' | 'video_scene' | 'audio_segment' | 'article' | 'file';



/**
 * A lightweight public representation of an Asset.
 */
export type AssetPreview = {
	id: number;
	title: string;
	kind: AssetKind;
	created_at: string;
	updated_at: string;
	text_content?: string | null;
	blob_path?: string | null;
	source_metadata?: Record<string, unknown> | null;
	children?: Array<AssetPreview>;
	/**
	 * Helper to know if this asset might have children (e.g., PDF, CSV).
	 */
	readonly is_container: boolean;
};



export type AssetRead = {
	title: string;
	kind: AssetKind;
	id: number;
	uuid: string;
	parent_asset_id: number | null;
	part_index: number | null;
	infospace_id: number;
	source_id: number | null;
	created_at: string;
	text_content?: string | null;
	blob_path?: string | null;
	source_identifier?: string | null;
	source_metadata?: Record<string, unknown> | null;
	content_hash?: string | null;
	fragments?: Record<string, unknown> | null;
	user_id?: number | null;
	updated_at: string;
	event_timestamp?: string | null;
	processing_status?: ProcessingStatus;
	processing_error?: string | null;
	/**
	 * True if this asset can have child assets.
	 */
	readonly is_container: boolean;
};



export type AssetUpdate = {
	title?: string | null;
	kind?: AssetKind | null;
	text_content?: string | null;
	blob_path?: string | null;
	source_identifier?: string | null;
	source_metadata?: Record<string, unknown> | null;
	event_timestamp?: string | null;
};



export type AssetsOut = {
	data: Array<AssetRead>;
	count: number;
};



export type BackupRestoreRequest = {
	backup_id: number;
	target_infospace_name?: string | null;
	conflict_strategy?: string;
};



export type BackupShareRequest = {
	backup_id: number;
	is_shareable?: boolean;
	expiration_hours?: number | null;
};



export type Body_assets_add_files_to_bundle_background = {
	files: Array<Blob | File>;
	options?: string;
};



export type Body_assets_create_assets_background_bulk = {
	files: Array<Blob | File>;
	options?: string;
};



export type Body_assets_upload_file = {
	file: Blob | File;
	title?: string | null;
	process_immediately?: boolean;
};



export type Body_datasets_import_dataset = {
	/**
	 * Dataset Package file (.zip)
	 */
	file: Blob | File;
};



export type Body_filestorage_file_upload = {
	/**
	 * File to upload
	 */
	file: Blob | File;
};



export type Body_filters_test_filter = {
	filter_config: Record<string, unknown>;
	test_data: Array<Record<string, unknown>>;
};



export type Body_login_login_access_token = {
	grant_type?: string | null;
	username: string;
	password: string;
	scope?: string;
	client_id?: string | null;
	client_secret?: string | null;
};



export type Body_sharing_export_resource = {
	resource_type: ResourceType;
	resource_id: number;
};



export type Body_sharing_import_resource = {
	file: Blob | File;
};



export type Body_sso_complete_discourse_sso = {
	sso: string;
	sig: string;
};



export type Body_users_upload_profile_picture = {
	file: Blob | File;
};



export type Body_utils_extract_pdf_metadata = {
	file: Blob | File;
};



export type Body_utils_extract_pdf_text = {
	file: Blob | File;
};



export type BulkUrlIngestion = {
	urls: Array<string>;
	base_title?: string | null;
	scrape_immediately?: boolean;
	bundle_id?: number | null;
};



export type BundleCreate = {
	name: string;
	description?: string | null;
	tags?: Array<string> | null;
	asset_ids?: Array<number>;
	purpose?: string | null;
	bundle_metadata?: Record<string, unknown> | null;
};



/**
 * A lightweight public representation of a Bundle.
 */
export type BundlePreview = {
	id: number;
	name: string;
	description?: string | null;
	created_at: string;
	updated_at: string;
	assets: Array<AssetPreview>;
};



export type BundleRead = {
	name: string;
	description?: string | null;
	tags?: Array<string> | null;
	id: number;
	infospace_id: number;
	created_at: string;
	updated_at: string;
	asset_count: number;
	uuid: string;
	user_id: number;
	purpose?: string | null;
	bundle_metadata?: Record<string, unknown> | null;
};



export type BundleUpdate = {
	name?: string | null;
	description?: string | null;
	tags?: Array<string> | null;
	purpose?: string | null;
	bundle_metadata?: Record<string, unknown> | null;
};



/**
 * Individual message in a conversation.
 */
export type ChatMessage = {
	role: string;
	content: string;
};



/**
 * Request for intelligence analysis chat.
 */
export type ChatRequest = {
	messages: Array<ChatMessage>;
	model_name: string;
	infospace_id: number;
	stream?: boolean;
	temperature?: number | null;
	max_tokens?: number | null;
	thinking_enabled?: boolean;
};



/**
 * Response from intelligence analysis chat.
 */
export type ChatResponse = {
	content: string;
	model_used: string;
	usage?: Record<string, unknown> | null;
	tool_calls?: Array<Record<string, unknown>> | null;
	thinking_trace?: string | null;
	finish_reason?: string | null;
};



export type ChunkAssetRequest = {
	strategy?: string;
	chunk_size?: number;
	chunk_overlap?: number;
	overwrite_existing?: boolean;
};



export type ChunkAssetsRequest = {
	asset_ids?: Array<number> | null;
	asset_kinds?: Array<string> | null;
	infospace_id?: number | null;
	strategy?: string;
	chunk_size?: number;
	chunk_overlap?: number;
	overwrite_existing?: boolean;
};



export type ChunkingResultResponse = {
	message: string;
	asset_id: number;
	chunks_created: number;
	strategy_used: string;
	strategy_params: Record<string, unknown>;
};



export type ChunkingStatsResponse = {
	total_chunks: number;
	total_characters?: number | null;
	average_chunk_size?: number | null;
	assets_with_chunks?: number | null;
	strategies_used?: Record<string, number> | null;
};



export type CreatePackageFromRunRequest = {
	name: string;
	description?: string | null;
};



export type DatasetCreate = {
	name: string;
	description?: string | null;
	asset_ids?: Array<number>;
};



export type DatasetPackageEntitySummary = {
	entity_uuid?: string | null;
	name?: string | null;
	description?: string | null;
};



export type DatasetPackageFileManifestItem = {
	filename: string;
	original_collection_uuid?: string | null;
	original_collection_id?: number | null;
	type?: string | null;
	linked_asset_uuid?: string | null;
};



export type DatasetPackageSummary = {
	package_metadata: Record<string, unknown>;
	dataset_details: DatasetPackageEntitySummary;
	record_count?: number;
	annotation_results_count?: number;
	included_schemas?: Array<DatasetPackageEntitySummary>;
	included_runs?: Array<DatasetPackageEntitySummary>;
	linked_collections_summary?: Array<DatasetPackageEntitySummary>;
	source_files_manifest?: Array<DatasetPackageFileManifestItem>;
};



export type DatasetRead = {
	name: string;
	description?: string | null;
	id: number;
	infospace_id: number;
	asset_ids?: Array<number> | null;
	created_at: string;
	entity_uuid: string;
	user_id: number;
	updated_at: string;
};



export type DatasetUpdate = {
	name?: string | null;
	description?: string | null;
	asset_ids?: Array<number> | null;
};



export type DatasetsOut = {
	data: Array<DatasetRead>;
	count: number;
};



export type EmbeddingGenerateRequest = {
	chunk_ids: Array<number>;
	model_name: string;
	provider: string;
};



export type EmbeddingModelCreate = {
	name: string;
	provider: string;
	dimension: number;
	description?: string | null;
	config?: Record<string, unknown> | null;
	max_sequence_length?: number | null;
};



export type EmbeddingModelRead = {
	name: string;
	provider: string;
	dimension: number;
	description?: string | null;
	config?: Record<string, unknown> | null;
	max_sequence_length?: number | null;
	id: number;
	is_active: boolean;
	created_at: string;
	updated_at: string;
	embedding_time_ms?: number | null;
};



export type EmbeddingProvider = 'ollama' | 'jina' | 'openai' | 'huggingface';



export type EmbeddingSearchRequest = {
	query_text: string;
	model_name: string;
	provider: string;
	limit?: number;
	distance_threshold?: number;
	distance_function?: string;
};



export type EmbeddingSearchResponse = {
	query_text: string;
	results: Array<EmbeddingSearchResult>;
	model_name: string;
	distance_function: string;
};



export type EmbeddingSearchResult = {
	chunk_id: number;
	asset_id: number;
	text_content: string | null;
	distance: number;
	similarity?: number | null;
};



export type EmbeddingStatsResponse = {
	model_id: number;
	model_name: string;
	provider: string;
	dimension: number;
	embedding_count: number;
	table_size: string;
	avg_embedding_time_ms?: number | null;
};



export type ExportBatchRequest = {
	resource_type: ResourceType;
	resource_ids: Array<number>;
};



export type ExportMixedBatchRequest = {
	asset_ids?: Array<number>;
	bundle_ids?: Array<number>;
};



export type FieldJustificationConfig = {
	enabled: boolean;
	custom_prompt?: string | null;
};



export type FileUploadResponse = {
	/**
	 * Original uploaded filename
	 */
	filename: string;
	/**
	 * Object name in storage
	 */
	object_name: string;
};



export type HTTPValidationError = {
	detail?: Array<ValidationError>;
};



export type ImportFromTokenRequest = {
	target_infospace_id: number;
};



export type InfospaceBackupCreate = {
	name: string;
	description?: string | null;
	expires_at?: string | null;
	backup_type?: string | null;
	include_sources?: boolean;
	include_schemas?: boolean;
	include_runs?: boolean;
	include_datasets?: boolean;
	include_annotations?: boolean;
};



export type InfospaceBackupRead = {
	name: string;
	description?: string | null;
	expires_at?: string | null;
	id: number;
	uuid: string;
	infospace_id: number;
	user_id: number;
	backup_type: string;
	storage_path: string;
	file_size_bytes?: number | null;
	content_hash?: string | null;
	included_sources?: number;
	included_assets?: number;
	included_schemas?: number;
	included_runs?: number;
	included_datasets?: number;
	status: string;
	error_message?: string | null;
	created_at: string;
	completed_at?: string | null;
	is_shareable?: boolean;
	share_token?: string | null;
	/**
	 * Check if backup has expired.
	 */
	readonly is_expired: boolean;
	/**
	 * Check if backup is ready for use.
	 */
	readonly is_ready: boolean;
	/**
	 * Generate download URL if backup is shareable.
	 */
	readonly download_url: string | null;
};



export type InfospaceBackupUpdate = {
	name?: string | null;
	description?: string | null;
	is_shareable?: boolean | null;
	expires_at?: string | null;
};



export type InfospaceBackupsOut = {
	data: Array<InfospaceBackupRead>;
	count: number;
};



export type InfospaceCreate = {
	name: string;
	description?: string | null;
	icon?: string | null;
	owner_id: number;
	vector_backend?: string | null;
	embedding_model?: string | null;
	embedding_dim?: number | null;
	chunk_size?: number | null;
	chunk_overlap?: number | null;
	chunk_strategy?: string | null;
};



export type InfospaceRead = {
	name: string;
	description?: string | null;
	icon?: string | null;
	id: number;
	owner_id: number;
	created_at: string;
};



export type InfospaceUpdate = {
	name?: string | null;
	description?: string | null;
	vector_backend?: string | null;
	embedding_model?: string | null;
	embedding_dim?: number | null;
	chunk_size?: number | null;
	chunk_overlap?: number | null;
	chunk_strategy?: string | null;
	icon?: string | null;
};



export type InfospacesOut = {
	data: Array<InfospaceRead>;
	count: number;
};



export type IntelligencePipelineCreate = {
	name: string;
	description?: string | null;
	source_bundle_ids: Array<number>;
	steps: Array<PipelineStepCreate>;
};



export type IntelligencePipelineRead = {
	name: string;
	description?: string | null;
	source_bundle_ids: Array<number>;
	id: number;
	uuid: string;
	infospace_id: number;
	user_id: number;
	linked_task_id: number | null;
	steps: Array<PipelineStepRead>;
};



export type IntelligencePipelineUpdate = {
	name?: string | null;
	description?: string | null;
	source_bundle_ids?: Array<number> | null;
	steps?: Array<PipelineStepCreate> | null;
};



export type Message = {
	message: string;
};



/**
 * Information about a language model.
 */
export type ModelInfo = {
	name: string;
	provider: string;
	description?: string | null;
	supports_structured_output?: boolean;
	supports_tools?: boolean;
	supports_streaming?: boolean;
	supports_thinking?: boolean;
	supports_multimodal?: boolean;
	max_tokens?: number | null;
	context_length?: number | null;
};



/**
 * Response listing available models.
 */
export type ModelListResponse = {
	models: Array<ModelInfo>;
	providers: Array<string>;
};



export type MonitorCreate = {
	name: string;
	description?: string | null;
	schedule: string;
	target_bundle_ids: Array<number>;
	target_schema_ids: Array<number>;
	run_config_override?: Record<string, unknown> | null;
};



export type MonitorRead = {
	name: string;
	description?: string | null;
	schedule: string;
	target_bundle_ids: Array<number>;
	target_schema_ids: Array<number>;
	run_config_override?: Record<string, unknown> | null;
	id: number;
	uuid: string;
	infospace_id: number;
	user_id: number;
	linked_task_id: number;
	status: string;
	last_checked_at?: string | null;
};



export type MonitorUpdate = {
	name?: string | null;
	description?: string | null;
	schedule?: string | null;
	target_bundle_ids?: Array<number> | null;
	target_schema_ids?: Array<number> | null;
	run_config_override?: Record<string, unknown> | null;
	status?: string | null;
};



export type MostRelevantEntitiesRequest = {
	article_ids: Array<string>;
};



export type NewPassword = {
	token: string;
	new_password: string;
};



export type PackageRead = {
	name: string;
	description?: string | null;
	id: number;
	infospace_id: number;
	created_at: string;
};



export type Paginated = {
	data: Array<unknown>;
	count: number;
};



export type PermissionLevel = 'read_only' | 'edit' | 'full_access';



export type PipelineExecutionRead = {
	id: number;
	pipeline_id: number;
	status: string;
	trigger_type: string;
	started_at: string;
	completed_at: string | null;
	triggering_asset_ids: Array<number> | null;
};



export type PipelineStepCreate = {
	name: string;
	step_order: number;
	/**
	 * Type of step: ANNOTATE, FILTER, ANALYZE, BUNDLE
	 */
	step_type: string;
	/**
	 * Configuration for the step
	 */
	configuration: Record<string, unknown>;
	/**
	 * Source of input for this step
	 */
	input_source: Record<string, unknown>;
};



export type PipelineStepRead = {
	name: string;
	step_order: number;
	/**
	 * Type of step: ANNOTATE, FILTER, ANALYZE, BUNDLE
	 */
	step_type: string;
	/**
	 * Configuration for the step
	 */
	configuration: Record<string, unknown>;
	/**
	 * Source of input for this step
	 */
	input_source: Record<string, unknown>;
	id: number;
	pipeline_id: number;
};



/**
 * Status for asset processing (creating child assets).
 */
export type ProcessingStatus = 'ready' | 'pending' | 'processing' | 'failed';



export type PromoteFragmentRequest = {
	fragment_key: string;
	fragment_value: unknown;
};



export type ProviderInfo = {
	provider_name: string;
	models: Array<ProviderModel>;
};



export type ProviderListResponse = {
	providers: Array<ProviderInfo>;
};



export type ProviderModel = {
	name: string;
	description?: string | null;
};



export type QueryType = {
	type: string;
};



export type RSSDiscoveryRequest = {
	country: string;
	category_filter?: string | null;
	max_feeds?: number;
	max_items_per_feed?: number;
	bundle_id?: number | null;
	options?: Record<string, unknown> | null;
};



export type RegistrationStats = {
	total_users: number;
	users_created_today: number;
	users_created_this_week: number;
	users_created_this_month: number;
	open_registration_enabled: boolean;
	last_registration: string | null;
};



export type ReprocessOptions = {
	delimiter?: string | null;
	encoding?: string | null;
	skip_rows?: number | null;
	max_rows?: number | null;
	timeout?: number | null;
};



/**
 * Request object for search synthesizer
 */
export type Request = {
	query: string;
	query_type: QueryType;
};



export type ResourceType = 'source' | 'bundle' | 'asset' | 'schema' | 'infospace' | 'run' | 'package' | 'dataset' | 'mixed';



export type ResultStatus = 'success' | 'failed';



export type RssSourceCreateRequest = {
	feed_url: string;
	source_name?: string | null;
	auto_monitor?: boolean;
	monitoring_schedule?: string | null;
	target_bundle_id?: number | null;
	target_bundle_name?: string | null;
};



export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'completed_with_errors';



export type SearchHistoriesOut = {
	data: Array<SearchHistoryRead>;
	count: number;
};



export type SearchHistoryCreate = {
	query: string;
	filters?: Record<string, unknown> | null;
	result_count?: number | null;
};



export type SearchHistoryRead = {
	query: string;
	filters?: Record<string, unknown> | null;
	result_count?: number | null;
	id: number;
	user_id: number;
	timestamp: string;
};



export type SearchResultOut = {
	title: string;
	url: string;
	content: string;
	score?: number | null;
	raw?: Record<string, unknown> | null;
};



export type SearchResultsOut = {
	provider: string;
	results: Array<SearchResultOut>;
};



export type ShareableLinkCreate = {
	name?: string | null;
	permission_level?: PermissionLevel;
	is_public?: boolean;
	expiration_date?: string | null;
	max_uses?: number | null;
	resource_type: ResourceType;
	resource_id: number;
};



export type ShareableLinkRead = {
	name?: string | null;
	permission_level?: PermissionLevel;
	is_public?: boolean;
	expiration_date?: string | null;
	max_uses?: number | null;
	id: number;
	token: string;
	user_id: number;
	resource_type: ResourceType;
	resource_id: number;
	use_count: number;
	created_at: string;
	infospace_id?: number | null;
	readonly share_url: string;
};



export type ShareableLinkStats = {
	total_links: number;
	active_links: number;
	expired_links: number;
	links_by_resource_type: Record<string, number>;
	most_shared_resources: Array<Record<string, unknown>>;
	most_used_links: Array<Record<string, unknown>>;
};



export type ShareableLinkUpdate = {
	name?: string | null;
	permission_level?: PermissionLevel | null;
	is_public?: boolean | null;
	expiration_date?: string | null;
	max_uses?: number | null;
};



/**
 * The complete public-facing model for a shared resource view.
 */
export type SharedResourcePreview = {
	resource_type: ResourceType;
	name: string;
	description?: string | null;
	content: AssetPreview | BundlePreview | AnnotationRunPreview;
};



export type SourceCreateRequest = {
	name: string;
	kind: string;
	details?: Record<string, unknown>;
	enable_monitoring?: boolean;
	schedule?: string | null;
	target_bundle_id?: number | null;
	target_bundle_name?: string | null;
};



export type SourceRead = {
	name: string;
	kind: string;
	details?: Record<string, unknown>;
	id: number;
	uuid: string;
	infospace_id: number;
	user_id: number;
	status: string;
	created_at: string;
	updated_at: string;
	error_message: string | null;
	source_metadata?: Record<string, unknown> | null;
	monitoring_tasks?: Array<TaskRead>;
	/**
	 * True if the source has any enabled monitoring tasks.
	 */
	readonly is_monitored: boolean;
};



export type SourceTransferRequest = {
	source_ids: Array<number>;
	target_infospace_id: number;
	target_user_id: number;
};



export type SourceTransferResponse = {
	message: string;
	source_id: number;
	infospace_id: number;
};



export type SourceUpdate = {
	name?: string | null;
	kind?: string | null;
	details?: Record<string, unknown> | null;
};



export type SourcesOut = {
	data: Array<SourceRead>;
	count: number;
};



export type TaskCreate = {
	name: string;
	type: TaskType;
	schedule: string;
	configuration?: Record<string, unknown>;
	source_id?: number | null;
};



export type TaskRead = {
	name: string;
	type: TaskType;
	schedule: string;
	configuration?: Record<string, unknown>;
	id: number;
	infospace_id: number;
	status: TaskStatus;
	is_enabled: boolean;
	last_run_at: string | null;
	consecutive_failure_count: number;
};



export type TaskStatus = 'active' | 'paused' | 'error';



export type TaskType = 'ingest' | 'annotate' | 'pipeline' | 'monitor';



export type TaskUpdate = {
	name?: string | null;
	type?: TaskType | null;
	schedule?: string | null;
	configuration?: Record<string, unknown> | null;
	status?: TaskStatus | null;
	is_enabled?: boolean | null;
};



export type TasksOut = {
	data: Array<TaskRead>;
	count: number;
};



export type Token = {
	access_token: string;
	token_type?: string;
};



/**
 * Request to execute a tool call.
 */
export type ToolCallRequest = {
	tool_name: string;
	arguments: Record<string, unknown>;
	infospace_id: number;
};



export type UpdatePassword = {
	current_password: string;
	new_password: string;
};



export type UserBackupCreate = {
	name: string;
	description?: string | null;
	backup_type?: string;
	target_user_id: number;
	expires_at?: string | null;
};



export type UserBackupRead = {
	name: string;
	description?: string | null;
	backup_type: string;
	id: number;
	uuid: string;
	target_user_id: number;
	created_by_user_id: number;
	storage_path: string;
	file_size_bytes?: number | null;
	content_hash?: string | null;
	included_infospaces?: number;
	included_assets?: number;
	included_schemas?: number;
	included_runs?: number;
	included_annotations?: number;
	included_datasets?: number;
	status: string;
	error_message?: string | null;
	created_at: string;
	completed_at?: string | null;
	is_shareable?: boolean;
	share_token?: string | null;
	is_expired: boolean;
	is_ready: boolean;
	/**
	 * Generate download URL if shareable.
	 */
	readonly download_url: string | null;
};



export type UserBackupRestoreRequest = {
	backup_id: number;
	target_user_email?: string | null;
	conflict_strategy?: string;
};



export type UserBackupShareRequest = {
	backup_id: number;
	is_shareable?: boolean;
	expiration_hours?: number | null;
};



export type UserBackupUpdate = {
	name?: string | null;
	description?: string | null;
	is_shareable?: boolean | null;
};



export type UserBackupsOut = {
	data: Array<UserBackupRead>;
	count: number;
};



export type UserCreate = {
	email: string;
	full_name?: string | null;
	tier?: UserTier;
	profile_picture_url?: string | null;
	bio?: string | null;
	description?: string | null;
	password: string;
	is_superuser?: boolean;
	is_active?: boolean;
	send_welcome_email?: boolean;
};



export type UserCreateOpen = {
	email: string;
	password: string;
	full_name?: string | null;
	profile_picture_url?: string | null;
	bio?: string | null;
	description?: string | null;
};



export type UserOut = {
	email: string;
	full_name?: string | null;
	tier?: UserTier;
	profile_picture_url?: string | null;
	bio?: string | null;
	description?: string | null;
	id: number;
	is_active?: boolean;
	is_superuser?: boolean;
	created_at: string;
	updated_at: string;
};



/**
 * User profile statistics.
 */
export type UserProfileStats = {
	user_id: number;
	infospaces_count: number;
	assets_count: number;
	annotations_count: number;
	member_since: string;
};



/**
 * Dedicated schema for profile-only updates (no email/password).
 */
export type UserProfileUpdate = {
	full_name?: string | null;
	profile_picture_url?: string | null;
	/**
	 * Short bio (max 500 characters)
	 */
	bio?: string | null;
	/**
	 * Longer description (max 2000 characters)
	 */
	description?: string | null;
};



/**
 * Public user profile (no sensitive information).
 */
export type UserPublicProfile = {
	id: number;
	full_name?: string | null;
	profile_picture_url?: string | null;
	bio?: string | null;
	description?: string | null;
	created_at: string;
};



export type UserTier = 'tier_0' | 'free' | 'pro' | 'tier_1' | 'enterprise';



export type UserUpdate = {
	full_name?: string | null;
	email?: string | null;
	password?: string | null;
	is_active?: boolean | null;
	tier?: UserTier | null;
	profile_picture_url?: string | null;
	bio?: string | null;
	description?: string | null;
};



export type UserUpdateMe = {
	full_name?: string | null;
	email?: string | null;
	profile_picture_url?: string | null;
	/**
	 * Short bio (max 500 characters)
	 */
	bio?: string | null;
	/**
	 * Longer description (max 2000 characters)
	 */
	description?: string | null;
};



export type UsersOut = {
	data: Array<UserOut>;
	count: number;
};



export type ValidationError = {
	loc: Array<string | number>;
	msg: string;
	type: string;
};



export type app__api__v1__entities__routes__SearchType = 'text' | 'semantic';



export type app__api__v1__search__routes__SearchType = 'text' | 'semantic' | 'structured';

