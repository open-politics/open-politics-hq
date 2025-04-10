export type ArticleResponse = {
	contents: Array<Record<string, unknown>>;
};



export type Body_documents_bulk_upload_documents = {
	autofill?: boolean;
	files: Array<Blob | File>;
	content_type?: string;
	source?: string | null;
};



export type Body_documents_create_document = {
	title: string;
	url?: string | null;
	content_type?: string;
	source?: string | null;
	text_content?: string | null;
	summary?: string | null;
	top_image?: string | null;
	insertion_date?: string | null;
	files?: Array<Blob | File> | null;
};



export type Body_documents_extract_document_metadata_from_pdf = {
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



export type ClassificationResultCreate = {
	document_id: number;
	scheme_id: number;
	run_id?: number | null;
	value?: Record<string, unknown>;
	timestamp?: string | null;
};



export type ClassificationResultRead = {
	document_id: number;
	scheme_id: number;
	run_id?: number | null;
	value?: Record<string, unknown>;
	timestamp?: string;
	id: number;
	document: DocumentRead;
	scheme: ClassificationSchemeRead;
};



export type ClassificationRunCreate = {
	status?: unknown;
};



export type ClassificationRunRead = {
	status?: unknown;
};



/**
 * Defines the possible states of a ClassificationRun.
 */
export type ClassificationRunStatus = 'pending' | 'running' | 'completed' | 'failed';



export type ClassificationRunUpdate = {
	name?: string | null;
	description?: string | null;
	status?: ClassificationRunStatus | null;
};



export type ClassificationRunsOut = {
	data: Array<ClassificationRunRead>;
	count: number;
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
	document_count?: number | null;
};



export type ClassificationSchemeUpdate = {
	name?: string | null;
	description?: string | null;
	model_instructions?: string | null;
	validation_rules?: Record<string, unknown> | null;
	fields?: Array<ClassificationFieldCreate> | null;
};



export type DictKeyDefinition = {
	name: string;
	type: 'str' | 'int' | 'float' | 'bool';
};




export type DocumentRead = {
	title: string;
	url?: string | null;
	content_type?: string | null;
	source?: string | null;
	top_image?: string | null;
	text_content?: string | null;
	summary?: string | null;
	insertion_date?: string;
	id: number;
	workspace_id: number;
	user_id: number;
	files?: Array<FileRead>;
};



export type DocumentUpdate = {
	title?: string | null;
	url?: string | null;
	content_type?: string | null;
	source?: string | null;
	top_image?: string | null;
	text_content?: string | null;
	summary?: string | null;
	insertion_date?: string | null;
};



/**
 * Adds a processed 'display_value' based on the raw 'value' and scheme.
 */
export type EnhancedClassificationResultRead = {
	document_id: number;
	scheme_id: number;
	run_id?: number | null;
	value?: Record<string, unknown>;
	timestamp?: string;
	id: number;
	document: DocumentRead;
	scheme: ClassificationSchemeRead;
	display_value?: number | string | Record<string, unknown> | Array<unknown> | null;
};



/**
 * Defines the data type for a ClassificationField.
 */
export type FieldType = 'int' | 'str' | 'List[str]' | 'List[Dict[str, any]]';



export type FileRead = {
	name: string;
	filetype?: string | null;
	size?: number | null;
	url?: string | null;
	caption?: string | null;
	media_type?: string | null;
	top_image?: string | null;
	id: number;
	document_id: number;
};



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



export type SavedResultSetCreate = {
	name: string;
	document_ids?: Array<number>;
	scheme_ids?: Array<number>;
};



export type SavedResultSetRead = {
	name: string;
	document_ids?: Array<number>;
	scheme_ids?: Array<number>;
	id: number;
	workspace_id: number;
	created_at: string;
	updated_at: string;
	results?: Array<ClassificationResultRead>;
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
	sources?: Array<string> | null;
	icon?: string | null;
};



export type WorkspaceRead = {
	name: string;
	description?: string | null;
	sources?: Array<string> | null;
	icon?: string | null;
	uid: number;
	created_at: string;
	updated_at: string;
	user_id_ownership: number;
};



export type WorkspaceUpdate = {
	name: string;
	description?: string | null;
	sources?: Array<string> | null;
	icon?: string | null;
};



export type app__api__v1__entities__routes__SearchType = 'text' | 'semantic';



export type app__api__v1__search__routes__SearchType = 'text' | 'semantic' | 'structured';

