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



export type AnnotationRunCreate = {
	name: string;
	description?: string | null;
	configuration?: Record<string, unknown>;
	include_parent_context?: boolean;
	context_window?: number;
	schema_ids: Array<number>;
	target_asset_ids?: Array<number> | null;
	target_bundle_id?: number | null;
};



export type AnnotationRunRead = {
	name: string;
	description?: string | null;
	configuration?: Record<string, unknown>;
	include_parent_context?: boolean;
	context_window?: number;
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



export type ArticleResponse = {
	contents: Array<Record<string, unknown>>;
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



export type Body_login_login_access_token = {
	grant_type?: string | null;
	username: string;
	password: string;
	scope?: string;
	client_id?: string | null;
	client_secret?: string | null;
};



export type Body_shareables_export_resource = {
	resource_type: ResourceType;
	resource_id: number;
};



export type Body_shareables_import_resource = {
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
	assets?: Array<AssetPreview>;
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



export type Message = {
	message: string;
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



/**
 * Status for asset processing (creating child assets).
 */
export type ProcessingStatus = 'ready' | 'pending' | 'processing' | 'failed';



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



export type SearchType = 'text' | 'semantic' | 'structured';



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
	content: AssetPreview | BundlePreview;
};



export type Token = {
	access_token: string;
	token_type?: string;
};



export type UpdatePassword = {
	current_password: string;
	new_password: string;
};



export type UserCreate = {
	email: string;
	full_name?: string | null;
	tier?: UserTier;
	password: string;
	is_superuser?: boolean;
	is_active?: boolean;
};



export type UserCreateOpen = {
	email: string;
	password: string;
	full_name?: string | null;
};



export type UserOut = {
	email: string;
	full_name?: string | null;
	tier?: UserTier;
	id: number;
	is_active?: boolean;
	is_superuser?: boolean;
};



export type UserTier = 'tier_0' | 'free' | 'pro' | 'tier_1' | 'enterprise';



export type UserUpdate = {
	full_name?: string | null;
	email?: string | null;
	password?: string | null;
	tier?: UserTier | null;
};



export type UserUpdateMe = {
	full_name?: string | null;
	email?: string | null;
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

