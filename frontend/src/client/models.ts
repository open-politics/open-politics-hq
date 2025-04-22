export type ArticleResponse = {
	contents: Array<Record<string, unknown>>;
};



export type Body_datasources_create_datasource = {
	name: string;
	type: DataSourceType;
	origin_details?: string | null;
	file?: Blob | File | null;
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
	target_scheme_ids?: Array<number>;
	target_datasource_ids?: Array<number>;
	result_count?: number | null;
	datarecord_count?: number | null;
};



/**
 * Defines the execution status of a ClassificationJob.
 */
export type ClassificationJobStatus = 'pending' | 'running' | 'completed' | 'completed_with_errors' | 'failed';



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
	row_data: Record<string, unknown>;
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
	id: number;
	datasource_id: number;
	created_at: string;
};



export type DataSourceRead = {
	name: string;
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
};



/**
 * Defines the processing status of a DataSource.
 */
export type DataSourceStatus = 'pending' | 'processing' | 'complete' | 'failed';



/**
 * Defines the type of data source.
 */
export type DataSourceType = 'csv' | 'pdf' | 'url_list' | 'text_block';



export type DataSourcesOut = {
	data: Array<DataSourceRead>;
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
	 * Uploaded filename
	 */
	filename: string;
	/**
	 * Storage ID
	 */
	storage_id: string;
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



export type QueryType = {
	type: string;
};



/**
 * Request object for search synthesizer
 */
export type Request = {
	query: string;
	query_type: QueryType;
};



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



export type app__api__v1__entities__routes__SearchType = 'text' | 'semantic';



export type app__api__v1__search__routes__SearchType = 'text' | 'semantic' | 'structured';

