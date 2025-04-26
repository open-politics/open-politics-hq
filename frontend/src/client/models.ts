/**
 * Input model for appending a record to a datasource.
 */
export type AppendRecordInput = {
	/**
	 * The text content or URL to append
	 */
	content: string;
	/**
	 * Type of content being appended
	 */
	content_type: 'text' | 'url';
	/**
	 * Optional ISO 8601 timestamp for the event
	 */
	event_timestamp?: string | null;
};




export type ArticleResponse = {
	contents: Array<Record<string, unknown>>;
};



export type Body_datasets_import_dataset = {
	/**
	 * Dataset Package JSON file (.json)
	 */
	file: Blob | File;
};



export type Body_datasources_create_datasource = {
	name: string;
	type: DataSourceType;
	origin_details?: string | null;
	files?: Array<Blob | File> | null;
	/**
	 * Number of initial rows to skip (for CSV)
	 */
	skip_rows?: number | null;
	/**
	 * Single character delimiter (for CSV)
	 */
	delimiter?: string | null;
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



export type Body_shareables_import_resource = {
	file: Blob | File;
};



export type Body_utils_extract_pdf_metadata = {
	file: Blob | File;
};



export type Body_utils_extract_pdf_text = {
	file: Blob | File;
};



export type ClassificationFieldCreate = {
	name: string;
	description: string;
	type: FieldType;
	scale_min?: number | null;
	scale_max?: number | null;
	is_set_of_labels?: boolean | null;
	labels?: Array<string> | null;
	dict_keys?: Array<DictKeyDefinition> | null;
	is_time_axis_hint?: boolean | null;
};



export type ClassificationJobCreate = {
	name: string;
	description?: string | null;
	configuration: Record<string, unknown>;
};



export type ClassificationJobRead = {
	name: string;
	description?: string | null;
	configuration?: Record<string, unknown>;
	status?: ClassificationJobStatus;
	error_message?: string | null;
	id: number;
	workspace_id: number;
	user_id: number;
	created_at: string;
	updated_at: string;
	result_count?: number | null;
	datarecord_count?: number | null;
	readonly target_scheme_ids: Array<number>;
	readonly target_datasource_ids: Array<number>;
};



/**
 * Defines the execution status of a ClassificationJob.
 */
export type ClassificationJobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'completed_with_errors' | 'failed';



export type ClassificationJobUpdate = {
	status?: ClassificationJobStatus | null;
	error_message?: string | null;
	updated_at?: string;
};



export type ClassificationJobsOut = {
	data: Array<ClassificationJobRead>;
	count: number;
};



export type ClassificationResultRead = {
	datarecord_id: number;
	scheme_id: number;
	job_id: number;
	value?: Record<string, unknown>;
	timestamp?: string;
	id: number;
};



export type ClassificationSchemeCreate = {
	name: string;
	description: string;
	model_instructions?: string | null;
	validation_rules?: Record<string, unknown> | null;
	fields: Array<ClassificationFieldCreate>;
};



export type ClassificationSchemeRead = {
	name: string;
	description: string;
	model_instructions?: string | null;
	validation_rules?: Record<string, unknown> | null;
	id: number;
	workspace_id: number;
	user_id: number;
	created_at: string;
	updated_at: string;
	fields: Array<ClassificationFieldCreate>;
	classification_count?: number | null;
	job_count?: number | null;
};



export type ClassificationSchemeUpdate = {
	name?: string | null;
	description?: string | null;
	model_instructions?: string | null;
	validation_rules?: Record<string, unknown> | null;
};



export type CsvRowData = {
	row_data: Record<string, string | null>;
	row_number: number;
};



export type CsvRowsOut = {
	data: Array<CsvRowData>;
	total_rows: number;
	columns: Array<string>;
};



export type DataRecordRead = {
	text_content: string;
	source_metadata?: Record<string, unknown>;
	event_timestamp?: string | null;
	id: number;
	datasource_id?: number | null;
	created_at: string;
	content_hash?: string | null;
};



export type DataSourceRead = {
	name?: string | null;
	type: DataSourceType;
	origin_details?: Record<string, unknown>;
	source_metadata?: Record<string, unknown>;
	status?: DataSourceStatus;
	error_message?: string | null;
	id: number;
	workspace_id: number;
	user_id: number;
	created_at: string;
	updated_at: string;
	data_record_count?: number | null;
	description?: string | null;
};



/**
 * Defines the processing status of a DataSource.
 */
export type DataSourceStatus = 'pending' | 'processing' | 'complete' | 'failed';



/**
 * Defines the type of data source.
 */
export type DataSourceType = 'csv' | 'pdf' | 'bulk_pdf' | 'url' | 'url_list' | 'text_block';



export type DataSourceUpdate = {
	status?: DataSourceStatus | null;
	source_metadata?: Record<string, unknown> | null;
	error_message?: string | null;
	updated_at?: string;
};



export type DataSourcesOut = {
	data: Array<DataSourceRead>;
	count: number;
};



export type DatasetCreate = {
	name: string;
	description?: string | null;
	custom_metadata?: Record<string, unknown>;
	datarecord_ids?: Array<number> | null;
	source_job_ids?: Array<number> | null;
	source_scheme_ids?: Array<number> | null;
};



export type DatasetRead = {
	name: string;
	description?: string | null;
	custom_metadata?: Record<string, unknown>;
	id: number;
	workspace_id: number;
	user_id: number;
	created_at: string;
	updated_at: string;
	datarecord_ids?: Array<number> | null;
	source_job_ids?: Array<number> | null;
	source_scheme_ids?: Array<number> | null;
};



export type DatasetUpdate = {
	name?: string | null;
	description?: string | null;
	custom_metadata?: Record<string, unknown> | null;
	datarecord_ids?: Array<number> | null;
	source_job_ids?: Array<number> | null;
	source_scheme_ids?: Array<number> | null;
	updated_at?: string;
};



export type DatasetsOut = {
	data: Array<DatasetRead>;
	count: number;
};



export type DictKeyDefinition = {
	name: string;
	type: 'str' | 'int' | 'float' | 'bool';
};




/**
 * Adds a processed 'display_value' based on the raw 'value'.
 */
export type EnhancedClassificationResultRead = {
	datarecord_id: number;
	scheme_id: number;
	job_id: number;
	value?: Record<string, unknown>;
	timestamp?: string;
	id: number;
	display_value?: number | string | Record<string, unknown> | Array<unknown> | null;
};



/**
 * Defines the data type for a ClassificationField.
 */
export type FieldType = 'int' | 'str' | 'List[str]' | 'List[Dict[str, any]]';



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



export type ItemCreate = {
	title: string;
	description?: string | null;
};



export type ItemOut = {
	title: string;
	description?: string | null;
	id: number;
	owner_id: number;
};



export type ItemUpdate = {
	title?: string | null;
	description?: string | null;
};



export type ItemsOut = {
	data: Array<ItemOut>;
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



/**
 * Enumeration of permission levels for shared resources.
 */
export type PermissionLevel = 'read_only' | 'edit' | 'full_access';



export type QueryType = {
	type: string;
};



export type RecurringTaskCreate = {
	name: string;
	description?: string | null;
	type: RecurringTaskType;
	schedule: string;
	configuration?: Record<string, unknown>;
	status?: RecurringTaskStatus;
};



export type RecurringTaskRead = {
	name: string;
	description?: string | null;
	type: RecurringTaskType;
	schedule: string;
	configuration?: Record<string, unknown>;
	status?: RecurringTaskStatus;
	id: number;
	workspace_id: number;
	user_id: number;
	created_at: string;
	updated_at: string;
	last_run_at?: string | null;
	last_run_status?: string | null;
	last_run_message?: string | null;
	last_job_id?: number | null;
};



/**
 * Defines the status of a recurring task.
 */
export type RecurringTaskStatus = 'active' | 'paused' | 'error';



/**
 * Defines the type of recurring task.
 */
export type RecurringTaskType = 'ingest' | 'classify';



export type RecurringTaskUpdate = {
	name?: string | null;
	description?: string | null;
	schedule?: string | null;
	configuration?: Record<string, unknown> | null;
	status?: RecurringTaskStatus | null;
};



export type RecurringTasksOut = {
	data: Array<RecurringTaskRead>;
	count: number;
};



/**
 * Request object for search synthesizer
 */
export type Request = {
	query: string;
	query_type: QueryType;
};



/**
 * Enumeration of resource types that can be shared.
 */
export type ResourceType = 'data_source' | 'schema' | 'workspace' | 'classification_job' | 'dataset';



export type SearchHistoriesOut = {
	data: Array<SearchHistoryRead>;
	count: number;
};



export type SearchHistory = {
	query: string;
	timestamp?: string;
	id?: number | null;
	user_id: number;
};



export type SearchHistoryCreate = {
	query: string;
	timestamp?: string;
};



export type SearchHistoryRead = {
	query: string;
	timestamp?: string;
	id: number;
	user_id: number;
};



export type SearchType = 'text' | 'semantic' | 'structured';



/**
 * Schema for creating a new shareable link.
 */
export type ShareableLinkCreate = {
	resource_type: ResourceType;
	resource_id: number;
	name?: string | null;
	description?: string | null;
	permission_level?: PermissionLevel;
	is_public?: boolean;
	requires_login?: boolean;
	expiration_date?: string | null;
	max_uses?: number | null;
};



/**
 * Schema for reading a shareable link.
 */
export type ShareableLinkRead = {
	name?: string | null;
	description?: string | null;
	permission_level?: PermissionLevel;
	is_public?: boolean;
	requires_login?: boolean;
	expiration_date?: string | null;
	max_uses?: number | null;
	id: number;
	token: string;
	user_id: number;
	resource_type: ResourceType;
	resource_id: number;
	use_count: number;
	created_at: string;
	updated_at: string;
	share_url?: string | null;
};



export type ShareableLinkStats = {
	total_links: number;
	active_links: number;
	expired_links: number;
	links_by_resource_type: Record<string, number>;
	most_shared_resources: Array<Record<string, unknown>>;
	most_used_links: Array<Record<string, unknown>>;
};



/**
 * Schema for updating a shareable link.
 */
export type ShareableLinkUpdate = {
	name?: string | null;
	description?: string | null;
	permission_level?: PermissionLevel | null;
	is_public?: boolean | null;
	requires_login?: boolean | null;
	expiration_date?: string | null;
	max_uses?: number | null;
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
	is_active?: boolean;
	is_superuser?: boolean;
	full_name?: string | null;
	password: string;
};



export type UserCreateOpen = {
	email: string;
	password: string;
	full_name?: string | null;
};



export type UserOut = {
	email: string;
	is_active?: boolean;
	is_superuser?: boolean;
	full_name?: string | null;
	id: number;
};



export type UserUpdate = {
	email?: string | null;
	is_active?: boolean;
	is_superuser?: boolean;
	full_name?: string | null;
	password?: string | null;
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



export type WorkspaceCreate = {
	name: string;
	description?: string | null;
	icon?: string | null;
};



export type WorkspaceRead = {
	name: string;
	description?: string | null;
	icon?: string | null;
	id: number;
	created_at: string;
	updated_at: string;
	user_id_ownership: number;
};



export type WorkspaceUpdate = {
	name?: string | null;
	description?: string | null;
	icon?: string | null;
};

