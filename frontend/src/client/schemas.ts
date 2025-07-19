export const $AnalysisAdapterRead = {
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
		input_schema_definition: {
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
		output_schema_definition: {
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
		version: {
	type: 'string',
	default: '1.0',
},
		module_path: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		adapter_type: {
	type: 'string',
	isRequired: true,
},
		is_public: {
	type: 'boolean',
	default: false,
},
		id: {
	type: 'number',
	isRequired: true,
},
		is_active: {
	type: 'boolean',
	isRequired: true,
},
		creator_user_id: {
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
		updated_at: {
	type: 'string',
	isRequired: true,
	format: 'date-time',
},
	},
} as const;

export const $AnnotationCreate = {
	properties: {
		value: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
	isRequired: true,
},
		status: {
	type: 'ResultStatus',
	default: 'success',
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
		region: {
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
		links: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
}, {
	type: 'null',
}],
},
		asset_id: {
	type: 'number',
	isRequired: true,
},
		schema_id: {
	type: 'number',
	isRequired: true,
},
		run_id: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $AnnotationRead = {
	properties: {
		value: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
	isRequired: true,
},
		status: {
	type: 'ResultStatus',
	default: 'success',
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
		region: {
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
		links: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'dictionary',
	contains: {
	properties: {
	},
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
		uuid: {
	type: 'string',
	isRequired: true,
},
		asset_id: {
	type: 'number',
	isRequired: true,
},
		schema_id: {
	type: 'number',
	isRequired: true,
},
		run_id: {
	type: 'number',
	isRequired: true,
},
		infospace_id: {
	type: 'number',
	isRequired: true,
},
		user_id: {
	type: 'number',
	isRequired: true,
},
		timestamp: {
	type: 'string',
	isRequired: true,
	format: 'date-time',
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
	},
} as const;

export const $AnnotationRunCreate = {
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
	default: {},
},
		include_parent_context: {
	type: 'boolean',
	default: false,
},
		context_window: {
	type: 'number',
	default: 0,
},
		views_config: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
}, {
	type: 'null',
}],
},
		schema_ids: {
	type: 'array',
	contains: {
	type: 'number',
},
	isRequired: true,
},
		target_asset_ids: {
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
		target_bundle_id: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $AnnotationRunPreview = {
	description: `Preview model for shared annotation runs.`,
	properties: {
		id: {
	type: 'number',
	isRequired: true,
},
		uuid: {
	type: 'string',
	isRequired: true,
},
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
		status: {
	type: 'RunStatus',
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
		completed_at: {
	type: 'any-of',
	contains: [{
	type: 'string',
	format: 'date-time',
}, {
	type: 'null',
}],
},
		views_config: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
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
	default: {},
},
		annotation_count: {
	type: 'number',
	default: 0,
},
		target_schemas: {
	type: 'array',
	contains: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
	default: [],
},
		annotations: {
	type: 'array',
	contains: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
	default: [],
},
	},
} as const;

export const $AnnotationRunRead = {
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
	default: {},
},
		include_parent_context: {
	type: 'boolean',
	default: false,
},
		context_window: {
	type: 'number',
	default: 0,
},
		views_config: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'dictionary',
	contains: {
	properties: {
	},
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
		uuid: {
	type: 'string',
	isRequired: true,
},
		infospace_id: {
	type: 'number',
	isRequired: true,
},
		user_id: {
	type: 'number',
	isRequired: true,
},
		status: {
	type: 'RunStatus',
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
		started_at: {
	type: 'any-of',
	contains: [{
	type: 'string',
	format: 'date-time',
}, {
	type: 'null',
}],
	isRequired: true,
},
		completed_at: {
	type: 'any-of',
	contains: [{
	type: 'string',
	format: 'date-time',
}, {
	type: 'null',
}],
	isRequired: true,
},
		error_message: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
	isRequired: true,
},
		annotation_count: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		schema_ids: {
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

export const $AnnotationRunUpdate = {
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
		include_parent_context: {
	type: 'any-of',
	contains: [{
	type: 'boolean',
}, {
	type: 'null',
}],
},
		context_window: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		views_config: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
}, {
	type: 'null',
}],
},
	},
} as const;

export const $AnnotationRunsOut = {
	properties: {
		data: {
	type: 'array',
	contains: {
		type: 'AnnotationRunRead',
	},
	isRequired: true,
},
		count: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $AnnotationSchemaCreate = {
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
		output_contract: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
	isRequired: true,
},
		instructions: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		version: {
	type: 'string',
	default: '1.0',
},
		field_specific_justification_configs: {
	type: 'any-of',
	contains: [{
	type: 'dictionary',
	contains: {
		type: 'FieldJustificationConfig',
	},
}, {
	type: 'null',
}],
},
	},
} as const;

export const $AnnotationSchemaRead = {
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
		output_contract: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
	isRequired: true,
},
		instructions: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		version: {
	type: 'string',
	default: '1.0',
},
		id: {
	type: 'number',
	isRequired: true,
},
		uuid: {
	type: 'string',
	isRequired: true,
},
		infospace_id: {
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
		field_specific_justification_configs: {
	type: 'any-of',
	contains: [{
	type: 'dictionary',
	contains: {
		type: 'FieldJustificationConfig',
	},
}, {
	type: 'null',
}],
},
		annotation_count: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		is_active: {
	type: 'boolean',
	isRequired: true,
},
	},
} as const;

export const $AnnotationSchemaUpdate = {
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
		output_contract: {
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
		instructions: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		version: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		field_specific_justification_configs: {
	type: 'any-of',
	contains: [{
	type: 'dictionary',
	contains: {
		type: 'FieldJustificationConfig',
	},
}, {
	type: 'null',
}],
},
		is_active: {
	type: 'any-of',
	contains: [{
	type: 'boolean',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $AnnotationSchemasOut = {
	properties: {
		data: {
	type: 'array',
	contains: {
		type: 'AnnotationSchemaRead',
	},
	isRequired: true,
},
		count: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $AnnotationUpdate = {
	properties: {
		value: {
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
	type: 'ResultStatus',
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
		region: {
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
		links: {
	type: 'any-of',
	contains: [{
	type: 'array',
	contains: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
},
}, {
	type: 'null',
}],
},
	},
} as const;

export const $AnnotationsOut = {
	properties: {
		data: {
	type: 'array',
	contains: {
		type: 'AnnotationRead',
	},
	isRequired: true,
},
		count: {
	type: 'number',
	isRequired: true,
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

export const $AssetChunkRead = {
	properties: {
		asset_id: {
	type: 'number',
	isRequired: true,
},
		chunk_index: {
	type: 'number',
	isRequired: true,
},
		text_content: {
	type: 'string',
	isRequired: true,
},
		chunk_metadata: {
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
		created_at: {
	type: 'string',
	isRequired: true,
	format: 'date-time',
},
	},
} as const;

export const $AssetCreate = {
	properties: {
		title: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		kind: {
	type: 'AssetKind',
	isRequired: true,
},
		user_id: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		infospace_id: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		parent_asset_id: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		part_index: {
	type: 'any-of',
	contains: [{
	type: 'number',
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
		blob_path: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		cells: {
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
		source_identifier: {
	type: 'any-of',
	contains: [{
	type: 'string',
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

export const $AssetKind = {
	type: 'Enum',
	enum: ['pdf','web','image','video','audio','text','csv','csv_row','mbox','email','pdf_page','text_chunk','image_region','video_scene','audio_segment','article','file',],
} as const;

export const $AssetPreview = {
	description: `A lightweight public representation of an Asset.`,
	properties: {
		id: {
	type: 'number',
	isRequired: true,
},
		title: {
	type: 'string',
	isRequired: true,
},
		kind: {
	type: 'AssetKind',
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
		text_content: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		blob_path: {
	type: 'any-of',
	contains: [{
	type: 'string',
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
		children: {
	type: 'array',
	contains: {
		type: 'AssetPreview',
	},
	default: [],
},
		is_container: {
	type: 'boolean',
	description: `Helper to know if this asset might have children (e.g., PDF, CSV).`,
	isReadOnly: true,
	isRequired: true,
},
	},
} as const;

export const $AssetRead = {
	properties: {
		title: {
	type: 'string',
	isRequired: true,
},
		kind: {
	type: 'AssetKind',
	isRequired: true,
},
		id: {
	type: 'number',
	isRequired: true,
},
		uuid: {
	type: 'string',
	isRequired: true,
},
		parent_asset_id: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
	isRequired: true,
},
		part_index: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
	isRequired: true,
},
		infospace_id: {
	type: 'number',
	isRequired: true,
},
		source_id: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
	isRequired: true,
},
		created_at: {
	type: 'string',
	isRequired: true,
	format: 'date-time',
},
		text_content: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		blob_path: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		source_identifier: {
	type: 'any-of',
	contains: [{
	type: 'string',
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
		content_hash: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		user_id: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		updated_at: {
	type: 'string',
	isRequired: true,
	format: 'date-time',
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
		processing_status: {
	type: 'ProcessingStatus',
	default: 'ready',
},
		processing_error: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		is_container: {
	type: 'boolean',
	description: `True if this asset can have child assets.`,
	isReadOnly: true,
	isRequired: true,
},
	},
} as const;

export const $AssetUpdate = {
	properties: {
		title: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		kind: {
	type: 'any-of',
	contains: [{
	type: 'AssetKind',
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
		blob_path: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		source_identifier: {
	type: 'any-of',
	contains: [{
	type: 'string',
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

export const $AssetsOut = {
	properties: {
		data: {
	type: 'array',
	contains: {
		type: 'AssetRead',
	},
	isRequired: true,
},
		count: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $Body_assets_add_files_to_bundle_background = {
	properties: {
		files: {
	type: 'array',
	contains: {
	type: 'binary',
	format: 'binary',
},
	isRequired: true,
},
		options: {
	type: 'string',
	default: '{}',
},
	},
} as const;

export const $Body_assets_create_assets_background_bulk = {
	properties: {
		files: {
	type: 'array',
	contains: {
	type: 'binary',
	format: 'binary',
},
	isRequired: true,
},
		options: {
	type: 'string',
	default: '{}',
},
	},
} as const;

export const $Body_assets_upload_file = {
	properties: {
		file: {
	type: 'binary',
	isRequired: true,
	format: 'binary',
},
		title: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		process_immediately: {
	type: 'boolean',
	default: true,
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
	format: 'password',
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

export const $BulkUrlIngestion = {
	properties: {
		urls: {
	type: 'array',
	contains: {
	type: 'string',
},
	isRequired: true,
},
		base_title: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		scrape_immediately: {
	type: 'boolean',
	default: true,
},
	},
} as const;

export const $BundleCreate = {
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
		tags: {
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
		asset_ids: {
	type: 'array',
	contains: {
	type: 'number',
},
	default: [],
},
		purpose: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		bundle_metadata: {
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
	},
} as const;

export const $BundlePreview = {
	description: `A lightweight public representation of a Bundle.`,
	properties: {
		id: {
	type: 'number',
	isRequired: true,
},
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
		assets: {
	type: 'array',
	contains: {
		type: 'AssetPreview',
	},
	isRequired: true,
},
	},
} as const;

export const $BundleRead = {
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
		tags: {
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
		infospace_id: {
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
		asset_count: {
	type: 'number',
	isRequired: true,
},
		uuid: {
	type: 'string',
	isRequired: true,
},
		user_id: {
	type: 'number',
	isRequired: true,
},
		purpose: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		bundle_metadata: {
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
	},
} as const;

export const $BundleUpdate = {
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
		tags: {
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
		purpose: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		bundle_metadata: {
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
	},
} as const;

export const $ChunkAssetRequest = {
	properties: {
		strategy: {
	type: 'string',
	default: 'token',
},
		chunk_size: {
	type: 'number',
	default: 512,
},
		chunk_overlap: {
	type: 'number',
	default: 50,
},
		overwrite_existing: {
	type: 'boolean',
	default: false,
},
	},
} as const;

export const $ChunkAssetsRequest = {
	properties: {
		asset_ids: {
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
		asset_kinds: {
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
		infospace_id: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		strategy: {
	type: 'string',
	default: 'token',
},
		chunk_size: {
	type: 'number',
	default: 512,
},
		chunk_overlap: {
	type: 'number',
	default: 50,
},
		overwrite_existing: {
	type: 'boolean',
	default: false,
},
	},
} as const;

export const $ChunkingResultResponse = {
	properties: {
		message: {
	type: 'string',
	isRequired: true,
},
		asset_id: {
	type: 'number',
	isRequired: true,
},
		chunks_created: {
	type: 'number',
	isRequired: true,
},
		strategy_used: {
	type: 'string',
	isRequired: true,
},
		strategy_params: {
	type: 'dictionary',
	contains: {
	properties: {
	},
},
	isRequired: true,
},
	},
} as const;

export const $ChunkingStatsResponse = {
	properties: {
		total_chunks: {
	type: 'number',
	isRequired: true,
},
		total_characters: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		average_chunk_size: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		assets_with_chunks: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		strategies_used: {
	type: 'any-of',
	contains: [{
	type: 'dictionary',
	contains: {
	type: 'number',
},
}, {
	type: 'null',
}],
},
	},
} as const;

export const $CreatePackageFromRunRequest = {
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
		asset_ids: {
	type: 'array',
	contains: {
	type: 'number',
},
	default: [],
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
		original_collection_uuid: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		original_collection_id: {
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
		linked_asset_uuid: {
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
		annotation_results_count: {
	type: 'number',
	default: 0,
},
		included_schemas: {
	type: 'array',
	contains: {
		type: 'DatasetPackageEntitySummary',
	},
	default: [],
},
		included_runs: {
	type: 'array',
	contains: {
		type: 'DatasetPackageEntitySummary',
	},
	default: [],
},
		linked_collections_summary: {
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
		id: {
	type: 'number',
	isRequired: true,
},
		infospace_id: {
	type: 'number',
	isRequired: true,
},
		asset_ids: {
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
		created_at: {
	type: 'string',
	isRequired: true,
	format: 'date-time',
},
		entity_uuid: {
	type: 'string',
	isRequired: true,
},
		user_id: {
	type: 'number',
	isRequired: true,
},
		updated_at: {
	type: 'string',
	isRequired: true,
	format: 'date-time',
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
		asset_ids: {
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

export const $EmbeddingGenerateRequest = {
	properties: {
		chunk_ids: {
	type: 'array',
	contains: {
	type: 'number',
},
	isRequired: true,
},
		model_name: {
	type: 'string',
	isRequired: true,
},
		provider: {
	type: 'string',
	isRequired: true,
},
	},
} as const;

export const $EmbeddingModelCreate = {
	properties: {
		name: {
	type: 'string',
	isRequired: true,
},
		provider: {
	type: 'string',
	isRequired: true,
},
		dimension: {
	type: 'number',
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
		config: {
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
		max_sequence_length: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $EmbeddingModelRead = {
	properties: {
		name: {
	type: 'string',
	isRequired: true,
},
		provider: {
	type: 'string',
	isRequired: true,
},
		dimension: {
	type: 'number',
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
		config: {
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
		max_sequence_length: {
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
		is_active: {
	type: 'boolean',
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
		embedding_time_ms: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $EmbeddingProvider = {
	type: 'Enum',
	enum: ['ollama','jina','openai','huggingface',],
} as const;

export const $EmbeddingSearchRequest = {
	properties: {
		query_text: {
	type: 'string',
	isRequired: true,
},
		model_name: {
	type: 'string',
	isRequired: true,
},
		provider: {
	type: 'string',
	isRequired: true,
},
		limit: {
	type: 'number',
	default: 10,
},
		distance_threshold: {
	type: 'number',
	default: 1,
},
		distance_function: {
	type: 'string',
	default: 'cosine',
},
	},
} as const;

export const $EmbeddingSearchResponse = {
	properties: {
		query_text: {
	type: 'string',
	isRequired: true,
},
		results: {
	type: 'array',
	contains: {
		type: 'EmbeddingSearchResult',
	},
	isRequired: true,
},
		model_name: {
	type: 'string',
	isRequired: true,
},
		distance_function: {
	type: 'string',
	isRequired: true,
},
	},
} as const;

export const $EmbeddingSearchResult = {
	properties: {
		chunk_id: {
	type: 'number',
	isRequired: true,
},
		asset_id: {
	type: 'number',
	isRequired: true,
},
		text_content: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
	isRequired: true,
},
		distance: {
	type: 'number',
	isRequired: true,
},
		similarity: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $EmbeddingStatsResponse = {
	properties: {
		model_id: {
	type: 'number',
	isRequired: true,
},
		model_name: {
	type: 'string',
	isRequired: true,
},
		provider: {
	type: 'string',
	isRequired: true,
},
		dimension: {
	type: 'number',
	isRequired: true,
},
		embedding_count: {
	type: 'number',
	isRequired: true,
},
		table_size: {
	type: 'string',
	isRequired: true,
},
		avg_embedding_time_ms: {
	type: 'any-of',
	contains: [{
	type: 'number',
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

export const $ExportMixedBatchRequest = {
	properties: {
		asset_ids: {
	type: 'array',
	contains: {
	type: 'number',
},
	default: [],
},
		bundle_ids: {
	type: 'array',
	contains: {
	type: 'number',
},
	default: [],
},
	},
} as const;

export const $FieldJustificationConfig = {
	properties: {
		enabled: {
	type: 'boolean',
	isRequired: true,
},
		custom_prompt: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
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

export const $ImportFromTokenRequest = {
	properties: {
		target_infospace_id: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $InfospaceCreate = {
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
		owner_id: {
	type: 'number',
	isRequired: true,
},
		vector_backend: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		embedding_model: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		embedding_dim: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		chunk_size: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		chunk_overlap: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		chunk_strategy: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $InfospaceRead = {
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
		id: {
	type: 'number',
	isRequired: true,
},
		owner_id: {
	type: 'number',
	isRequired: true,
},
		created_at: {
	type: 'string',
	isRequired: true,
	format: 'date-time',
},
	},
} as const;

export const $InfospaceUpdate = {
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
		vector_backend: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		embedding_model: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		embedding_dim: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		chunk_size: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		chunk_overlap: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		chunk_strategy: {
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
	},
} as const;

export const $InfospacesOut = {
	properties: {
		data: {
	type: 'array',
	contains: {
		type: 'InfospaceRead',
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

export const $PackageRead = {
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
		id: {
	type: 'number',
	isRequired: true,
},
		infospace_id: {
	type: 'number',
	isRequired: true,
},
		created_at: {
	type: 'string',
	isRequired: true,
	format: 'date-time',
},
	},
} as const;

export const $Paginated = {
	properties: {
		data: {
	type: 'array',
	contains: {
	properties: {
	},
},
	isRequired: true,
},
		count: {
	type: 'number',
	isRequired: true,
},
	},
} as const;

export const $PermissionLevel = {
	type: 'Enum',
	enum: ['read_only','edit','full_access',],
} as const;

export const $ProcessingStatus = {
	type: 'Enum',
	enum: ['ready','pending','processing','failed',],
} as const;

export const $ProviderInfo = {
	properties: {
		provider_name: {
	type: 'string',
	isRequired: true,
},
		models: {
	type: 'array',
	contains: {
		type: 'ProviderModel',
	},
	isRequired: true,
},
	},
} as const;

export const $ProviderListResponse = {
	properties: {
		providers: {
	type: 'array',
	contains: {
		type: 'ProviderInfo',
	},
	isRequired: true,
},
	},
} as const;

export const $ProviderModel = {
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

export const $ReprocessOptions = {
	properties: {
		delimiter: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		encoding: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		skip_rows: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		max_rows: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		timeout: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
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
	enum: ['source','bundle','asset','schema','infospace','run','package','dataset','mixed',],
} as const;

export const $ResultStatus = {
	type: 'Enum',
	enum: ['success','failed',],
} as const;

export const $RunStatus = {
	type: 'Enum',
	enum: ['pending','running','completed','failed','completed_with_errors',],
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

export const $SearchHistoryCreate = {
	properties: {
		query: {
	type: 'string',
	isRequired: true,
},
		filters: {
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
		result_count: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
	},
} as const;

export const $SearchHistoryRead = {
	properties: {
		query: {
	type: 'string',
	isRequired: true,
},
		filters: {
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
		result_count: {
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
		user_id: {
	type: 'number',
	isRequired: true,
},
		timestamp: {
	type: 'string',
	isRequired: true,
	format: 'date-time',
},
	},
} as const;

export const $SearchType = {
	type: 'Enum',
	enum: ['text','semantic','structured',],
} as const;

export const $ShareableLinkCreate = {
	properties: {
		name: {
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

export const $ShareableLinkRead = {
	properties: {
		name: {
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
		infospace_id: {
	type: 'any-of',
	contains: [{
	type: 'number',
}, {
	type: 'null',
}],
},
		share_url: {
	type: 'string',
	isReadOnly: true,
	isRequired: true,
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
	properties: {
		name: {
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

export const $SharedResourcePreview = {
	description: `The complete public-facing model for a shared resource view.`,
	properties: {
		resource_type: {
	type: 'ResourceType',
	isRequired: true,
},
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
		content: {
	type: 'any-of',
	contains: [{
	type: 'AssetPreview',
}, {
	type: 'BundlePreview',
}, {
	type: 'AnnotationRunPreview',
}],
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
		full_name: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		tier: {
	type: 'UserTier',
	default: 'tier_0',
},
		password: {
	type: 'string',
	isRequired: true,
},
		is_superuser: {
	type: 'boolean',
	default: false,
},
		is_active: {
	type: 'boolean',
	default: true,
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
		full_name: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		tier: {
	type: 'UserTier',
	default: 'tier_0',
},
		id: {
	type: 'number',
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
	},
} as const;

export const $UserTier = {
	type: 'Enum',
	enum: ['tier_0','free','pro','tier_1','enterprise',],
} as const;

export const $UserUpdate = {
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
		password: {
	type: 'any-of',
	contains: [{
	type: 'string',
}, {
	type: 'null',
}],
},
		tier: {
	type: 'any-of',
	contains: [{
	type: 'UserTier',
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