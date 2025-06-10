import type { CancelablePromise } from './core/CancelablePromise';
import { OpenAPI } from './core/OpenAPI';
import { request as __request } from './core/request';

import type { AssetCreate,AssetRead,AssetsOut,AssetUpdate,Body_assets_add_files_to_bundle_background,Body_assets_create_assets_background_bulk,Body_assets_upload_file,BulkUrlIngestion,Message,ReprocessOptions,AnnotationRunCreate,AnnotationRunRead,AnnotationRunsOut,AnnotationRunUpdate,CreatePackageFromRunRequest,PackageRead,AnnotationSchemaCreate,AnnotationSchemaRead,AnnotationSchemasOut,AnnotationSchemaUpdate,AnnotationCreate,AnnotationRead,AnnotationsOut,AnnotationUpdate,BundleCreate,BundleRead,BundleUpdate,Body_datasets_import_dataset,DatasetCreate,DatasetRead,DatasetsOut,DatasetUpdate,Body_filestorage_file_upload,FileUploadResponse,InfospaceCreate,InfospaceRead,InfospacesOut,InfospaceUpdate,Body_login_login_access_token,NewPassword,Token,UserOut,SearchHistoriesOut,SearchHistoryCreate,SearchHistoryRead,Body_shareables_export_resource,Body_shareables_import_resource,DatasetPackageSummary,ExportBatchRequest,Paginated,ResourceType,ShareableLinkCreate,ShareableLinkRead,ShareableLinkStats,ShareableLinkUpdate,UpdatePassword,UserCreate,UserCreateOpen,UsersOut,UserUpdate,UserUpdateMe,Body_utils_extract_pdf_metadata,Body_utils_extract_pdf_text,ProviderListResponse,Request,MostRelevantEntitiesRequest,SearchType,ArticleResponse } from './models';

export type AssetsData = {
        CreateAsset: {
                    infospaceId: number
requestBody: AssetCreate
                    
                };
CreateAsset1: {
                    infospaceId: number
requestBody: AssetCreate
                    
                };
ListAssets: {
                    infospaceId: number
limit?: number
parentAssetId?: number | null
skip?: number
                    
                };
ListAssets1: {
                    infospaceId: number
limit?: number
parentAssetId?: number | null
skip?: number
                    
                };
CreateAsset2: {
                    infospaceId: number
requestBody: AssetCreate
                    
                };
CreateAsset3: {
                    infospaceId: number
requestBody: AssetCreate
                    
                };
ListAssets2: {
                    infospaceId: number
limit?: number
parentAssetId?: number | null
skip?: number
                    
                };
ListAssets3: {
                    infospaceId: number
limit?: number
parentAssetId?: number | null
skip?: number
                    
                };
UploadFile: {
                    formData: Body_assets_upload_file
infospaceId: number
                    
                };
UploadFile1: {
                    formData: Body_assets_upload_file
infospaceId: number
                    
                };
IngestUrl: {
                    infospaceId: number
scrapeImmediately?: boolean
title?: string | null
url: string
                    
                };
IngestUrl1: {
                    infospaceId: number
scrapeImmediately?: boolean
title?: string | null
url: string
                    
                };
IngestText: {
                    eventTimestamp?: string | null
infospaceId: number
textContent: string
title?: string | null
                    
                };
IngestText1: {
                    eventTimestamp?: string | null
infospaceId: number
textContent: string
title?: string | null
                    
                };
BulkIngestUrls: {
                    infospaceId: number
requestBody: BulkUrlIngestion
                    
                };
BulkIngestUrls1: {
                    infospaceId: number
requestBody: BulkUrlIngestion
                    
                };
ReprocessAsset: {
                    assetId: number
infospaceId: number
requestBody: ReprocessOptions
                    
                };
ReprocessAsset1: {
                    assetId: number
infospaceId: number
requestBody: ReprocessOptions
                    
                };
GetAsset: {
                    assetId: number
infospaceId: number
                    
                };
GetAsset1: {
                    assetId: number
infospaceId: number
                    
                };
UpdateAsset: {
                    assetId: number
infospaceId: number
requestBody: AssetUpdate
                    
                };
UpdateAsset1: {
                    assetId: number
infospaceId: number
requestBody: AssetUpdate
                    
                };
DeleteAsset: {
                    assetId: number
infospaceId: number
                    
                };
DeleteAsset1: {
                    assetId: number
infospaceId: number
                    
                };
GetAssetChildren: {
                    assetId: number
infospaceId: number
limit?: number
skip?: number
                    
                };
GetAssetChildren1: {
                    assetId: number
infospaceId: number
limit?: number
skip?: number
                    
                };
CreateAssetsBackgroundBulk: {
                    formData: Body_assets_create_assets_background_bulk
infospaceId: number
                    
                };
CreateAssetsBackgroundBulk1: {
                    formData: Body_assets_create_assets_background_bulk
infospaceId: number
                    
                };
CreateAssetsBackgroundUrls: {
                    infospaceId: number
requestBody: BulkUrlIngestion
                    
                };
CreateAssetsBackgroundUrls1: {
                    infospaceId: number
requestBody: BulkUrlIngestion
                    
                };
AddFilesToBundleBackground: {
                    bundleId: number
formData: Body_assets_add_files_to_bundle_background
infospaceId: number
                    
                };
AddFilesToBundleBackground1: {
                    bundleId: number
formData: Body_assets_add_files_to_bundle_background
infospaceId: number
                    
                };
GetTaskStatus: {
                    taskId: string
                    
                };
GetTaskStatus1: {
                    taskId: string
                    
                };
    }

export type AnnotationJobsData = {
        CreateRun: {
                    infospaceId: number
requestBody: AnnotationRunCreate
                    
                };
ListRuns: {
                    /**
 * Include counts of annotations and assets
 */
includeCounts?: boolean
infospaceId: number
limit?: number
skip?: number
                    
                };
CreateRun1: {
                    infospaceId: number
requestBody: AnnotationRunCreate
                    
                };
ListRuns1: {
                    /**
 * Include counts of annotations and assets
 */
includeCounts?: boolean
infospaceId: number
limit?: number
skip?: number
                    
                };
GetRun: {
                    /**
 * Include counts of annotations and assets
 */
includeCounts?: boolean
infospaceId: number
runId: number
                    
                };
UpdateRun: {
                    infospaceId: number
requestBody: AnnotationRunUpdate
runId: number
                    
                };
DeleteRun: {
                    infospaceId: number
runId: number
                    
                };
RetryFailedAnnotations: {
                    infospaceId: number
runId: number
                    
                };
CreatePackageFromRunEndpoint: {
                    infospaceId: number
requestBody: CreatePackageFromRunRequest
runId: number
                    
                };
    }

export type RunsData = {
        CreateRun: {
                    infospaceId: number
requestBody: AnnotationRunCreate
                    
                };
ListRuns: {
                    /**
 * Include counts of annotations and assets
 */
includeCounts?: boolean
infospaceId: number
limit?: number
skip?: number
                    
                };
CreateRun1: {
                    infospaceId: number
requestBody: AnnotationRunCreate
                    
                };
ListRuns1: {
                    /**
 * Include counts of annotations and assets
 */
includeCounts?: boolean
infospaceId: number
limit?: number
skip?: number
                    
                };
GetRun: {
                    /**
 * Include counts of annotations and assets
 */
includeCounts?: boolean
infospaceId: number
runId: number
                    
                };
UpdateRun: {
                    infospaceId: number
requestBody: AnnotationRunUpdate
runId: number
                    
                };
DeleteRun: {
                    infospaceId: number
runId: number
                    
                };
RetryFailedAnnotations: {
                    infospaceId: number
runId: number
                    
                };
CreatePackageFromRunEndpoint: {
                    infospaceId: number
requestBody: CreatePackageFromRunRequest
runId: number
                    
                };
    }

export type AnnotationSchemesData = {
        CreateAnnotationSchema: {
                    infospaceId: number
requestBody: AnnotationSchemaCreate
                    
                };
ListAnnotationSchemas: {
                    /**
 * Include counts of annotations using this schema
 */
includeCounts?: boolean
infospaceId: number
limit?: number
skip?: number
                    
                };
CreateAnnotationSchema1: {
                    infospaceId: number
requestBody: AnnotationSchemaCreate
                    
                };
ListAnnotationSchemas1: {
                    /**
 * Include counts of annotations using this schema
 */
includeCounts?: boolean
infospaceId: number
limit?: number
skip?: number
                    
                };
GetAnnotationSchema: {
                    /**
 * Include counts of annotations using this schema
 */
includeCounts?: boolean
infospaceId: number
schemaId: number
                    
                };
UpdateAnnotationSchema: {
                    infospaceId: number
requestBody: AnnotationSchemaUpdate
schemaId: number
                    
                };
DeleteAnnotationSchema: {
                    infospaceId: number
schemaId: number
                    
                };
    }

export type AnnotationSchemasData = {
        CreateAnnotationSchema: {
                    infospaceId: number
requestBody: AnnotationSchemaCreate
                    
                };
ListAnnotationSchemas: {
                    /**
 * Include counts of annotations using this schema
 */
includeCounts?: boolean
infospaceId: number
limit?: number
skip?: number
                    
                };
CreateAnnotationSchema1: {
                    infospaceId: number
requestBody: AnnotationSchemaCreate
                    
                };
ListAnnotationSchemas1: {
                    /**
 * Include counts of annotations using this schema
 */
includeCounts?: boolean
infospaceId: number
limit?: number
skip?: number
                    
                };
GetAnnotationSchema: {
                    /**
 * Include counts of annotations using this schema
 */
includeCounts?: boolean
infospaceId: number
schemaId: number
                    
                };
UpdateAnnotationSchema: {
                    infospaceId: number
requestBody: AnnotationSchemaUpdate
schemaId: number
                    
                };
DeleteAnnotationSchema: {
                    infospaceId: number
schemaId: number
                    
                };
    }

export type AnnotationsData = {
        CreateAnnotation: {
                    infospaceId: number
requestBody: AnnotationCreate
                    
                };
CreateAnnotation1: {
                    infospaceId: number
requestBody: AnnotationCreate
                    
                };
ListAnnotations: {
                    infospaceId: number
limit?: number
schemaId?: number | null
skip?: number
sourceId?: number | null
                    
                };
ListAnnotations1: {
                    infospaceId: number
limit?: number
schemaId?: number | null
skip?: number
sourceId?: number | null
                    
                };
CreateAnnotation2: {
                    infospaceId: number
requestBody: AnnotationCreate
                    
                };
CreateAnnotation3: {
                    infospaceId: number
requestBody: AnnotationCreate
                    
                };
ListAnnotations2: {
                    infospaceId: number
limit?: number
schemaId?: number | null
skip?: number
sourceId?: number | null
                    
                };
ListAnnotations3: {
                    infospaceId: number
limit?: number
schemaId?: number | null
skip?: number
sourceId?: number | null
                    
                };
GetAnnotation: {
                    annotationId: number
infospaceId: number
                    
                };
GetAnnotation1: {
                    annotationId: number
infospaceId: number
                    
                };
UpdateAnnotation: {
                    annotationId: number
infospaceId: number
requestBody: AnnotationUpdate
                    
                };
UpdateAnnotation1: {
                    annotationId: number
infospaceId: number
requestBody: AnnotationUpdate
                    
                };
DeleteAnnotation: {
                    annotationId: number
infospaceId: number
                    
                };
DeleteAnnotation1: {
                    annotationId: number
infospaceId: number
                    
                };
CreateBatchAnnotations: {
                    infospaceId: number
requestBody: Array<AnnotationCreate>
                    
                };
CreateBatchAnnotations1: {
                    infospaceId: number
requestBody: Array<AnnotationCreate>
                    
                };
GetRunResults: {
                    infospaceId: number
limit?: number
runId: number
skip?: number
                    
                };
GetRunResults1: {
                    infospaceId: number
limit?: number
runId: number
skip?: number
                    
                };
RetrySingleAnnotation: {
                    annotationId: number
infospaceId: number
                    
                };
RetrySingleAnnotation1: {
                    annotationId: number
infospaceId: number
                    
                };
RetryFailedAnnotations: {
                    infospaceId: number
runId: number
                    
                };
RetryFailedAnnotations1: {
                    infospaceId: number
runId: number
                    
                };
    }

export type BundlesData = {
        CreateBundle: {
                    infospaceId: number
requestBody: BundleCreate
                    
                };
GetBundles: {
                    infospaceId: number
limit?: number
skip?: number
                    
                };
GetBundle: {
                    bundleId: number
                    
                };
UpdateBundle: {
                    bundleId: number
requestBody: BundleUpdate
                    
                };
DeleteBundle: {
                    bundleId: number
                    
                };
AddAssetToBundle: {
                    assetId: number
bundleId: number
                    
                };
RemoveAssetFromBundle: {
                    assetId: number
bundleId: number
                    
                };
GetAssetsInBundle: {
                    bundleId: number
limit?: number
skip?: number
                    
                };
GetAsset: {
                    assetId: number
                    
                };
TransferBundle: {
                    bundleId: number
copy?: boolean
targetInfospaceId: number
                    
                };
    }

export type DatasetsData = {
        CreateDataset: {
                    infospaceId: number
requestBody: DatasetCreate
                    
                };
ListDatasets: {
                    infospaceId: number
limit?: number
skip?: number
                    
                };
CreateDataset1: {
                    infospaceId: number
requestBody: DatasetCreate
                    
                };
ListDatasets1: {
                    infospaceId: number
limit?: number
skip?: number
                    
                };
GetDataset: {
                    datasetId: number
infospaceId: number
                    
                };
UpdateDataset: {
                    datasetId: number
infospaceId: number
requestBody: DatasetUpdate
                    
                };
DeleteDataset: {
                    datasetId: number
infospaceId: number
                    
                };
ExportDataset: {
                    datasetId: number
/**
 * Include full text content of data records
 */
includeContent?: boolean
/**
 * Include associated classification results
 */
includeResults?: boolean
/**
 * Include original source files (PDFs, CSVs, etc.)
 */
includeSourceFiles?: boolean
infospaceId: number
                    
                };
ImportDataset: {
                    /**
 * How to handle conflicts
 */
conflictStrategy?: string
formData: Body_datasets_import_dataset
infospaceId: number
                    
                };
ImportDatasetFromToken: {
                    /**
 * How to handle conflicts
 */
conflictStrategy?: string
/**
 * Include full text content if available
 */
includeContent?: boolean
/**
 * Include classification results if available
 */
includeResults?: boolean
infospaceId: number
/**
 * Share token for the dataset
 */
shareToken: string
                    
                };
    }

export type FilestorageData = {
        FileUpload: {
                    formData: Body_filestorage_file_upload
                    
                };
FileDownload: {
                    filePath: string
                    
                };
ListFiles: {
                    maxKeys?: number
prefix?: string | null
                    
                };
DeleteFile: {
                    objectName: string
                    
                };
StreamFile: {
                    filePath: string
                    
                };
    }

export type FilesData = {
        FileUpload: {
                    formData: Body_filestorage_file_upload
                    
                };
FileDownload: {
                    filePath: string
                    
                };
ListFiles: {
                    maxKeys?: number
prefix?: string | null
                    
                };
DeleteFile: {
                    objectName: string
                    
                };
StreamFile: {
                    filePath: string
                    
                };
    }

export type AppData = {
        
    }

export type InfospacesData = {
        CreateInfospace: {
                    requestBody: InfospaceCreate
                    
                };
ListInfospaces: {
                    limit?: number
skip?: number
                    
                };
CreateInfospace1: {
                    requestBody: InfospaceCreate
                    
                };
ListInfospaces1: {
                    limit?: number
skip?: number
                    
                };
GetInfospace: {
                    infospaceId: number
                    
                };
UpdateInfospace: {
                    infospaceId: number
requestBody: InfospaceUpdate
                    
                };
DeleteInfospace: {
                    infospaceId: number
                    
                };
GetInfospaceStats: {
                    infospaceId: number
                    
                };
ImportInfospace: {
                    infospaceId: number
                    
                };
    }

export type LoginData = {
        LoginAccessToken: {
                    formData: Body_login_login_access_token
                    
                };
RecoverPassword: {
                    email: string
                    
                };
ResetPassword: {
                    requestBody: NewPassword
                    
                };
RecoverPasswordHtmlContent: {
                    email: string
                    
                };
    }

export type SearchHistoryData = {
        CreateSearchHistory: {
                    requestBody: SearchHistoryCreate
                    
                };
ReadSearchHistories: {
                    limit?: number
skip?: number
                    
                };
    }

export type ShareablesData = {
        CreateShareableLink: {
                    infospaceId: number
requestBody: ShareableLinkCreate
                    
                };
GetShareableLinks: {
                    infospaceId: number
resourceId?: number | null
resourceType?: ResourceType | null
                    
                };
GetShareableLinkByToken: {
                    token: string
                    
                };
UpdateShareableLink: {
                    linkId: number
requestBody: ShareableLinkUpdate
                    
                };
DeleteShareableLink: {
                    linkId: number
                    
                };
AccessSharedResource: {
                    token: string
                    
                };
GetSharingStats: {
                    infospaceId: number
                    
                };
ExportResource: {
                    formData: Body_shareables_export_resource
infospaceId: number
                    
                };
ImportResource: {
                    formData: Body_shareables_import_resource
targetInfospaceId: number
                    
                };
ExportResourcesBatch: {
                    infospaceId: number
requestBody: ExportBatchRequest
                    
                };
ViewDatasetPackageSummary: {
                    token: string
                    
                };
    }

export type UsersData = {
        ReadUsers: {
                    limit?: number
skip?: number
                    
                };
CreateUser: {
                    requestBody: UserCreate
                    
                };
ReadUsers1: {
                    limit?: number
skip?: number
                    
                };
CreateUser1: {
                    requestBody: UserCreate
                    
                };
UpdateUserMe: {
                    requestBody: UserUpdateMe
                    
                };
UpdatePasswordMe: {
                    requestBody: UpdatePassword
                    
                };
CreateUserOpen: {
                    requestBody: UserCreateOpen
                    
                };
ReadUserById: {
                    userId: number
                    
                };
UpdateUser: {
                    requestBody: UserUpdate
userId: number
                    
                };
DeleteUser: {
                    userId: number
                    
                };
    }

export type UtilsData = {
        TestEmail: {
                    emailTo: string
                    
                };
ExtractPdfText: {
                    formData: Body_utils_extract_pdf_text
                    
                };
ExtractPdfMetadata: {
                    formData: Body_utils_extract_pdf_metadata
                    
                };
ScrapeArticle: {
                    url: string
                    
                };
    }

export type UtilitiesData = {
        TestEmail: {
                    emailTo: string
                    
                };
ExtractPdfText: {
                    formData: Body_utils_extract_pdf_text
                    
                };
ExtractPdfMetadata: {
                    formData: Body_utils_extract_pdf_metadata
                    
                };
ScrapeArticle: {
                    url: string
                    
                };
    }

export type EntitiesData = {
        SearchEntities: {
                    /**
 * Maximum number of records to return
 */
limit?: number
/**
 * Search query for entities
 */
query: string
/**
 * Number of records to skip
 */
skip?: number
                    
                };
GetEntityDetails: {
                    /**
 * Entity for details
 */
entity: string
/**
 * Maximum number of records to return
 */
limit?: number
/**
 * Number of records to skip
 */
skip?: number
                    
                };
SearchEntities1: {
                    /**
 * Maximum number of records to return
 */
limit?: number
/**
 * Search query for entities
 */
query: string
/**
 * Number of records to skip
 */
skip?: number
                    
                };
GetEntityDetails1: {
                    /**
 * Entity for details
 */
entity: string
/**
 * Maximum number of records to return
 */
limit?: number
/**
 * Number of records to skip
 */
skip?: number
                    
                };
    }

export type LocationsData = {
        GetLocationContents: {
                    limit?: number
location: string
skip?: number
                    
                };
GetLocationEntitiesContents: {
                    limit?: number
location: string
skip?: number
                    
                };
LocationFromQuery: {
                    query: string
                    
                };
GeojsonEventsView: {
                    eventType: string
                    
                };
GetLocationEntities: {
                    limit?: number
locationName: string
minRelevance?: number
skip?: number
                    
                };
GetLeaderInfo: {
                    state: string
                    
                };
GetLegislationData: {
                    state: string
                    
                };
GetEconData: {
                    indicators?: Array<string>
state: string
                    
                };
GetCoordinates: {
                    language?: string
location: string
                    
                };
GetGeojsonForArticleIds: {
                    requestBody: Array<string>
                    
                };
GetLocationMetadata: {
                    location: string
                    
                };
ChannelRoute: {
                    path: string
requestBody: Request
serviceName: string
                    
                };
    }

export type SearchData = {
        GetContents: {
                    classificationScores?: string | null
entities?: Array<string> | null
excludeKeywords?: Array<string> | null
keyword?: string | null
keywordWeights?: string | null
limit?: number
locations?: Array<string> | null
newsCategory?: string | null
searchQuery?: string | null
searchType?: SearchType
secondaryCategories?: Array<string> | null
skip?: number
topics?: Array<string> | null
                    
                };
GetMostRelevantEntities: {
                    requestBody: MostRelevantEntitiesRequest
                    
                };
SearchSynthesizer: {
                    searchQuery: string
                    
                };
    }

export type ArticlesData = {
        GetArticles: {
                    /**
 * Maximum number of articles to return
 */
limit?: number
/**
 * Search query for articles
 */
query: string
/**
 * Number of articles to skip
 */
skip?: number
                    
                };
ArticlesByEntity: {
                    /**
 * Date for articles
 */
date?: string
/**
 * Entity for articles
 */
entity: string
                    
                };
ArticlesByEntity1: {
                    /**
 * Date for articles
 */
date?: string
/**
 * Entity for articles
 */
entity: string
                    
                };
ArticleById: {
                    /**
 * Content ID of the article
 */
id: string
                    
                };
    }

export type GeoData = {
        GeojsonEventsView: {
                    args: unknown
/**
 * ISO formatted end date (e.g. 2023-12-31T23:59:59+00:00)
 */
endDate?: string
eventType: string
kwargs: unknown
/**
 * Maximum number of locations to return
 */
limit?: number
/**
 * ISO formatted start date (e.g. 2023-01-01T00:00:00+00:00)
 */
startDate?: string
                    
                };
GeojsonRawView: {
                    args: unknown
/**
 * ISO formatted end date (e.g. 2023-12-31T23:59:59+00:00)
 */
endDate?: string
kwargs: unknown
/**
 * Maximum number of locations to return
 */
limit?: number
/**
 * ISO formatted start date (e.g. 2023-01-01T00:00:00+00:00)
 */
startDate?: string
                    
                };
    }

export type ScoresData = {
        GetEntityScoresInTimeframe: {
                    entity: string
timeframeFrom?: string
timeframeTo?: string
                    
                };
    }

export class AssetsService {

	/**
	 * Create Asset
	 * Generic asset creation endpoint that routes to appropriate specific endpoint.
 * 
 * This endpoint maintains backward compatibility while using the new ContentService.
 * Based on the asset data provided, it routes to the appropriate ingestion method:
 * - If source_identifier (URL) is provided: ingest as web content
 * - If text_content is provided: ingest as text
 * - Otherwise: create a basic asset record
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static createAsset(data: AssetsData['CreateAsset']): CancelablePromise<AssetRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Asset
	 * Generic asset creation endpoint that routes to appropriate specific endpoint.
 * 
 * This endpoint maintains backward compatibility while using the new ContentService.
 * Based on the asset data provided, it routes to the appropriate ingestion method:
 * - If source_identifier (URL) is provided: ingest as web content
 * - If text_content is provided: ingest as text
 * - Otherwise: create a basic asset record
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static createAsset1(data: AssetsData['CreateAsset1']): CancelablePromise<AssetRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Assets
	 * Retrieve assets for an infospace.
	 * @returns AssetsOut Successful Response
	 * @throws ApiError
	 */
	public static listAssets(data: AssetsData['ListAssets']): CancelablePromise<AssetsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
parentAssetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, parent_asset_id: parentAssetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Assets
	 * Retrieve assets for an infospace.
	 * @returns AssetsOut Successful Response
	 * @throws ApiError
	 */
	public static listAssets1(data: AssetsData['ListAssets1']): CancelablePromise<AssetsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
parentAssetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, parent_asset_id: parentAssetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Asset
	 * Generic asset creation endpoint that routes to appropriate specific endpoint.
 * 
 * This endpoint maintains backward compatibility while using the new ContentService.
 * Based on the asset data provided, it routes to the appropriate ingestion method:
 * - If source_identifier (URL) is provided: ingest as web content
 * - If text_content is provided: ingest as text
 * - Otherwise: create a basic asset record
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static createAsset2(data: AssetsData['CreateAsset2']): CancelablePromise<AssetRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Asset
	 * Generic asset creation endpoint that routes to appropriate specific endpoint.
 * 
 * This endpoint maintains backward compatibility while using the new ContentService.
 * Based on the asset data provided, it routes to the appropriate ingestion method:
 * - If source_identifier (URL) is provided: ingest as web content
 * - If text_content is provided: ingest as text
 * - Otherwise: create a basic asset record
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static createAsset3(data: AssetsData['CreateAsset3']): CancelablePromise<AssetRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Assets
	 * Retrieve assets for an infospace.
	 * @returns AssetsOut Successful Response
	 * @throws ApiError
	 */
	public static listAssets2(data: AssetsData['ListAssets2']): CancelablePromise<AssetsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
parentAssetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, parent_asset_id: parentAssetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Assets
	 * Retrieve assets for an infospace.
	 * @returns AssetsOut Successful Response
	 * @throws ApiError
	 */
	public static listAssets3(data: AssetsData['ListAssets3']): CancelablePromise<AssetsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
parentAssetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, parent_asset_id: parentAssetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Upload File
	 * Upload a file and create an asset.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static uploadFile(data: AssetsData['UploadFile']): CancelablePromise<AssetRead> {
		const {
infospaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/upload',
			path: {
				infospace_id: infospaceId
			},
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Upload File
	 * Upload a file and create an asset.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static uploadFile1(data: AssetsData['UploadFile1']): CancelablePromise<AssetRead> {
		const {
infospaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/upload',
			path: {
				infospace_id: infospaceId
			},
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Ingest Url
	 * Ingest content from a URL.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static ingestUrl(data: AssetsData['IngestUrl']): CancelablePromise<AssetRead> {
		const {
infospaceId,
url,
title,
scrapeImmediately = true,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/ingest-url',
			path: {
				infospace_id: infospaceId
			},
			query: {
				url, title, scrape_immediately: scrapeImmediately
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Ingest Url
	 * Ingest content from a URL.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static ingestUrl1(data: AssetsData['IngestUrl1']): CancelablePromise<AssetRead> {
		const {
infospaceId,
url,
title,
scrapeImmediately = true,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/ingest-url',
			path: {
				infospace_id: infospaceId
			},
			query: {
				url, title, scrape_immediately: scrapeImmediately
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Ingest Text
	 * Ingest direct text content.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static ingestText(data: AssetsData['IngestText']): CancelablePromise<AssetRead> {
		const {
infospaceId,
textContent,
title,
eventTimestamp,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/ingest-text',
			path: {
				infospace_id: infospaceId
			},
			query: {
				text_content: textContent, title, event_timestamp: eventTimestamp
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Ingest Text
	 * Ingest direct text content.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static ingestText1(data: AssetsData['IngestText1']): CancelablePromise<AssetRead> {
		const {
infospaceId,
textContent,
title,
eventTimestamp,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/ingest-text',
			path: {
				infospace_id: infospaceId
			},
			query: {
				text_content: textContent, title, event_timestamp: eventTimestamp
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Bulk Ingest Urls
	 * Ingest multiple URLs as separate assets.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static bulkIngestUrls(data: AssetsData['BulkIngestUrls']): CancelablePromise<Array<AssetRead>> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/bulk-ingest-urls',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Bulk Ingest Urls
	 * Ingest multiple URLs as separate assets.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static bulkIngestUrls1(data: AssetsData['BulkIngestUrls1']): CancelablePromise<Array<AssetRead>> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/bulk-ingest-urls',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Reprocess Asset
	 * Reprocess an asset with new options.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static reprocessAsset(data: AssetsData['ReprocessAsset']): CancelablePromise<Message> {
		const {
infospaceId,
assetId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/{asset_id}/reprocess',
			path: {
				infospace_id: infospaceId, asset_id: assetId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Reprocess Asset
	 * Reprocess an asset with new options.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static reprocessAsset1(data: AssetsData['ReprocessAsset1']): CancelablePromise<Message> {
		const {
infospaceId,
assetId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/{asset_id}/reprocess',
			path: {
				infospace_id: infospaceId, asset_id: assetId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Asset
	 * Get a specific asset.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static getAsset(data: AssetsData['GetAsset']): CancelablePromise<AssetRead> {
		const {
infospaceId,
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/{asset_id}',
			path: {
				infospace_id: infospaceId, asset_id: assetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Asset
	 * Get a specific asset.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static getAsset1(data: AssetsData['GetAsset1']): CancelablePromise<AssetRead> {
		const {
infospaceId,
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/{asset_id}',
			path: {
				infospace_id: infospaceId, asset_id: assetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Asset
	 * Update an asset.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static updateAsset(data: AssetsData['UpdateAsset']): CancelablePromise<AssetRead> {
		const {
infospaceId,
assetId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/{asset_id}',
			path: {
				infospace_id: infospaceId, asset_id: assetId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Asset
	 * Update an asset.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static updateAsset1(data: AssetsData['UpdateAsset1']): CancelablePromise<AssetRead> {
		const {
infospaceId,
assetId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/{asset_id}',
			path: {
				infospace_id: infospaceId, asset_id: assetId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Asset
	 * Delete an asset and its children.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static deleteAsset(data: AssetsData['DeleteAsset']): CancelablePromise<Message> {
		const {
infospaceId,
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/{asset_id}',
			path: {
				infospace_id: infospaceId, asset_id: assetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Asset
	 * Delete an asset and its children.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static deleteAsset1(data: AssetsData['DeleteAsset1']): CancelablePromise<Message> {
		const {
infospaceId,
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/{asset_id}',
			path: {
				infospace_id: infospaceId, asset_id: assetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Asset Children
	 * Get child assets of a specific asset.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static getAssetChildren(data: AssetsData['GetAssetChildren']): CancelablePromise<Array<AssetRead>> {
		const {
infospaceId,
assetId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/{asset_id}/children',
			path: {
				infospace_id: infospaceId, asset_id: assetId
			},
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Asset Children
	 * Get child assets of a specific asset.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static getAssetChildren1(data: AssetsData['GetAssetChildren1']): CancelablePromise<Array<AssetRead>> {
		const {
infospaceId,
assetId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/{asset_id}/children',
			path: {
				infospace_id: infospaceId, asset_id: assetId
			},
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Supported Content Types
	 * Get list of supported content types.
	 * @returns string Successful Response
	 * @throws ApiError
	 */
	public static getSupportedContentTypes(): CancelablePromise<Record<string, Array<string>>> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/supported-types',
		});
	}

	/**
	 * Get Supported Content Types
	 * Get list of supported content types.
	 * @returns string Successful Response
	 * @throws ApiError
	 */
	public static getSupportedContentTypes1(): CancelablePromise<Record<string, Array<string>>> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/supported-types',
		});
	}

	/**
	 * Create Assets Background Bulk
	 * Upload multiple files as individual assets using background processing.
 * Returns task IDs for progress tracking.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static createAssetsBackgroundBulk(data: AssetsData['CreateAssetsBackgroundBulk']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/bulk-upload-background',
			path: {
				infospace_id: infospaceId
			},
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Assets Background Bulk
	 * Upload multiple files as individual assets using background processing.
 * Returns task IDs for progress tracking.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static createAssetsBackgroundBulk1(data: AssetsData['CreateAssetsBackgroundBulk1']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/bulk-upload-background',
			path: {
				infospace_id: infospaceId
			},
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Assets Background Urls
	 * Ingest multiple URLs using background processing.
 * Returns task ID for progress tracking.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static createAssetsBackgroundUrls(data: AssetsData['CreateAssetsBackgroundUrls']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/bulk-urls-background',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Assets Background Urls
	 * Ingest multiple URLs using background processing.
 * Returns task ID for progress tracking.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static createAssetsBackgroundUrls1(data: AssetsData['CreateAssetsBackgroundUrls1']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/bulk-urls-background',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Add Files To Bundle Background
	 * Add files to existing bundle using background processing.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static addFilesToBundleBackground(data: AssetsData['AddFilesToBundleBackground']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
bundleId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/bundles/{bundle_id}/add-files-background',
			path: {
				infospace_id: infospaceId, bundle_id: bundleId
			},
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Add Files To Bundle Background
	 * Add files to existing bundle using background processing.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static addFilesToBundleBackground1(data: AssetsData['AddFilesToBundleBackground1']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
bundleId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/bundles/{bundle_id}/add-files-background',
			path: {
				infospace_id: infospaceId, bundle_id: bundleId
			},
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Task Status
	 * Get the status of a background task.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getTaskStatus(data: AssetsData['GetTaskStatus']): CancelablePromise<Record<string, unknown>> {
		const {
taskId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/tasks/{task_id}/status',
			path: {
				task_id: taskId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Task Status
	 * Get the status of a background task.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getTaskStatus1(data: AssetsData['GetTaskStatus1']): CancelablePromise<Record<string, unknown>> {
		const {
taskId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/assets/infospaces/{infospace_id}/assets/tasks/{task_id}/status',
			path: {
				task_id: taskId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class AnnotationJobsService {

	/**
	 * Create Run
	 * Create a new Run.
	 * @returns AnnotationRunRead Successful Response
	 * @throws ApiError
	 */
	public static createRun(data: AnnotationJobsData['CreateRun']): CancelablePromise<AnnotationRunRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs/',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Runs
	 * Retrieve Runs for the infospace.
	 * @returns AnnotationRunsOut Successful Response
	 * @throws ApiError
	 */
	public static listRuns(data: AnnotationJobsData['ListRuns']): CancelablePromise<AnnotationRunsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, include_counts: includeCounts
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Run
	 * Create a new Run.
	 * @returns AnnotationRunRead Successful Response
	 * @throws ApiError
	 */
	public static createRun1(data: AnnotationJobsData['CreateRun1']): CancelablePromise<AnnotationRunRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Runs
	 * Retrieve Runs for the infospace.
	 * @returns AnnotationRunsOut Successful Response
	 * @throws ApiError
	 */
	public static listRuns1(data: AnnotationJobsData['ListRuns1']): CancelablePromise<AnnotationRunsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, include_counts: includeCounts
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Run
	 * Retrieve a specific Run by its ID.
	 * @returns AnnotationRunRead Successful Response
	 * @throws ApiError
	 */
	public static getRun(data: AnnotationJobsData['GetRun']): CancelablePromise<AnnotationRunRead> {
		const {
infospaceId,
runId,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}',
			path: {
				infospace_id: infospaceId, run_id: runId
			},
			query: {
				include_counts: includeCounts
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Run
	 * Update a Run.
	 * @returns AnnotationRunRead Successful Response
	 * @throws ApiError
	 */
	public static updateRun(data: AnnotationJobsData['UpdateRun']): CancelablePromise<AnnotationRunRead> {
		const {
infospaceId,
runId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}',
			path: {
				infospace_id: infospaceId, run_id: runId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Run
	 * Delete a Run.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteRun(data: AnnotationJobsData['DeleteRun']): CancelablePromise<void> {
		const {
infospaceId,
runId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}',
			path: {
				infospace_id: infospaceId, run_id: runId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Retry Failed Annotations
	 * Retry failed annotations in a run.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static retryFailedAnnotations(data: AnnotationJobsData['RetryFailedAnnotations']): CancelablePromise<Message> {
		const {
infospaceId,
runId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}/retry_failures',
			path: {
				infospace_id: infospaceId, run_id: runId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Package From Run Endpoint
	 * Create a package from a run.
	 * @returns PackageRead Successful Response
	 * @throws ApiError
	 */
	public static createPackageFromRunEndpoint(data: AnnotationJobsData['CreatePackageFromRunEndpoint']): CancelablePromise<PackageRead> {
		const {
infospaceId,
runId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}/create_package',
			path: {
				infospace_id: infospaceId, run_id: runId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class RunsService {

	/**
	 * Create Run
	 * Create a new Run.
	 * @returns AnnotationRunRead Successful Response
	 * @throws ApiError
	 */
	public static createRun(data: RunsData['CreateRun']): CancelablePromise<AnnotationRunRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs/',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Runs
	 * Retrieve Runs for the infospace.
	 * @returns AnnotationRunsOut Successful Response
	 * @throws ApiError
	 */
	public static listRuns(data: RunsData['ListRuns']): CancelablePromise<AnnotationRunsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, include_counts: includeCounts
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Run
	 * Create a new Run.
	 * @returns AnnotationRunRead Successful Response
	 * @throws ApiError
	 */
	public static createRun1(data: RunsData['CreateRun1']): CancelablePromise<AnnotationRunRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Runs
	 * Retrieve Runs for the infospace.
	 * @returns AnnotationRunsOut Successful Response
	 * @throws ApiError
	 */
	public static listRuns1(data: RunsData['ListRuns1']): CancelablePromise<AnnotationRunsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, include_counts: includeCounts
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Run
	 * Retrieve a specific Run by its ID.
	 * @returns AnnotationRunRead Successful Response
	 * @throws ApiError
	 */
	public static getRun(data: RunsData['GetRun']): CancelablePromise<AnnotationRunRead> {
		const {
infospaceId,
runId,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}',
			path: {
				infospace_id: infospaceId, run_id: runId
			},
			query: {
				include_counts: includeCounts
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Run
	 * Update a Run.
	 * @returns AnnotationRunRead Successful Response
	 * @throws ApiError
	 */
	public static updateRun(data: RunsData['UpdateRun']): CancelablePromise<AnnotationRunRead> {
		const {
infospaceId,
runId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}',
			path: {
				infospace_id: infospaceId, run_id: runId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Run
	 * Delete a Run.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteRun(data: RunsData['DeleteRun']): CancelablePromise<void> {
		const {
infospaceId,
runId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}',
			path: {
				infospace_id: infospaceId, run_id: runId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Retry Failed Annotations
	 * Retry failed annotations in a run.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static retryFailedAnnotations(data: RunsData['RetryFailedAnnotations']): CancelablePromise<Message> {
		const {
infospaceId,
runId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}/retry_failures',
			path: {
				infospace_id: infospaceId, run_id: runId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Package From Run Endpoint
	 * Create a package from a run.
	 * @returns PackageRead Successful Response
	 * @throws ApiError
	 */
	public static createPackageFromRunEndpoint(data: RunsData['CreatePackageFromRunEndpoint']): CancelablePromise<PackageRead> {
		const {
infospaceId,
runId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}/create_package',
			path: {
				infospace_id: infospaceId, run_id: runId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class AnnotationSchemesService {

	/**
	 * Create Annotation Schema
	 * Create a new Annotation Schema.
	 * @returns AnnotationSchemaRead Successful Response
	 * @throws ApiError
	 */
	public static createAnnotationSchema(data: AnnotationSchemesData['CreateAnnotationSchema']): CancelablePromise<AnnotationSchemaRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotation_schemes/infospaces/{infospace_id}/annotation_schemas/',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Annotation Schemas
	 * Retrieve Annotation Schemas for the infospace.
	 * @returns AnnotationSchemasOut Successful Response
	 * @throws ApiError
	 */
	public static listAnnotationSchemas(data: AnnotationSchemesData['ListAnnotationSchemas']): CancelablePromise<AnnotationSchemasOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotation_schemes/infospaces/{infospace_id}/annotation_schemas/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, include_counts: includeCounts
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Annotation Schema
	 * Create a new Annotation Schema.
	 * @returns AnnotationSchemaRead Successful Response
	 * @throws ApiError
	 */
	public static createAnnotationSchema1(data: AnnotationSchemesData['CreateAnnotationSchema1']): CancelablePromise<AnnotationSchemaRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotation_schemes/infospaces/{infospace_id}/annotation_schemas',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Annotation Schemas
	 * Retrieve Annotation Schemas for the infospace.
	 * @returns AnnotationSchemasOut Successful Response
	 * @throws ApiError
	 */
	public static listAnnotationSchemas1(data: AnnotationSchemesData['ListAnnotationSchemas1']): CancelablePromise<AnnotationSchemasOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotation_schemes/infospaces/{infospace_id}/annotation_schemas',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, include_counts: includeCounts
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Annotation Schema
	 * Retrieve a specific Annotation Schema by its ID.
	 * @returns AnnotationSchemaRead Successful Response
	 * @throws ApiError
	 */
	public static getAnnotationSchema(data: AnnotationSchemesData['GetAnnotationSchema']): CancelablePromise<AnnotationSchemaRead> {
		const {
infospaceId,
schemaId,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotation_schemes/infospaces/{infospace_id}/annotation_schemas/{schema_id}',
			path: {
				infospace_id: infospaceId, schema_id: schemaId
			},
			query: {
				include_counts: includeCounts
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Annotation Schema
	 * Update an Annotation Schema.
	 * @returns AnnotationSchemaRead Successful Response
	 * @throws ApiError
	 */
	public static updateAnnotationSchema(data: AnnotationSchemesData['UpdateAnnotationSchema']): CancelablePromise<AnnotationSchemaRead> {
		const {
infospaceId,
schemaId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/annotation_schemes/infospaces/{infospace_id}/annotation_schemas/{schema_id}',
			path: {
				infospace_id: infospaceId, schema_id: schemaId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Annotation Schema
	 * Delete an annotation schema.
 * 
 * Args:
 * current_user: The current user
 * infospace_id: ID of the infospace
 * schema_id: ID of the schema to delete
 * session: Database session
 * 
 * Raises:
 * HTTPException: If schema not found or user lacks access
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteAnnotationSchema(data: AnnotationSchemesData['DeleteAnnotationSchema']): CancelablePromise<void> {
		const {
infospaceId,
schemaId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/annotation_schemes/infospaces/{infospace_id}/annotation_schemas/{schema_id}',
			path: {
				infospace_id: infospaceId, schema_id: schemaId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class AnnotationSchemasService {

	/**
	 * Create Annotation Schema
	 * Create a new Annotation Schema.
	 * @returns AnnotationSchemaRead Successful Response
	 * @throws ApiError
	 */
	public static createAnnotationSchema(data: AnnotationSchemasData['CreateAnnotationSchema']): CancelablePromise<AnnotationSchemaRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotation_schemes/infospaces/{infospace_id}/annotation_schemas/',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Annotation Schemas
	 * Retrieve Annotation Schemas for the infospace.
	 * @returns AnnotationSchemasOut Successful Response
	 * @throws ApiError
	 */
	public static listAnnotationSchemas(data: AnnotationSchemasData['ListAnnotationSchemas']): CancelablePromise<AnnotationSchemasOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotation_schemes/infospaces/{infospace_id}/annotation_schemas/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, include_counts: includeCounts
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Annotation Schema
	 * Create a new Annotation Schema.
	 * @returns AnnotationSchemaRead Successful Response
	 * @throws ApiError
	 */
	public static createAnnotationSchema1(data: AnnotationSchemasData['CreateAnnotationSchema1']): CancelablePromise<AnnotationSchemaRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotation_schemes/infospaces/{infospace_id}/annotation_schemas',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Annotation Schemas
	 * Retrieve Annotation Schemas for the infospace.
	 * @returns AnnotationSchemasOut Successful Response
	 * @throws ApiError
	 */
	public static listAnnotationSchemas1(data: AnnotationSchemasData['ListAnnotationSchemas1']): CancelablePromise<AnnotationSchemasOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotation_schemes/infospaces/{infospace_id}/annotation_schemas',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, include_counts: includeCounts
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Annotation Schema
	 * Retrieve a specific Annotation Schema by its ID.
	 * @returns AnnotationSchemaRead Successful Response
	 * @throws ApiError
	 */
	public static getAnnotationSchema(data: AnnotationSchemasData['GetAnnotationSchema']): CancelablePromise<AnnotationSchemaRead> {
		const {
infospaceId,
schemaId,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotation_schemes/infospaces/{infospace_id}/annotation_schemas/{schema_id}',
			path: {
				infospace_id: infospaceId, schema_id: schemaId
			},
			query: {
				include_counts: includeCounts
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Annotation Schema
	 * Update an Annotation Schema.
	 * @returns AnnotationSchemaRead Successful Response
	 * @throws ApiError
	 */
	public static updateAnnotationSchema(data: AnnotationSchemasData['UpdateAnnotationSchema']): CancelablePromise<AnnotationSchemaRead> {
		const {
infospaceId,
schemaId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/annotation_schemes/infospaces/{infospace_id}/annotation_schemas/{schema_id}',
			path: {
				infospace_id: infospaceId, schema_id: schemaId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Annotation Schema
	 * Delete an annotation schema.
 * 
 * Args:
 * current_user: The current user
 * infospace_id: ID of the infospace
 * schema_id: ID of the schema to delete
 * session: Database session
 * 
 * Raises:
 * HTTPException: If schema not found or user lacks access
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteAnnotationSchema(data: AnnotationSchemasData['DeleteAnnotationSchema']): CancelablePromise<void> {
		const {
infospaceId,
schemaId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/annotation_schemes/infospaces/{infospace_id}/annotation_schemas/{schema_id}',
			path: {
				infospace_id: infospaceId, schema_id: schemaId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class AnnotationsService {

	/**
	 * Create Annotation
	 * Create a new annotation.
	 * @returns AnnotationRead Successful Response
	 * @throws ApiError
	 */
	public static createAnnotation(data: AnnotationsData['CreateAnnotation']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Annotation
	 * Create a new annotation.
	 * @returns AnnotationRead Successful Response
	 * @throws ApiError
	 */
	public static createAnnotation1(data: AnnotationsData['CreateAnnotation1']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Annotations
	 * Retrieve Annotations for the infospace.
	 * @returns AnnotationsOut Successful Response
	 * @throws ApiError
	 */
	public static listAnnotations(data: AnnotationsData['ListAnnotations']): CancelablePromise<AnnotationsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
sourceId,
schemaId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, source_id: sourceId, schema_id: schemaId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Annotations
	 * Retrieve Annotations for the infospace.
	 * @returns AnnotationsOut Successful Response
	 * @throws ApiError
	 */
	public static listAnnotations1(data: AnnotationsData['ListAnnotations1']): CancelablePromise<AnnotationsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
sourceId,
schemaId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, source_id: sourceId, schema_id: schemaId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Annotation
	 * Create a new annotation.
	 * @returns AnnotationRead Successful Response
	 * @throws ApiError
	 */
	public static createAnnotation2(data: AnnotationsData['CreateAnnotation2']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Annotation
	 * Create a new annotation.
	 * @returns AnnotationRead Successful Response
	 * @throws ApiError
	 */
	public static createAnnotation3(data: AnnotationsData['CreateAnnotation3']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Annotations
	 * Retrieve Annotations for the infospace.
	 * @returns AnnotationsOut Successful Response
	 * @throws ApiError
	 */
	public static listAnnotations2(data: AnnotationsData['ListAnnotations2']): CancelablePromise<AnnotationsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
sourceId,
schemaId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, source_id: sourceId, schema_id: schemaId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Annotations
	 * Retrieve Annotations for the infospace.
	 * @returns AnnotationsOut Successful Response
	 * @throws ApiError
	 */
	public static listAnnotations3(data: AnnotationsData['ListAnnotations3']): CancelablePromise<AnnotationsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
sourceId,
schemaId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, source_id: sourceId, schema_id: schemaId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Annotation
	 * Retrieve a specific Annotation by its ID.
	 * @returns AnnotationRead Successful Response
	 * @throws ApiError
	 */
	public static getAnnotation(data: AnnotationsData['GetAnnotation']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
annotationId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/{annotation_id}',
			path: {
				infospace_id: infospaceId, annotation_id: annotationId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Annotation
	 * Retrieve a specific Annotation by its ID.
	 * @returns AnnotationRead Successful Response
	 * @throws ApiError
	 */
	public static getAnnotation1(data: AnnotationsData['GetAnnotation1']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
annotationId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/{annotation_id}',
			path: {
				infospace_id: infospaceId, annotation_id: annotationId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Annotation
	 * Update an Annotation.
	 * @returns AnnotationRead Successful Response
	 * @throws ApiError
	 */
	public static updateAnnotation(data: AnnotationsData['UpdateAnnotation']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
annotationId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/{annotation_id}',
			path: {
				infospace_id: infospaceId, annotation_id: annotationId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Annotation
	 * Update an Annotation.
	 * @returns AnnotationRead Successful Response
	 * @throws ApiError
	 */
	public static updateAnnotation1(data: AnnotationsData['UpdateAnnotation1']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
annotationId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/{annotation_id}',
			path: {
				infospace_id: infospaceId, annotation_id: annotationId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Annotation
	 * Delete an Annotation.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteAnnotation(data: AnnotationsData['DeleteAnnotation']): CancelablePromise<void> {
		const {
infospaceId,
annotationId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/{annotation_id}',
			path: {
				infospace_id: infospaceId, annotation_id: annotationId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Annotation
	 * Delete an Annotation.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteAnnotation1(data: AnnotationsData['DeleteAnnotation1']): CancelablePromise<void> {
		const {
infospaceId,
annotationId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/{annotation_id}',
			path: {
				infospace_id: infospaceId, annotation_id: annotationId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Batch Annotations
	 * Create multiple annotations in a batch.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static createBatchAnnotations(data: AnnotationsData['CreateBatchAnnotations']): CancelablePromise<Message> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/batch',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Batch Annotations
	 * Create multiple annotations in a batch.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static createBatchAnnotations1(data: AnnotationsData['CreateBatchAnnotations1']): CancelablePromise<Message> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/batch',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Run Results
	 * Retrieve all annotations for a specific AnnotationRun.
 * The service handles run ownership and infospace context verification.
	 * @returns AnnotationRead Successful Response
	 * @throws ApiError
	 */
	public static getRunResults(data: AnnotationsData['GetRunResults']): CancelablePromise<Array<AnnotationRead>> {
		const {
infospaceId,
runId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/run/{run_id}/results',
			path: {
				infospace_id: infospaceId, run_id: runId
			},
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Run Results
	 * Retrieve all annotations for a specific AnnotationRun.
 * The service handles run ownership and infospace context verification.
	 * @returns AnnotationRead Successful Response
	 * @throws ApiError
	 */
	public static getRunResults1(data: AnnotationsData['GetRunResults1']): CancelablePromise<Array<AnnotationRead>> {
		const {
infospaceId,
runId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/run/{run_id}/results',
			path: {
				infospace_id: infospaceId, run_id: runId
			},
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Retry Single Annotation
	 * Retries a single failed annotation synchronously.
	 * @returns AnnotationRead Successful Response
	 * @throws ApiError
	 */
	public static retrySingleAnnotation(data: AnnotationsData['RetrySingleAnnotation']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
annotationId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/{annotation_id}/retry',
			path: {
				infospace_id: infospaceId, annotation_id: annotationId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Retry Single Annotation
	 * Retries a single failed annotation synchronously.
	 * @returns AnnotationRead Successful Response
	 * @throws ApiError
	 */
	public static retrySingleAnnotation1(data: AnnotationsData['RetrySingleAnnotation1']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
annotationId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/{annotation_id}/retry',
			path: {
				infospace_id: infospaceId, annotation_id: annotationId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Retry Failed Annotations
	 * Triggers a retry of all failed annotations in a run.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static retryFailedAnnotations(data: AnnotationsData['RetryFailedAnnotations']): CancelablePromise<Message> {
		const {
infospaceId,
runId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/run/{run_id}/retry_failed',
			path: {
				infospace_id: infospaceId, run_id: runId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Retry Failed Annotations
	 * Triggers a retry of all failed annotations in a run.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static retryFailedAnnotations1(data: AnnotationsData['RetryFailedAnnotations1']): CancelablePromise<Message> {
		const {
infospaceId,
runId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/run/{run_id}/retry_failed',
			path: {
				infospace_id: infospaceId, run_id: runId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class BundlesService {

	/**
	 * Create Bundle
	 * Create a new bundle in an infospace.
	 * @returns BundleRead Successful Response
	 * @throws ApiError
	 */
	public static createBundle(data: BundlesData['CreateBundle']): CancelablePromise<BundleRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/bundles/infospaces/{infospace_id}/bundles',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Bundles
	 * Get bundles for an infospace.
	 * @returns BundleRead Successful Response
	 * @throws ApiError
	 */
	public static getBundles(data: BundlesData['GetBundles']): CancelablePromise<Array<BundleRead>> {
		const {
infospaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/bundles/infospaces/{infospace_id}/bundles',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Bundle
	 * Get a bundle by ID.
	 * @returns BundleRead Successful Response
	 * @throws ApiError
	 */
	public static getBundle(data: BundlesData['GetBundle']): CancelablePromise<BundleRead> {
		const {
bundleId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/bundles/bundles/{bundle_id}',
			path: {
				bundle_id: bundleId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Bundle
	 * Update a bundle.
	 * @returns BundleRead Successful Response
	 * @throws ApiError
	 */
	public static updateBundle(data: BundlesData['UpdateBundle']): CancelablePromise<BundleRead> {
		const {
bundleId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v1/bundles/bundles/{bundle_id}',
			path: {
				bundle_id: bundleId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Bundle
	 * Delete a bundle.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteBundle(data: BundlesData['DeleteBundle']): CancelablePromise<void> {
		const {
bundleId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/bundles/bundles/{bundle_id}',
			path: {
				bundle_id: bundleId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Add Asset To Bundle
	 * Add an existing asset to a bundle by ID.
	 * @returns BundleRead Successful Response
	 * @throws ApiError
	 */
	public static addAssetToBundle(data: BundlesData['AddAssetToBundle']): CancelablePromise<BundleRead> {
		const {
bundleId,
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/bundles/bundles/{bundle_id}/assets/{asset_id}',
			path: {
				bundle_id: bundleId, asset_id: assetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Remove Asset From Bundle
	 * Remove an asset from a bundle by ID.
	 * @returns BundleRead Successful Response
	 * @throws ApiError
	 */
	public static removeAssetFromBundle(data: BundlesData['RemoveAssetFromBundle']): CancelablePromise<BundleRead> {
		const {
bundleId,
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/bundles/bundles/{bundle_id}/assets/{asset_id}',
			path: {
				bundle_id: bundleId, asset_id: assetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Assets In Bundle
	 * Get assets for a bundle.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static getAssetsInBundle(data: BundlesData['GetAssetsInBundle']): CancelablePromise<Array<AssetRead>> {
		const {
bundleId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/bundles/bundles/{bundle_id}/assets',
			path: {
				bundle_id: bundleId
			},
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Asset
	 * Get an asset by ID.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static getAsset(data: BundlesData['GetAsset']): CancelablePromise<AssetRead> {
		const {
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/bundles/assets/{asset_id}',
			path: {
				asset_id: assetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Transfer Bundle
	 * Transfer a bundle to another infospace.
	 * @returns BundleRead Successful Response
	 * @throws ApiError
	 */
	public static transferBundle(data: BundlesData['TransferBundle']): CancelablePromise<BundleRead> {
		const {
bundleId,
targetInfospaceId,
copy = true,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/bundles/bundles/{bundle_id}/transfer',
			path: {
				bundle_id: bundleId
			},
			query: {
				target_infospace_id: targetInfospaceId, copy
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class DatasetsService {

	/**
	 * Create Dataset
	 * Create a new dataset within a specific infospace.
	 * @returns DatasetRead Successful Response
	 * @throws ApiError
	 */
	public static createDataset(data: DatasetsData['CreateDataset']): CancelablePromise<DatasetRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/infospaces/{infospace_id}/datasets/',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Datasets
	 * Retrieve datasets within a specific infospace.
	 * @returns DatasetsOut Successful Response
	 * @throws ApiError
	 */
	public static listDatasets(data: DatasetsData['ListDatasets']): CancelablePromise<DatasetsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/infospaces/{infospace_id}/datasets/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Dataset
	 * Create a new dataset within a specific infospace.
	 * @returns DatasetRead Successful Response
	 * @throws ApiError
	 */
	public static createDataset1(data: DatasetsData['CreateDataset1']): CancelablePromise<DatasetRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/infospaces/{infospace_id}/datasets',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Datasets
	 * Retrieve datasets within a specific infospace.
	 * @returns DatasetsOut Successful Response
	 * @throws ApiError
	 */
	public static listDatasets1(data: DatasetsData['ListDatasets1']): CancelablePromise<DatasetsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/infospaces/{infospace_id}/datasets',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Dataset
	 * Get a specific dataset by ID.
	 * @returns DatasetRead Successful Response
	 * @throws ApiError
	 */
	public static getDataset(data: DatasetsData['GetDataset']): CancelablePromise<DatasetRead> {
		const {
infospaceId,
datasetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/infospaces/{infospace_id}/datasets/{dataset_id}',
			path: {
				infospace_id: infospaceId, dataset_id: datasetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Dataset
	 * Update a dataset.
	 * @returns DatasetRead Successful Response
	 * @throws ApiError
	 */
	public static updateDataset(data: DatasetsData['UpdateDataset']): CancelablePromise<DatasetRead> {
		const {
infospaceId,
datasetId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/infospaces/{infospace_id}/datasets/{dataset_id}',
			path: {
				infospace_id: infospaceId, dataset_id: datasetId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Dataset
	 * Delete a dataset.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static deleteDataset(data: DatasetsData['DeleteDataset']): CancelablePromise<Message> {
		const {
infospaceId,
datasetId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/infospaces/{infospace_id}/datasets/{dataset_id}',
			path: {
				infospace_id: infospaceId, dataset_id: datasetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Export Dataset
	 * Export a specific dataset as a self-contained package (ZIP).
	 * @returns any Successful Response
	 * @throws ApiError
	 */
	public static exportDataset(data: DatasetsData['ExportDataset']): CancelablePromise<any> {
		const {
infospaceId,
datasetId,
includeContent = false,
includeResults = false,
includeSourceFiles = true,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/infospaces/{infospace_id}/datasets/{dataset_id}/export',
			path: {
				infospace_id: infospaceId, dataset_id: datasetId
			},
			query: {
				include_content: includeContent, include_results: includeResults, include_source_files: includeSourceFiles
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Import Dataset
	 * Import a dataset from an exported Dataset Package file.
	 * @returns DatasetRead Successful Response
	 * @throws ApiError
	 */
	public static importDataset(data: DatasetsData['ImportDataset']): CancelablePromise<DatasetRead> {
		const {
infospaceId,
formData,
conflictStrategy = 'skip',
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/infospaces/{infospace_id}/datasets/import',
			path: {
				infospace_id: infospaceId
			},
			query: {
				conflict_strategy: conflictStrategy
			},
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Import Dataset From Token
	 * Import a dataset into the target infospace using a share token.
 * This internally performs an export from the source and then an import.
	 * @returns DatasetRead Successful Response
	 * @throws ApiError
	 */
	public static importDatasetFromToken(data: DatasetsData['ImportDatasetFromToken']): CancelablePromise<DatasetRead> {
		const {
infospaceId,
shareToken,
includeContent = false,
includeResults = false,
conflictStrategy = 'skip',
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/infospaces/{infospace_id}/datasets/import_from_token',
			path: {
				infospace_id: infospaceId
			},
			query: {
				share_token: shareToken, include_content: includeContent, include_results: includeResults, conflict_strategy: conflictStrategy
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class FilestorageService {

	/**
	 * File Upload
	 * Upload a file to the configured storage provider.
 * Expects form-data with a file.
 * Generates a unique object name based on user ID and filename.
	 * @returns FileUploadResponse Successful Response
	 * @throws ApiError
	 */
	public static fileUpload(data: FilestorageData['FileUpload']): CancelablePromise<FileUploadResponse> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/files/upload',
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				401: `Unauthorized`,
				422: `Validation Error`,
				500: `Internal Server Error`,
			},
		});
	}

	/**
	 * File Download
	 * Download a file from the storage provider.
 * Expects query parameter 'file_path' (the object name).
 * The file is saved temporarily and a background task deletes the temp file.
	 * @returns any Successful Response
	 * @throws ApiError
	 */
	public static fileDownload(data: FilestorageData['FileDownload']): CancelablePromise<any> {
		const {
filePath,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/files/download',
			query: {
				file_path: filePath
			},
			errors: {
				401: `Unauthorized`,
				404: `Not Found`,
				422: `Validation Error`,
				500: `Internal Server Error`,
			},
		});
	}

	/**
	 * List Files
	 * List files in the storage provider with user authorization.
 * Users can only list files in their own directory.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static listFiles(data: FilestorageData['ListFiles'] = {}): CancelablePromise<unknown> {
		const {
prefix,
maxKeys = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/files/list',
			query: {
				prefix, max_keys: maxKeys
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete File
	 * Delete a file with proper authorization checks.
 * Users can only delete files in their own directory.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deleteFile(data: FilestorageData['DeleteFile']): CancelablePromise<unknown> {
		const {
objectName,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/files/delete',
			query: {
				object_name: objectName
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Stream File
	 * Stream a file directly from storage without creating temporary files.
 * This is more efficient for media files (images, videos, PDFs) that need to be displayed in browsers.
	 * @returns any Successful Response
	 * @throws ApiError
	 */
	public static streamFile(data: FilestorageData['StreamFile']): CancelablePromise<any> {
		const {
filePath,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/files/stream/{file_path}',
			path: {
				file_path: filePath
			},
			errors: {
				401: `Unauthorized`,
				404: `Not Found`,
				422: `Validation Error`,
				500: `Internal Server Error`,
			},
		});
	}

}

export class FilesService {

	/**
	 * File Upload
	 * Upload a file to the configured storage provider.
 * Expects form-data with a file.
 * Generates a unique object name based on user ID and filename.
	 * @returns FileUploadResponse Successful Response
	 * @throws ApiError
	 */
	public static fileUpload(data: FilesData['FileUpload']): CancelablePromise<FileUploadResponse> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/files/upload',
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				401: `Unauthorized`,
				422: `Validation Error`,
				500: `Internal Server Error`,
			},
		});
	}

	/**
	 * File Download
	 * Download a file from the storage provider.
 * Expects query parameter 'file_path' (the object name).
 * The file is saved temporarily and a background task deletes the temp file.
	 * @returns any Successful Response
	 * @throws ApiError
	 */
	public static fileDownload(data: FilesData['FileDownload']): CancelablePromise<any> {
		const {
filePath,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/files/download',
			query: {
				file_path: filePath
			},
			errors: {
				401: `Unauthorized`,
				404: `Not Found`,
				422: `Validation Error`,
				500: `Internal Server Error`,
			},
		});
	}

	/**
	 * List Files
	 * List files in the storage provider with user authorization.
 * Users can only list files in their own directory.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static listFiles(data: FilesData['ListFiles'] = {}): CancelablePromise<unknown> {
		const {
prefix,
maxKeys = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/files/list',
			query: {
				prefix, max_keys: maxKeys
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete File
	 * Delete a file with proper authorization checks.
 * Users can only delete files in their own directory.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deleteFile(data: FilesData['DeleteFile']): CancelablePromise<unknown> {
		const {
objectName,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/files/delete',
			query: {
				object_name: objectName
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Stream File
	 * Stream a file directly from storage without creating temporary files.
 * This is more efficient for media files (images, videos, PDFs) that need to be displayed in browsers.
	 * @returns any Successful Response
	 * @throws ApiError
	 */
	public static streamFile(data: FilesData['StreamFile']): CancelablePromise<any> {
		const {
filePath,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/files/stream/{file_path}',
			path: {
				file_path: filePath
			},
			errors: {
				401: `Unauthorized`,
				404: `Not Found`,
				422: `Validation Error`,
				500: `Internal Server Error`,
			},
		});
	}

}

export class AppService {

	/**
	 * Readyz
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static readyz(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/healthz/readiness',
		});
	}

	/**
	 * Liveness
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static liveness(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/healthz/liveness',
		});
	}

	/**
	 * Healthz
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static healthz(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/healthz/healthz',
		});
	}

}

export class InfospacesService {

	/**
	 * Create Infospace
	 * Create a new Infospace.
	 * @returns InfospaceRead Successful Response
	 * @throws ApiError
	 */
	public static createInfospace(data: InfospacesData['CreateInfospace']): CancelablePromise<InfospaceRead> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/infospaces/infospaces/',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Infospaces
	 * Retrieve Infospaces for the current user.
	 * @returns InfospacesOut Successful Response
	 * @throws ApiError
	 */
	public static listInfospaces(data: InfospacesData['ListInfospaces'] = {}): CancelablePromise<InfospacesOut> {
		const {
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/infospaces/infospaces/',
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Infospace
	 * Create a new Infospace.
	 * @returns InfospaceRead Successful Response
	 * @throws ApiError
	 */
	public static createInfospace1(data: InfospacesData['CreateInfospace1']): CancelablePromise<InfospaceRead> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/infospaces/infospaces',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Infospaces
	 * Retrieve Infospaces for the current user.
	 * @returns InfospacesOut Successful Response
	 * @throws ApiError
	 */
	public static listInfospaces1(data: InfospacesData['ListInfospaces1'] = {}): CancelablePromise<InfospacesOut> {
		const {
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/infospaces/infospaces',
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Infospace
	 * Retrieve a specific Infospace by its ID.
	 * @returns InfospaceRead Successful Response
	 * @throws ApiError
	 */
	public static getInfospace(data: InfospacesData['GetInfospace']): CancelablePromise<InfospaceRead> {
		const {
infospaceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/infospaces/infospaces/{infospace_id}',
			path: {
				infospace_id: infospaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Infospace
	 * Update an Infospace.
	 * @returns InfospaceRead Successful Response
	 * @throws ApiError
	 */
	public static updateInfospace(data: InfospacesData['UpdateInfospace']): CancelablePromise<InfospaceRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/infospaces/infospaces/{infospace_id}',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Infospace
	 * Delete an Infospace.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteInfospace(data: InfospacesData['DeleteInfospace']): CancelablePromise<void> {
		const {
infospaceId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/infospaces/infospaces/{infospace_id}',
			path: {
				infospace_id: infospaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Infospace Stats
	 * Get statistics about an Infospace.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getInfospaceStats(data: InfospacesData['GetInfospaceStats']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/infospaces/infospaces/{infospace_id}/stats',
			path: {
				infospace_id: infospaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Import Infospace
	 * Import an Infospace.
	 * @returns InfospaceRead Successful Response
	 * @throws ApiError
	 */
	public static importInfospace(data: InfospacesData['ImportInfospace']): CancelablePromise<InfospaceRead> {
		const {
infospaceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/infospaces/infospaces/import',
			query: {
				infospace_id: infospaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class LoginService {

	/**
	 * Login Access Token
	 * OAuth2 compatible token login, get an access token for future requests
	 * @returns Token Successful Response
	 * @throws ApiError
	 */
	public static loginAccessToken(data: LoginData['LoginAccessToken']): CancelablePromise<Token> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/login/access-token',
			formData: formData,
			mediaType: 'application/x-www-form-urlencoded',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Test Token
	 * Test access token
	 * @returns UserOut Successful Response
	 * @throws ApiError
	 */
	public static testToken(): CancelablePromise<UserOut> {
				return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/login/test-token',
		});
	}

	/**
	 * Recover Password
	 * Password Recovery
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static recoverPassword(data: LoginData['RecoverPassword']): CancelablePromise<Message> {
		const {
email,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/password-recovery/{email}',
			path: {
				email
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Reset Password
	 * Reset password
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static resetPassword(data: LoginData['ResetPassword']): CancelablePromise<Message> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/reset-password/',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Recover Password Html Content
	 * HTML Content for Password Recovery
	 * @returns string Successful Response
	 * @throws ApiError
	 */
	public static recoverPasswordHtmlContent(data: LoginData['RecoverPasswordHtmlContent']): CancelablePromise<string> {
		const {
email,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/password-recovery-html-content/{email}',
			path: {
				email
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class SearchHistoryService {

	/**
	 * Create Search History
	 * Create a new search history entry.
	 * @returns SearchHistoryRead Successful Response
	 * @throws ApiError
	 */
	public static createSearchHistory(data: SearchHistoryData['CreateSearchHistory']): CancelablePromise<SearchHistoryRead> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/search_histories/create',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Search Histories
	 * Retrieve search histories for the current user.
	 * @returns SearchHistoriesOut Successful Response
	 * @throws ApiError
	 */
	public static readSearchHistories(data: SearchHistoryData['ReadSearchHistories'] = {}): CancelablePromise<SearchHistoriesOut> {
		const {
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/search_histories/read',
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class ShareablesService {

	/**
	 * Create Shareable Link
	 * Create a new shareable link for a resource within an infospace.
	 * @returns ShareableLinkRead Successful Response
	 * @throws ApiError
	 */
	public static createShareableLink(data: ShareablesData['CreateShareableLink']): CancelablePromise<ShareableLinkRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/shareables/shareables/{infospace_id}/links',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Shareable Links
	 * Get shareable links for the current user, optionally filtered by resource and infospace.
	 * @returns Paginated Successful Response
	 * @throws ApiError
	 */
	public static getShareableLinks(data: ShareablesData['GetShareableLinks']): CancelablePromise<Paginated> {
		const {
infospaceId,
resourceType,
resourceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/shareables/shareables/{infospace_id}/links',
			path: {
				infospace_id: infospaceId
			},
			query: {
				resource_type: resourceType, resource_id: resourceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Shareable Link By Token
	 * Get a shareable link by token.
	 * @returns ShareableLinkRead Successful Response
	 * @throws ApiError
	 */
	public static getShareableLinkByToken(data: ShareablesData['GetShareableLinkByToken']): CancelablePromise<ShareableLinkRead> {
		const {
token,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/shareables/shareables/links/{token}',
			path: {
				token
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Shareable Link
	 * Update a shareable link by its ID (owner only).
	 * @returns ShareableLinkRead Successful Response
	 * @throws ApiError
	 */
	public static updateShareableLink(data: ShareablesData['UpdateShareableLink']): CancelablePromise<ShareableLinkRead> {
		const {
linkId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v1/shareables/shareables/links/{link_id}',
			path: {
				link_id: linkId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Shareable Link
	 * Delete a shareable link by its ID (owner only).
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteShareableLink(data: ShareablesData['DeleteShareableLink']): CancelablePromise<void> {
		const {
linkId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/shareables/shareables/links/{link_id}',
			path: {
				link_id: linkId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Access Shared Resource
	 * Access the resource associated with a shareable link token.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static accessSharedResource(data: ShareablesData['AccessSharedResource']): CancelablePromise<Record<string, unknown>> {
		const {
token,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/shareables/shareables/access/{token}',
			path: {
				token
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Sharing Stats
	 * Get sharing statistics for the current user within a specific infospace.
	 * @returns ShareableLinkStats Successful Response
	 * @throws ApiError
	 */
	public static getSharingStats(data: ShareablesData['GetSharingStats']): CancelablePromise<ShareableLinkStats> {
		const {
infospaceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/shareables/shareables/{infospace_id}/stats',
			path: {
				infospace_id: infospaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Export Resource
	 * Export a resource from a specific infospace to a file.
 * Returns a file download.
	 * @returns any Successful Response
	 * @throws ApiError
	 */
	public static exportResource(data: ShareablesData['ExportResource']): CancelablePromise<any> {
		const {
infospaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/shareables/shareables/{infospace_id}/export',
			path: {
				infospace_id: infospaceId
			},
			formData: formData,
			mediaType: 'application/x-www-form-urlencoded',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Import Resource
	 * Import a resource from a file into a specific infospace.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static importResource(data: ShareablesData['ImportResource']): CancelablePromise<unknown> {
		const {
targetInfospaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/shareables/shareables/import/{target_infospace_id}',
			path: {
				target_infospace_id: targetInfospaceId
			},
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Export Resources Batch
	 * Export multiple resources of the same type to a ZIP archive.
	 * @returns binary Successful batch export, returns a ZIP archive.
	 * @throws ApiError
	 */
	public static exportResourcesBatch(data: ShareablesData['ExportResourcesBatch']): CancelablePromise<Blob | File> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/shareables/shareables/{infospace_id}/export-batch',
			path: {
				infospace_id: infospaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				400: `Bad Request (e.g., no resource IDs)`,
				403: `Forbidden (e.g., permission denied for one or more resources)`,
				422: `Validation Error`,
				500: `Internal Server Error`,
			},
		});
	}

	/**
	 * View Dataset Package Summary
	 * Get a summary of a shared dataset package using its token.
 * Does not trigger a full download or import of the package data.
	 * @returns DatasetPackageSummary Successful Response
	 * @throws ApiError
	 */
	public static viewDatasetPackageSummary(data: ShareablesData['ViewDatasetPackageSummary']): CancelablePromise<DatasetPackageSummary> {
		const {
token,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/shareables/shareables/view_dataset_package_summary/{token}',
			path: {
				token
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class UsersService {

	/**
	 * Read Users
	 * Retrieve users.
	 * @returns UsersOut Successful Response
	 * @throws ApiError
	 */
	public static readUsers(data: UsersData['ReadUsers'] = {}): CancelablePromise<UsersOut> {
		const {
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/users/',
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create User
	 * Create new user.
	 * @returns UserOut Successful Response
	 * @throws ApiError
	 */
	public static createUser(data: UsersData['CreateUser']): CancelablePromise<UserOut> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/users/',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Users
	 * Retrieve users.
	 * @returns UsersOut Successful Response
	 * @throws ApiError
	 */
	public static readUsers1(data: UsersData['ReadUsers1'] = {}): CancelablePromise<UsersOut> {
		const {
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/users',
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create User
	 * Create new user.
	 * @returns UserOut Successful Response
	 * @throws ApiError
	 */
	public static createUser1(data: UsersData['CreateUser1']): CancelablePromise<UserOut> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/users',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read User Me
	 * Get current user.
	 * @returns UserOut Successful Response
	 * @throws ApiError
	 */
	public static readUserMe(): CancelablePromise<UserOut> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/users/me',
		});
	}

	/**
	 * Update User Me
	 * Update own user.
	 * @returns UserOut Successful Response
	 * @throws ApiError
	 */
	public static updateUserMe(data: UsersData['UpdateUserMe']): CancelablePromise<UserOut> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/users/me',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Password Me
	 * Update own password.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static updatePasswordMe(data: UsersData['UpdatePasswordMe']): CancelablePromise<Message> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/users/me/password',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create User Open
	 * Create new user without the need to be logged in.
	 * @returns UserOut Successful Response
	 * @throws ApiError
	 */
	public static createUserOpen(data: UsersData['CreateUserOpen']): CancelablePromise<UserOut> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/users/open',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read User By Id
	 * Get a specific user by id.
	 * @returns UserOut Successful Response
	 * @throws ApiError
	 */
	public static readUserById(data: UsersData['ReadUserById']): CancelablePromise<UserOut> {
		const {
userId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/users/{user_id}',
			path: {
				user_id: userId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update User
	 * Update a user.
	 * @returns UserOut Successful Response
	 * @throws ApiError
	 */
	public static updateUser(data: UsersData['UpdateUser']): CancelablePromise<UserOut> {
		const {
userId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/users/{user_id}',
			path: {
				user_id: userId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete User
	 * Delete a user.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static deleteUser(data: UsersData['DeleteUser']): CancelablePromise<Message> {
		const {
userId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/users/{user_id}',
			path: {
				user_id: userId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class UtilsService {

	/**
	 * Test Email
	 * Test emails.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static testEmail(data: UtilsData['TestEmail']): CancelablePromise<Message> {
		const {
emailTo,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/utils/utils/test-email/',
			query: {
				email_to: emailTo
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Healthz
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static healthz(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/utils/utils/healthz',
		});
	}

	/**
	 * Readyz
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static readyz(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/utils/utils/healthz/readiness',
		});
	}

	/**
	 * Liveness
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static liveness(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/utils/utils/healthz/liveness',
		});
	}

	/**
	 * Extract Pdf Text
	 * Extract text from PDF without authentication
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static extractPdfText(data: UtilsData['ExtractPdfText']): CancelablePromise<unknown> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/utils/utils/extract-pdf-text',
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Extract Pdf Metadata
	 * Extract metadata from PDF including title, author, etc.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static extractPdfMetadata(data: UtilsData['ExtractPdfMetadata']): CancelablePromise<unknown> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/utils/utils/extract-pdf-metadata',
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Scrape Article
	 * Scrape article content from a URL using the centralized OPOL instance.
 * 
 * Args:
 * url: The URL of the article to scrape
 * 
 * Returns:
 * The scraped article content
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static scrapeArticle(data: UtilsData['ScrapeArticle']): CancelablePromise<unknown> {
		const {
url,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/utils/utils/scrape_article',
			query: {
				url
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Providers
	 * Returns a hardcoded list of available classification providers and their models.
 * This is a temporary solution to bypass dynamic discovery issues.
	 * @returns ProviderListResponse Successful Response
	 * @throws ApiError
	 */
	public static getProviders(): CancelablePromise<ProviderListResponse> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/utils/utils/providers',
		});
	}

}

export class UtilitiesService {

	/**
	 * Test Email
	 * Test emails.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static testEmail(data: UtilitiesData['TestEmail']): CancelablePromise<Message> {
		const {
emailTo,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/utils/utils/test-email/',
			query: {
				email_to: emailTo
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Healthz
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static healthz(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/utils/utils/healthz',
		});
	}

	/**
	 * Readyz
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static readyz(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/utils/utils/healthz/readiness',
		});
	}

	/**
	 * Liveness
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static liveness(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/utils/utils/healthz/liveness',
		});
	}

	/**
	 * Extract Pdf Text
	 * Extract text from PDF without authentication
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static extractPdfText(data: UtilitiesData['ExtractPdfText']): CancelablePromise<unknown> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/utils/utils/extract-pdf-text',
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Extract Pdf Metadata
	 * Extract metadata from PDF including title, author, etc.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static extractPdfMetadata(data: UtilitiesData['ExtractPdfMetadata']): CancelablePromise<unknown> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/utils/utils/extract-pdf-metadata',
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Scrape Article
	 * Scrape article content from a URL using the centralized OPOL instance.
 * 
 * Args:
 * url: The URL of the article to scrape
 * 
 * Returns:
 * The scraped article content
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static scrapeArticle(data: UtilitiesData['ScrapeArticle']): CancelablePromise<unknown> {
		const {
url,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/utils/utils/scrape_article',
			query: {
				url
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Providers
	 * Returns a hardcoded list of available classification providers and their models.
 * This is a temporary solution to bypass dynamic discovery issues.
	 * @returns ProviderListResponse Successful Response
	 * @throws ApiError
	 */
	public static getProviders(): CancelablePromise<ProviderListResponse> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/utils/utils/providers',
		});
	}

}

export class EntitiesService {

	/**
	 * Search Entities
	 * Search and paginate through entities based on a query.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static searchEntities(data: EntitiesData['SearchEntities']): CancelablePromise<unknown> {
		const {
query,
skip = 0,
limit = 50,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/entities/',
			query: {
				query, skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Entity Details
	 * Retrieve detailed information about a specific entity.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getEntityDetails(data: EntitiesData['GetEntityDetails']): CancelablePromise<unknown> {
		const {
entity,
skip = 0,
limit = 50,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/entities/by_entity',
			query: {
				entity, skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Search Entities
	 * Search and paginate through entities based on a query.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static searchEntities1(data: EntitiesData['SearchEntities1']): CancelablePromise<unknown> {
		const {
query,
skip = 0,
limit = 50,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/entities/',
			query: {
				query, skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Entity Details
	 * Retrieve detailed information about a specific entity.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getEntityDetails1(data: EntitiesData['GetEntityDetails1']): CancelablePromise<unknown> {
		const {
entity,
skip = 0,
limit = 50,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/entities/by_entity',
			query: {
				entity, skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class LocationsService {

	/**
	 * Get Location Contents
	 * Get articles related to a location with basic pagination.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getLocationContents(data: LocationsData['GetLocationContents']): CancelablePromise<unknown> {
		const {
location,
skip = 0,
limit = 20,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/locations/{location}/contents',
			path: {
				location
			},
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Location Entities Contents
	 * Get articles related to a location with basic pagination.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getLocationEntitiesContents(data: LocationsData['GetLocationEntitiesContents']): CancelablePromise<unknown> {
		const {
location,
skip = 0,
limit = 20,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/locations/{location}/entities/contents',
			path: {
				location
			},
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Location From Query
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static locationFromQuery(data: LocationsData['LocationFromQuery']): CancelablePromise<unknown> {
		const {
query,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/locations/location_from_query',
			query: {
				query
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Geojson View
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static geojsonView(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/locations/geojson/',
		});
	}

	/**
	 * Geojson Events View
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static geojsonEventsView(data: LocationsData['GeojsonEventsView']): CancelablePromise<unknown> {
		const {
eventType,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/locations/geojson_events',
			query: {
				event_type: eventType
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Dashboard View
	 * @returns string Successful Response
	 * @throws ApiError
	 */
	public static dashboardView(): CancelablePromise<string> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/locations/dashboard',
		});
	}

	/**
	 * Get Location Entities
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getLocationEntities(data: LocationsData['GetLocationEntities']): CancelablePromise<unknown> {
		const {
locationName,
skip = 0,
limit = 50,
minRelevance = 0,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/locations/{location_name}/entities',
			path: {
				location_name: locationName
			},
			query: {
				skip, limit, min_relevance: minRelevance
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Leader Info
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getLeaderInfo(data: LocationsData['GetLeaderInfo']): CancelablePromise<unknown> {
		const {
state,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/locations/leaders/{state}',
			path: {
				state
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Legislation Data
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getLegislationData(data: LocationsData['GetLegislationData']): CancelablePromise<unknown> {
		const {
state,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/locations/legislation/{state}',
			path: {
				state
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Econ Data
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getEconData(data: LocationsData['GetEconData']): CancelablePromise<unknown> {
		const {
state,
indicators = [
    "GDP",
    "GDP_GROWTH"
],
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/locations/econ_data/{state}',
			path: {
				state
			},
			query: {
				indicators
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Leaders
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static updateLeaders(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/locations/update_leaders/',
		});
	}

	/**
	 * Get Tavily Data
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getTavilyData(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/locations/get_articles',
		});
	}

	/**
	 * Get Coordinates
	 * Fetches the coordinates, bounding box, and location type for a given location.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getCoordinates(data: LocationsData['GetCoordinates']): CancelablePromise<unknown> {
		const {
location,
language = 'en',
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/locations/get_coordinates',
			query: {
				location, language
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Geojson For Article Ids
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getGeojsonForArticleIds(data: LocationsData['GetGeojsonForArticleIds']): CancelablePromise<unknown> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/locations/get_geojson_for_article_ids',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Location Metadata
	 * Get metadata about a location including supported features
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getLocationMetadata(data: LocationsData['GetLocationMetadata']): CancelablePromise<unknown> {
		const {
location,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/locations/metadata/{location}',
			path: {
				location
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Channel Route
	 * A channel route that forwards requests to a specified service.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static channelRoute(data: LocationsData['ChannelRoute']): CancelablePromise<unknown> {
		const {
serviceName,
path,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/locations/channel/{service_name}/{path}',
			path: {
				service_name: serviceName, path
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class SearchService {

	/**
	 * Get Contents
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getContents(data: SearchData['GetContents'] = {}): CancelablePromise<unknown> {
		const {
searchQuery,
searchType = 'semantic',
skip = 0,
limit = 20,
newsCategory,
secondaryCategories,
keyword,
entities,
locations,
topics,
classificationScores,
keywordWeights,
excludeKeywords,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/search/contents',
			query: {
				search_query: searchQuery, search_type: searchType, skip, limit, news_category: newsCategory, secondary_categories: secondaryCategories, keyword, entities, locations, topics, classification_scores: classificationScores, keyword_weights: keywordWeights, exclude_keywords: excludeKeywords
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Most Relevant Entities
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getMostRelevantEntities(data: SearchData['GetMostRelevantEntities']): CancelablePromise<unknown> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/search/most_relevant_entities',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Search Synthesizer
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static searchSynthesizer(data: SearchData['SearchSynthesizer']): CancelablePromise<unknown> {
		const {
searchQuery,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/search/search_synthesizer',
			query: {
				search_query: searchQuery
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class ArticlesService {

	/**
	 * Get Articles
	 * @returns ArticleResponse Successful Response
	 * @throws ApiError
	 */
	public static getArticles(data: ArticlesData['GetArticles']): CancelablePromise<ArticleResponse> {
		const {
query,
skip = 0,
limit = 20,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/articles/basic',
			query: {
				query, skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Articles By Entity
	 * @returns ArticleResponse Successful Response
	 * @throws ApiError
	 */
	public static articlesByEntity(data: ArticlesData['ArticlesByEntity']): CancelablePromise<ArticleResponse> {
		const {
entity,
date,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/articles/by_entity',
			query: {
				entity, date
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Articles By Entity
	 * @returns ArticleResponse Successful Response
	 * @throws ApiError
	 */
	public static articlesByEntity1(data: ArticlesData['ArticlesByEntity1']): CancelablePromise<ArticleResponse> {
		const {
entity,
date,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/articles/by_entity/',
			query: {
				entity, date
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Article By Id
	 * Fetch a single article by its content ID.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static articleById(data: ArticlesData['ArticleById']): CancelablePromise<Record<string, unknown>> {
		const {
id,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/articles/by_id',
			query: {
				id
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class GeoService {

	/**
	 * Geojson Events View
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static geojsonEventsView(data: GeoData['GeojsonEventsView']): CancelablePromise<unknown> {
		const {
eventType,
args,
kwargs,
startDate,
endDate,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/geo/geojson_events',
			query: {
				event_type: eventType, start_date: startDate, end_date: endDate, limit, args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Geojson Raw View
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static geojsonRawView(data: GeoData['GeojsonRawView']): CancelablePromise<unknown> {
		const {
args,
kwargs,
startDate,
endDate,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/geo/geojson',
			query: {
				start_date: startDate, end_date: endDate, limit, args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class ScoresService {

	/**
	 * Get Entity Scores In Timeframe
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getEntityScoresInTimeframe(data: ScoresData['GetEntityScoresInTimeframe']): CancelablePromise<unknown> {
		const {
entity,
timeframeFrom = '2000-01-01',
timeframeTo = '2025-06-08',
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/scores/by_entity',
			query: {
				entity, timeframe_from: timeframeFrom, timeframe_to: timeframeTo
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}