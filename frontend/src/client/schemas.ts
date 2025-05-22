export const $AppendRecordInput = {
	description: `Input model for appending a record to a datasource.`,
	properties: {
		content: {
	type: 'string',
	description: `The text content or URL to append`,
	isRequired: true,
},
		content_type: {
	type: 'Enum',
	enum: ['text','url',],
	isRequired: true,
},
		title: {
	type: 'any-of',
	description: `Optional title for the record (used for 'text' type)`,
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		event_timestamp: {
	type: 'any-of',
	description: `Optional ISO 8601 timestamp for the event`,
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
} as const;

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

export const $Body_datasets_import_dataset = {
	properties: {
		file: {
	type: 'binary',
	description: `Dataset Package file (.zip)`,
	isRequired: true,
	format: 'binary',
},
	},
} as const;

export const $Body_datasources_create_datasource = {
	properties: {
		name: {
	type: 'string',
	isRequired: true,
},
		type: {
	type: 'DataSourceType',
	isRequired: true,
},
		origin_details: {
	type: 'any-of',
	contains: [{
	type: 'string',
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
		skip_rows: {
	type: 'any-of',
	description: `Number of initial rows to skip (for CSV)`,
	contains: [{
	type: 'number',
	minimum: 0,
}, {
	type: 'null',
}],
},
		delimiter: {
	type: 'any-of',
	description: `Single character delimiter (for CSV)`,
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $Body_datasources_update_datasource_urls = {
	properties: {
		urls_input: {
	type: 'array',
	contains: {
	type: 'string',
},
	isRequired: true,
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

export const $Body_shareables_export_resource = {
	properties: {
		resource_type: {
	type: 'ResourceType',
	isRequired: true,
},
		resource_id: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $Body_shareables_import_resource = {
	properties: {
		file: {
	type: 'binary',
	isRequired: true,
	format: 'binary',
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
		is_time_axis_hint: {
	type: 'any-of',
	contains: [{
	type: 'boolean',
}, {
	type: 'null',
}],
},
		request_justification: {
	type: 'any-of',
	description: `Request justification for this field. True enables, False disables, None inherits from scheme's global setting.`,
	contains: [{
	type: 'boolean',
}, {
	type: 'null',
}],
},
		request_bounding_boxes: {
	type: 'any-of',
	description: `Request bounding boxes for this field if global image analysis is enabled and the field's value could be derived from an image region.`,
	contains: [{
	type: 'boolean',
}, {
	type: 'null',
}],
},
		use_enum_for_labels: {
	type: 'any-of',
	description: `For LIST_STR with predefined labels, generate a strict enum in the Pydantic model for the LLM.`,
	contains: [{
	type: 'boolean',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $ClassificationJobCreate = {
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
		configuration: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
	isRequired: true,
},
	},
} as const;

export const $ClassificationJobRead = {
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
		configuration: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
		status: {
	type: 'ClassificationJobStatus',
	default: 'pending',
},
		error_message: {
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
		result_count: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		datarecord_count: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		target_scheme_ids: {
	type: 'array',
	contains: {
	type: 'number',
},
	isReadOnly: true,
	isRequired: true,
},
		target_datasource_ids: {
	type: 'array',
	contains: {
	type: 'number',
},
	isReadOnly: true,
	isRequired: true,
},
	},
} as const;

export const $ClassificationJobStatus = {
	type: 'Enum',
	enum: ['pending','running','paused','completed','completed_with_errors','failed',],
} as const;

export const $ClassificationJobUpdate = {
	properties: {
		status: {
	type: 'any-of',
	contains: [{
	type: 'ClassificationJobStatus',
}, {
	type: 'null',
}],
},
		error_message: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
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
		updated_at: {
	type: 'string',
	format: 'date-time',
},
	},
} as const;

export const $ClassificationJobsOut = {
	properties: {
		data: {
	type: 'array',
	contains: {
		type: 'ClassificationJobRead',
	},
	isRequired: true,
},
		count: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $ClassificationResultRead = {
	properties: {
		datarecord_id: {
	type: 'number',
	isRequired: true,
},
		scheme_id: {
	type: 'number',
	isRequired: true,
},
		job_id: {
	type: 'number',
	isRequired: true,
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
		status: {
	type: 'ClassificationResultStatus',
	default: 'success',
},
		error_message: {
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

export const $ClassificationResultStatus = {
	type: 'Enum',
	enum: ['success','failed',],
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
		default_thinking_budget: {
	type: 'any-of',
	description: `Default thinking budget (e.g., 1024) to use if justifications are requested. 0 disables thinking.`,
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		request_justifications_globally: {
	type: 'any-of',
	description: `If true, justification fields will be added for all applicable fields unless overridden at the field level.`,
	contains: [{
	type: 'boolean',
}, {
	type: 'null',
}],
},
		enable_image_analysis_globally: {
	type: 'any-of',
	description: `If true, indicates that this scheme might involve image analysis, and fields can request bounding boxes.`,
	contains: [{
	type: 'boolean',
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
		default_thinking_budget: {
	type: 'any-of',
	description: `Default thinking budget (e.g., 1024) to use if justifications are requested. 0 disables thinking.`,
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		request_justifications_globally: {
	type: 'any-of',
	description: `If true, justification fields will be added for all applicable fields unless overridden at the field level.`,
	contains: [{
	type: 'boolean',
}, {
	type: 'null',
}],
},
		enable_image_analysis_globally: {
	type: 'any-of',
	description: `If true, indicates that this scheme might involve image analysis, and fields can request bounding boxes.`,
	contains: [{
	type: 'boolean',
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
		job_count: {
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
		default_thinking_budget: {
	type: 'any-of',
	description: `Default thinking budget (e.g., 1024) to use if justifications are requested. 0 disables thinking.`,
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		request_justifications_globally: {
	type: 'any-of',
	description: `If true, justification fields will be added for all applicable fields unless overridden at the field level.`,
	contains: [{
	type: 'boolean',
}, {
	type: 'null',
}],
},
		enable_image_analysis_globally: {
	type: 'any-of',
	description: `If true, indicates that this scheme might involve image analysis, and fields can request bounding boxes.`,
	contains: [{
	type: 'boolean',
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

export const $CreateDatasetFromJobRequest = {
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
	},
} as const;

export const $CsvRowData = {
	properties: {
		row_data: {
	type: 'dictionary',
	contains: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	isRequired: true,
},
		row_number: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $CsvRowsOut = {
	properties: {
		data: {
	type: 'array',
	contains: {
		type: 'CsvRowData',
	},
	isRequired: true,
},
		total_rows: {
	type: 'number',
	isRequired: true,
},
		columns: {
	type: 'array',
	contains: {
	type: 'string',
},
	isRequired: true,
},
	},
} as const;

export const $DataRecordRead = {
	properties: {
		title: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		text_content: {
	type: 'string',
	isRequired: true,
},
		source_metadata: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
		event_timestamp: {
	type: 'any-of',
	contains: [{
	type: 'string',
	format: 'date-time',
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
		images: {
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
		id: {
	type: 'number',
	isRequired: true,
},
		datasource_id: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		created_at: {
	type: 'string',
	isRequired: true,
	format: 'date-time',
},
		content_hash: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $DataRecordUpdate = {
	description: `Schema for updating specific fields of a DataRecord.`,
	properties: {
		title: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		event_timestamp: {
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

export const $DataSourceRead = {
	properties: {
		name: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		type: {
	type: 'DataSourceType',
	isRequired: true,
},
		origin_details: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
		source_metadata: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
		status: {
	type: 'DataSourceStatus',
	default: 'pending',
},
		error_message: {
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
		data_record_count: {
	type: 'any-of',
	contains: [{
	type: 'number',
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

export const $DataSourceStatus = {
	type: 'Enum',
	enum: ['pending','processing','complete','failed',],
} as const;

export const $DataSourceTransferRequest = {
	properties: {
		source_workspace_id: {
	type: 'number',
	description: `ID of the workspace to transfer from`,
	isRequired: true,
},
		target_workspace_id: {
	type: 'number',
	description: `ID of the workspace to transfer to`,
	isRequired: true,
},
		datasource_ids: {
	type: 'array',
	contains: {
	type: 'number',
},
	isRequired: true,
},
		copy_datasources: {
	type: 'boolean',
	description: `If true, copy the datasources; if false, move them`,
	default: true,
},
	},
} as const;

export const $DataSourceTransferResponse = {
	properties: {
		success: {
	type: 'boolean',
	isRequired: true,
},
		message: {
	type: 'string',
	isRequired: true,
},
		new_datasource_ids: {
	type: 'any-of',
	description: `IDs of the newly created DataSources in the target workspace (if copied)`,
	contains: [{
	type: 'array',
	contains: {
	type: 'number',
},
}, {
	type: 'null',
}],
},
		errors: {
	type: 'any-of',
	description: `Dictionary of DataSource IDs that failed and the reason`,
	contains: [{
	type: 'dictionary',
	contains: {
	type: 'string',
},
}, {
	type: 'null',
}],
},
	},
} as const;

export const $DataSourceType = {
	type: 'Enum',
	enum: ['csv','pdf','bulk_pdf','url','url_list','text_block',],
} as const;

export const $DataSourceUpdate = {
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
		origin_details: {
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
		status: {
	type: 'any-of',
	contains: [{
	type: 'DataSourceStatus',
}, {
	type: 'null',
}],
},
		source_metadata: {
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
		error_message: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $DataSourcesOut = {
	properties: {
		data: {
	type: 'array',
	contains: {
		type: 'DataSourceRead',
	},
	isRequired: true,
},
		count: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $DatasetCreate = {
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
		custom_metadata: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
		datarecord_ids: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'number',
},
}, {
	type: 'null',
}],
},
		source_job_ids: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'number',
},
}, {
	type: 'null',
}],
},
		source_scheme_ids: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'number',
},
}, {
	type: 'null',
}],
},
	},
} as const;

export const $DatasetPackageEntitySummary = {
	properties: {
		entity_uuid: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
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
	},
} as const;

export const $DatasetPackageFileManifestItem = {
	properties: {
		filename: {
	type: 'string',
	isRequired: true,
},
		original_datasource_uuid: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		original_datasource_id: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		type: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		linked_datarecord_uuid: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $DatasetPackageSummary = {
	properties: {
		package_metadata: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
	isRequired: true,
},
		dataset_details: {
	type: 'DatasetPackageEntitySummary',
	isRequired: true,
},
		record_count: {
	type: 'number',
	default: 0,
},
		classification_results_count: {
	type: 'number',
	default: 0,
},
		included_schemes: {
	type: 'array',
	contains: {
		type: 'DatasetPackageEntitySummary',
	},
	default: [],
},
		included_jobs: {
	type: 'array',
	contains: {
		type: 'DatasetPackageEntitySummary',
	},
	default: [],
},
		linked_datasources_summary: {
	type: 'array',
	contains: {
		type: 'DatasetPackageEntitySummary',
	},
	default: [],
},
		source_files_manifest: {
	type: 'array',
	contains: {
		type: 'DatasetPackageFileManifestItem',
	},
	default: [],
},
	},
} as const;

export const $DatasetRead = {
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
		custom_metadata: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
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
		datarecord_ids: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'number',
},
}, {
	type: 'null',
}],
},
		source_job_ids: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'number',
},
}, {
	type: 'null',
}],
},
		source_scheme_ids: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'number',
},
}, {
	type: 'null',
}],
},
	},
} as const;

export const $DatasetUpdate = {
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
		custom_metadata: {
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
		datarecord_ids: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'number',
},
}, {
	type: 'null',
}],
},
		source_job_ids: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'number',
},
}, {
	type: 'null',
}],
},
		source_scheme_ids: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'number',
},
}, {
	type: 'null',
}],
},
		updated_at: {
	type: 'string',
	format: 'date-time',
},
	},
} as const;

export const $DatasetsOut = {
	properties: {
		data: {
	type: 'array',
	contains: {
		type: 'DatasetRead',
	},
	isRequired: true,
},
		count: {
	type: 'number',
	isRequired: true,
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

export const $EnhancedClassificationResultRead = {
	description: `Adds a processed 'display_value' based on the raw 'value'.`,
	properties: {
		datarecord_id: {
	type: 'number',
	isRequired: true,
},
		scheme_id: {
	type: 'number',
	isRequired: true,
},
		job_id: {
	type: 'number',
	isRequired: true,
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
		status: {
	type: 'ClassificationResultStatus',
	default: 'success',
},
		error_message: {
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

export const $ExportBatchRequest = {
	properties: {
		resource_type: {
	type: 'ResourceType',
	isRequired: true,
},
		resource_ids: {
	type: 'array',
	contains: {
	type: 'number',
},
	isRequired: true,
},
	},
} as const;

export const $FieldType = {
	type: 'Enum',
	enum: ['int','str','List[str]','List[Dict[str, any]]',],
} as const;

export const $FileUploadResponse = {
	properties: {
		filename: {
	type: 'string',
	description: `Original uploaded filename`,
	isRequired: true,
},
		object_name: {
	type: 'string',
	description: `Object name in storage`,
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

export const $ImportWorkspaceFromTokenRequest = {
	properties: {
		share_token: {
	type: 'string',
	isRequired: true,
},
		new_workspace_name: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
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

export const $PermissionLevel = {
	type: 'Enum',
	enum: ['read_only','edit','full_access',],
} as const;

export const $QueryType = {
	properties: {
		type: {
	type: 'string',
	isRequired: true,
},
	},
} as const;

export const $RecurringTaskCreate = {
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
		type: {
	type: 'RecurringTaskType',
	isRequired: true,
},
		schedule: {
	type: 'string',
	isRequired: true,
},
		configuration: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
		status: {
	type: 'RecurringTaskStatus',
	default: 'paused',
},
	},
} as const;

export const $RecurringTaskRead = {
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
		type: {
	type: 'RecurringTaskType',
	isRequired: true,
},
		schedule: {
	type: 'string',
	isRequired: true,
},
		configuration: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
		status: {
	type: 'RecurringTaskStatus',
	default: 'paused',
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
		last_run_at: {
	type: 'any-of',
	contains: [{
	type: 'string',
	format: 'date-time',
}, {
	type: 'null',
}],
},
		last_run_status: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		last_run_message: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		last_job_id: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $RecurringTaskStatus = {
	type: 'Enum',
	enum: ['active','paused','error',],
} as const;

export const $RecurringTaskType = {
	type: 'Enum',
	enum: ['ingest','classify',],
} as const;

export const $RecurringTaskUpdate = {
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
		schedule: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		configuration: {
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
		status: {
	type: 'any-of',
	contains: [{
	type: 'RecurringTaskStatus',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $RecurringTasksOut = {
	properties: {
		data: {
	type: 'array',
	contains: {
		type: 'RecurringTaskRead',
	},
	isRequired: true,
},
		count: {
	type: 'number',
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

export const $ResourceType = {
	type: 'Enum',
	enum: ['data_source','schema','workspace','classification_job','dataset',],
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

export const $SearchType = {
	type: 'Enum',
	enum: ['text','semantic','structured',],
} as const;

export const $ShareableLinkCreate = {
	description: `Schema for creating a new shareable link.`,
	properties: {
		resource_type: {
	type: 'ResourceType',
	isRequired: true,
},
		resource_id: {
	type: 'number',
	isRequired: true,
},
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
		permission_level: {
	type: 'PermissionLevel',
	default: 'read_only',
},
		is_public: {
	type: 'boolean',
	default: false,
},
		requires_login: {
	type: 'boolean',
	default: true,
},
		expiration_date: {
	type: 'any-of',
	contains: [{
	type: 'string',
	format: 'date-time',
}, {
	type: 'null',
}],
},
		max_uses: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $ShareableLinkRead = {
	description: `Schema for reading a shareable link.`,
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
		permission_level: {
	type: 'PermissionLevel',
	default: 'read_only',
},
		is_public: {
	type: 'boolean',
	default: false,
},
		requires_login: {
	type: 'boolean',
	default: true,
},
		expiration_date: {
	type: 'any-of',
	contains: [{
	type: 'string',
	format: 'date-time',
}, {
	type: 'null',
}],
},
		max_uses: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		id: {
	type: 'number',
	isRequired: true,
},
		token: {
	type: 'string',
	isRequired: true,
},
		user_id: {
	type: 'number',
	isRequired: true,
},
		resource_type: {
	type: 'ResourceType',
	isRequired: true,
},
		resource_id: {
	type: 'number',
	isRequired: true,
},
		use_count: {
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
		share_url: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $ShareableLinkStats = {
	properties: {
		total_links: {
	type: 'number',
	isRequired: true,
},
		active_links: {
	type: 'number',
	isRequired: true,
},
		expired_links: {
	type: 'number',
	isRequired: true,
},
		links_by_resource_type: {
	type: 'dictionary',
	contains: {
	type: 'number',
},
	isRequired: true,
},
		most_shared_resources: {
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
		most_used_links: {
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

export const $ShareableLinkUpdate = {
	description: `Schema for updating a shareable link.`,
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
		permission_level: {
	type: 'any-of',
	contains: [{
	type: 'PermissionLevel',
}, {
	type: 'null',
}],
},
		is_public: {
	type: 'any-of',
	contains: [{
	type: 'boolean',
}, {
	type: 'null',
}],
},
		requires_login: {
	type: 'any-of',
	contains: [{
	type: 'boolean',
}, {
	type: 'null',
}],
},
		expiration_date: {
	type: 'any-of',
	contains: [{
	type: 'string',
	format: 'date-time',
}, {
	type: 'null',
}],
},
		max_uses: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
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
		icon: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		system_prompt: {
	type: 'any-of',
	description: `System-level prompt applied to all classifications in this workspace.`,
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
		icon: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		system_prompt: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
	isRequired: true,
},
		id: {
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
		icon: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		system_prompt: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
} as const;