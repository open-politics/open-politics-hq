export const $ArticleResponse = {
	properties: {
		contents: {
	type: 'array',
	contains: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
	isRequired: true,
},
	},
} as const;

export const $Body_documents_bulk_upload_documents = {
	properties: {
		autofill: {
	type: 'boolean',
	default: false,
},
		files: {
	type: 'array',
	contains: {
	type: 'binary',
	format: 'binary',
},
	isRequired: true,
},
		content_type: {
	type: 'string',
	default: 'Document',
},
		source: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $Body_documents_create_document = {
	properties: {
		title: {
	type: 'string',
	isRequired: true,
},
		url: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		content_type: {
	type: 'string',
	default: 'article',
},
		source: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		text_content: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		summary: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		top_image: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		insertion_date: {
	type: 'any-of',
	contains: [{
	type: 'string',
	format: 'date-time',
}, {
	type: 'null',
}],
},
		files: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'binary',
	format: 'binary',
},
}, {
	type: 'null',
}],
},
	},
} as const;

export const $Body_documents_extract_document_metadata_from_pdf = {
	properties: {
		file: {
	type: 'binary',
	isRequired: true,
	format: 'binary',
},
	},
} as const;

export const $Body_filestorage_file_upload = {
	properties: {
		file: {
	type: 'binary',
	description: `File to upload`,
	isRequired: true,
	format: 'binary',
},
	},
} as const;

export const $Body_login_login_access_token = {
	properties: {
		grant_type: {
	type: 'any-of',
	contains: [{
	type: 'string',
	pattern: '^password$',
}, {
	type: 'null',
}],
},
		username: {
	type: 'string',
	isRequired: true,
},
		password: {
	type: 'string',
	isRequired: true,
},
		scope: {
	type: 'string',
	default: '',
},
		client_id: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		client_secret: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $Body_utils_extract_pdf_metadata = {
	properties: {
		file: {
	type: 'binary',
	isRequired: true,
	format: 'binary',
},
	},
} as const;

export const $Body_utils_extract_pdf_text = {
	properties: {
		file: {
	type: 'binary',
	isRequired: true,
	format: 'binary',
},
	},
} as const;

export const $ClassificationFieldCreate = {
	properties: {
		name: {
	type: 'string',
	isRequired: true,
},
		description: {
	type: 'string',
	isRequired: true,
},
		type: {
	type: 'FieldType',
	isRequired: true,
},
		scale_min: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		scale_max: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		is_set_of_labels: {
	type: 'any-of',
	contains: [{
	type: 'boolean',
}, {
	type: 'null',
}],
},
		labels: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'string',
},
}, {
	type: 'null',
}],
},
		dict_keys: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
		type: 'DictKeyDefinition',
	},
}, {
	type: 'null',
}],
},
	},
} as const;

export const $ClassificationResultCreate = {
	properties: {
		document_id: {
	type: 'number',
	isRequired: true,
},
		scheme_id: {
	type: 'number',
	isRequired: true,
},
		run_id: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		value: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
		timestamp: {
	type: 'any-of',
	contains: [{
	type: 'string',
	format: 'date-time',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $ClassificationResultRead = {
	properties: {
		document_id: {
	type: 'number',
	isRequired: true,
},
		scheme_id: {
	type: 'number',
	isRequired: true,
},
		run_id: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		value: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
		timestamp: {
	type: 'string',
	format: 'date-time',
},
		id: {
	type: 'number',
	isRequired: true,
},
		document: {
	type: 'DocumentRead',
	isRequired: true,
},
		scheme: {
	type: 'ClassificationSchemeRead',
	isRequired: true,
},
	},
} as const;

export const $ClassificationRunCreate = {
	properties: {
		status: {
	properties: {
	},
},
	},
} as const;

export const $ClassificationRunRead = {
	properties: {
		status: {
	properties: {
	},
},
	},
} as const;

export const $ClassificationRunStatus = {
	type: 'Enum',
	enum: ['pending','running','completed','failed',],
} as const;

export const $ClassificationRunUpdate = {
	properties: {
		name: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		description: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		status: {
	type: 'any-of',
	contains: [{
	type: 'ClassificationRunStatus',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $ClassificationRunsOut = {
	properties: {
		data: {
	type: 'array',
	contains: {
		type: 'ClassificationRunRead',
	},
	isRequired: true,
},
		count: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $ClassificationSchemeCreate = {
	properties: {
		name: {
	type: 'string',
	isRequired: true,
},
		description: {
	type: 'string',
	isRequired: true,
},
		model_instructions: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		validation_rules: {
	type: 'any-of',
	contains: [{
	type: 'dictionary',
	contains: {
	properties: {
	},
},
}, {
	type: 'null',
}],
},
		fields: {
	type: 'array',
	contains: {
		type: 'ClassificationFieldCreate',
	},
	isRequired: true,
},
	},
} as const;

export const $ClassificationSchemeRead = {
	properties: {
		name: {
	type: 'string',
	isRequired: true,
},
		description: {
	type: 'string',
	isRequired: true,
},
		model_instructions: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		validation_rules: {
	type: 'any-of',
	contains: [{
	type: 'dictionary',
	contains: {
	properties: {
	},
},
}, {
	type: 'null',
}],
},
		id: {
	type: 'number',
	isRequired: true,
},
		workspace_id: {
	type: 'number',
	isRequired: true,
},
		user_id: {
	type: 'number',
	isRequired: true,
},
		created_at: {
	type: 'string',
	isRequired: true,
	format: 'date-time',
},
		updated_at: {
	type: 'string',
	isRequired: true,
	format: 'date-time',
},
		fields: {
	type: 'array',
	contains: {
		type: 'ClassificationFieldCreate',
	},
	isRequired: true,
},
		classification_count: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		document_count: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $ClassificationSchemeUpdate = {
	properties: {
		name: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		description: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		model_instructions: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		validation_rules: {
	type: 'any-of',
	contains: [{
	type: 'dictionary',
	contains: {
	properties: {
	},
},
}, {
	type: 'null',
}],
},
		fields: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
		type: 'ClassificationFieldCreate',
	},
}, {
	type: 'null',
}],
},
	},
} as const;

export const $DictKeyDefinition = {
	properties: {
		name: {
	type: 'string',
	isRequired: true,
},
		type: {
	type: 'Enum',
	enum: ['str','int','float','bool',],
	isRequired: true,
},
	},
} as const;

export const $DocumentRead = {
	properties: {
		title: {
	type: 'string',
	isRequired: true,
},
		url: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		content_type: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		source: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		top_image: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		text_content: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		summary: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		insertion_date: {
	type: 'string',
	format: 'date-time',
},
		id: {
	type: 'number',
	isRequired: true,
},
		workspace_id: {
	type: 'number',
	isRequired: true,
},
		user_id: {
	type: 'number',
	isRequired: true,
},
		files: {
	type: 'array',
	contains: {
		type: 'FileRead',
	},
	default: [],
},
	},
} as const;

export const $DocumentUpdate = {
	properties: {
		title: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		url: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		content_type: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		source: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		top_image: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		text_content: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		summary: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		insertion_date: {
	type: 'any-of',
	contains: [{
	type: 'string',
	format: 'date-time',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $EnhancedClassificationResultRead = {
	description: `Adds a processed 'display_value' based on the raw 'value' and scheme.`,
	properties: {
		document_id: {
	type: 'number',
	isRequired: true,
},
		scheme_id: {
	type: 'number',
	isRequired: true,
},
		run_id: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		value: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
		timestamp: {
	type: 'string',
	format: 'date-time',
},
		id: {
	type: 'number',
	isRequired: true,
},
		document: {
	type: 'DocumentRead',
	isRequired: true,
},
		scheme: {
	type: 'ClassificationSchemeRead',
	isRequired: true,
},
		display_value: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'string',
}, {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
}, {
	type: 'array',
	contains: {
	properties: {
	},
},
}, {
	type: 'null',
}],
},
	},
} as const;

export const $FieldType = {
	type: 'Enum',
	enum: ['int','str','List[str]','List[Dict[str, any]]',],
} as const;

export const $FileRead = {
	properties: {
		name: {
	type: 'string',
	isRequired: true,
},
		filetype: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		size: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		url: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		caption: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		media_type: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		top_image: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		id: {
	type: 'number',
	isRequired: true,
},
		document_id: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $FileUploadResponse = {
	properties: {
		filename: {
	type: 'string',
	description: `Uploaded filename`,
	isRequired: true,
},
		storage_id: {
	type: 'string',
	description: `Storage ID`,
	isRequired: true,
},
	},
} as const;

export const $HTTPValidationError = {
	properties: {
		detail: {
	type: 'array',
	contains: {
		type: 'ValidationError',
	},
},
	},
} as const;

export const $ItemCreate = {
	properties: {
		title: {
	type: 'string',
	isRequired: true,
},
		description: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $ItemOut = {
	properties: {
		title: {
	type: 'string',
	isRequired: true,
},
		description: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		id: {
	type: 'number',
	isRequired: true,
},
		owner_id: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $ItemUpdate = {
	properties: {
		title: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		description: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $ItemsOut = {
	properties: {
		data: {
	type: 'array',
	contains: {
		type: 'ItemOut',
	},
	isRequired: true,
},
		count: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $Message = {
	properties: {
		message: {
	type: 'string',
	isRequired: true,
},
	},
} as const;

export const $MostRelevantEntitiesRequest = {
	properties: {
		article_ids: {
	type: 'array',
	contains: {
	type: 'string',
},
	isRequired: true,
},
	},
} as const;

export const $NewPassword = {
	properties: {
		token: {
	type: 'string',
	isRequired: true,
},
		new_password: {
	type: 'string',
	isRequired: true,
},
	},
} as const;

export const $QueryType = {
	properties: {
		type: {
	type: 'string',
	isRequired: true,
},
	},
} as const;

export const $Request = {
	description: `Request object for search synthesizer`,
	properties: {
		query: {
	type: 'string',
	isRequired: true,
},
		query_type: {
	type: 'QueryType',
	isRequired: true,
},
	},
} as const;

export const $SavedResultSetCreate = {
	properties: {
		name: {
	type: 'string',
	isRequired: true,
},
		document_ids: {
	type: 'array',
	contains: {
	type: 'number',
},
	default: [],
},
		scheme_ids: {
	type: 'array',
	contains: {
	type: 'number',
},
	default: [],
},
	},
} as const;

export const $SavedResultSetRead = {
	properties: {
		name: {
	type: 'string',
	isRequired: true,
},
		document_ids: {
	type: 'array',
	contains: {
	type: 'number',
},
	default: [],
},
		scheme_ids: {
	type: 'array',
	contains: {
	type: 'number',
},
	default: [],
},
		id: {
	type: 'number',
	isRequired: true,
},
		workspace_id: {
	type: 'number',
	isRequired: true,
},
		created_at: {
	type: 'string',
	isRequired: true,
	format: 'date-time',
},
		updated_at: {
	type: 'string',
	isRequired: true,
	format: 'date-time',
},
		results: {
	type: 'array',
	contains: {
		type: 'ClassificationResultRead',
	},
},
	},
} as const;

export const $SearchHistoriesOut = {
	properties: {
		data: {
	type: 'array',
	contains: {
		type: 'SearchHistoryRead',
	},
	isRequired: true,
},
		count: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $SearchHistory = {
	properties: {
		query: {
	type: 'string',
	isRequired: true,
},
		timestamp: {
	type: 'string',
	format: 'date-time',
},
		id: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		user_id: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $SearchHistoryCreate = {
	properties: {
		query: {
	type: 'string',
	isRequired: true,
},
		timestamp: {
	type: 'string',
	format: 'date-time',
},
	},
} as const;

export const $SearchHistoryRead = {
	properties: {
		query: {
	type: 'string',
	isRequired: true,
},
		timestamp: {
	type: 'string',
	format: 'date-time',
},
		id: {
	type: 'number',
	isRequired: true,
},
		user_id: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $Token = {
	properties: {
		access_token: {
	type: 'string',
	isRequired: true,
},
		token_type: {
	type: 'string',
	default: 'bearer',
},
	},
} as const;

export const $UpdatePassword = {
	properties: {
		current_password: {
	type: 'string',
	isRequired: true,
},
		new_password: {
	type: 'string',
	isRequired: true,
},
	},
} as const;

export const $UserCreate = {
	properties: {
		email: {
	type: 'string',
	isRequired: true,
},
		is_active: {
	type: 'boolean',
	default: true,
},
		is_superuser: {
	type: 'boolean',
	default: false,
},
		full_name: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		password: {
	type: 'string',
	isRequired: true,
},
	},
} as const;

export const $UserCreateOpen = {
	properties: {
		email: {
	type: 'string',
	isRequired: true,
},
		password: {
	type: 'string',
	isRequired: true,
},
		full_name: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $UserOut = {
	properties: {
		email: {
	type: 'string',
	isRequired: true,
},
		is_active: {
	type: 'boolean',
	default: true,
},
		is_superuser: {
	type: 'boolean',
	default: false,
},
		full_name: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		id: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $UserUpdate = {
	properties: {
		email: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		is_active: {
	type: 'boolean',
	default: true,
},
		is_superuser: {
	type: 'boolean',
	default: false,
},
		full_name: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		password: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $UserUpdateMe = {
	properties: {
		full_name: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		email: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $UsersOut = {
	properties: {
		data: {
	type: 'array',
	contains: {
		type: 'UserOut',
	},
	isRequired: true,
},
		count: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $ValidationError = {
	properties: {
		loc: {
	type: 'array',
	contains: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'number',
}],
},
	isRequired: true,
},
		msg: {
	type: 'string',
	isRequired: true,
},
		type: {
	type: 'string',
	isRequired: true,
},
	},
} as const;

export const $WorkspaceCreate = {
	properties: {
		name: {
	type: 'string',
	isRequired: true,
},
		description: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		sources: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'string',
},
}, {
	type: 'null',
}],
},
		icon: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $WorkspaceRead = {
	properties: {
		name: {
	type: 'string',
	isRequired: true,
},
		description: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		sources: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'string',
},
}, {
	type: 'null',
}],
},
		icon: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		uid: {
	type: 'number',
	isRequired: true,
},
		created_at: {
	type: 'string',
	isRequired: true,
	format: 'date-time',
},
		updated_at: {
	type: 'string',
	isRequired: true,
	format: 'date-time',
},
		user_id_ownership: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $WorkspaceUpdate = {
	properties: {
		name: {
	type: 'string',
	isRequired: true,
},
		description: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		sources: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'string',
},
}, {
	type: 'null',
}],
},
		icon: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $app__api__v1__entities__routes__SearchType = {
	type: 'Enum',
	enum: ['text','semantic',],
} as const;

export const $app__api__v1__search__routes__SearchType = {
	type: 'Enum',
	enum: ['text','semantic','structured',],
} as const;