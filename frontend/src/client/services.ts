import type { CancelablePromise } from './core/CancelablePromise';
import { OpenAPI } from './core/OpenAPI';
import { request as __request } from './core/request';

import type { RegistrationStats,AnalysisAdapterRead,AnnotationRunCreate,AnnotationRunRead,AnnotationRunsOut,AnnotationRunUpdate,CreatePackageFromRunRequest,Message,PackageRead,AnnotationSchemaCreate,AnnotationSchemaRead,AnnotationSchemasOut,AnnotationSchemaUpdate,AnnotationCreate,AnnotationRead,AnnotationRetryRequest,AnnotationsOut,AnnotationUpdate,ArticleComposition,AssetCreate,AssetRead,AssetsOut,AssetUpdate,Body_assets_add_files_to_bundle_background,Body_assets_create_assets_background_bulk,Body_assets_upload_file,BulkUrlIngestion,ReprocessOptions,BackupRestoreRequest,BackupShareRequest,InfospaceBackupCreate,InfospaceBackupRead,InfospaceBackupsOut,InfospaceBackupUpdate,InfospaceRead,BundleCreate,BundleRead,BundleUpdate,ChatRequest,ChatResponse,ModelListResponse,ToolCallRequest,AssetChunkRead,ChunkAssetRequest,ChunkAssetsRequest,ChunkingResultResponse,ChunkingStatsResponse,Body_datasets_import_dataset,DatasetCreate,DatasetRead,DatasetsOut,DatasetUpdate,EmbeddingGenerateRequest,EmbeddingModelCreate,EmbeddingModelRead,EmbeddingProvider,EmbeddingSearchRequest,EmbeddingSearchResponse,EmbeddingStatsResponse,Body_filestorage_file_upload,FileUploadResponse,Body_filters_test_filter,InfospaceCreate,InfospacesOut,InfospaceUpdate,Body_login_login_access_token,NewPassword,Token,UserOut,MonitorCreate,MonitorRead,MonitorUpdate,IntelligencePipelineCreate,IntelligencePipelineRead,IntelligencePipelineUpdate,PipelineExecutionRead,SearchHistoriesOut,SearchHistoryCreate,SearchHistoryRead,Body_sharing_export_resource,Body_sharing_import_resource,DatasetPackageSummary,ExportBatchRequest,ExportMixedBatchRequest,ImportFromTokenRequest,Paginated,ResourceType,ShareableLinkCreate,ShareableLinkRead,ShareableLinkStats,ShareableLinkUpdate,SharedResourcePreview,SourceCreate,SourceRead,SourcesOut,SourceTransferRequest,SourceTransferResponse,SourceUpdate,Body_sso_complete_discourse_sso,TaskCreate,TaskRead,TasksOut,TaskStatus,TaskType,TaskUpdate,UserBackupCreate,UserBackupRead,UserBackupRestoreRequest,UserBackupShareRequest,UserBackupsOut,UserBackupUpdate,Body_users_upload_profile_picture,UpdatePassword,UserCreate,UserCreateOpen,UserProfileStats,UserProfileUpdate,UserPublicProfile,UsersOut,UserUpdate,UserUpdateMe,Body_utils_extract_pdf_metadata,Body_utils_extract_pdf_text,ProviderListResponse,app__api__v1__entities__routes__SearchType,Request,app__api__v1__search__routes__SearchType,MostRelevantEntitiesRequest } from './models';

export type AdminData = {
        
    }

export type AnalysisAdaptersData = {
        ExecuteAnalysisAdapter: {
                    /**
 * The registered name of the adapter
 */
adapterName: string
requestBody: Record<string, unknown>
                    
                };
ExecuteAnalysisAdapter1: {
                    /**
 * The registered name of the adapter
 */
adapterName: string
requestBody: Record<string, unknown>
                    
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
CreateRun2: {
                    infospaceId: number
requestBody: AnnotationRunCreate
                    
                };
ListRuns2: {
                    /**
 * Include counts of annotations and assets
 */
includeCounts?: boolean
infospaceId: number
limit?: number
skip?: number
                    
                };
CreateRun3: {
                    infospaceId: number
requestBody: AnnotationRunCreate
                    
                };
ListRuns3: {
                    /**
 * Include counts of annotations and assets
 */
includeCounts?: boolean
infospaceId: number
limit?: number
skip?: number
                    
                };
GetRun1: {
                    /**
 * Include counts of annotations and assets
 */
includeCounts?: boolean
infospaceId: number
runId: number
                    
                };
UpdateRun1: {
                    infospaceId: number
requestBody: AnnotationRunUpdate
runId: number
                    
                };
DeleteRun1: {
                    infospaceId: number
runId: number
                    
                };
RetryFailedAnnotations1: {
                    infospaceId: number
runId: number
                    
                };
CreatePackageFromRunEndpoint1: {
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
CreateRun2: {
                    infospaceId: number
requestBody: AnnotationRunCreate
                    
                };
ListRuns2: {
                    /**
 * Include counts of annotations and assets
 */
includeCounts?: boolean
infospaceId: number
limit?: number
skip?: number
                    
                };
CreateRun3: {
                    infospaceId: number
requestBody: AnnotationRunCreate
                    
                };
ListRuns3: {
                    /**
 * Include counts of annotations and assets
 */
includeCounts?: boolean
infospaceId: number
limit?: number
skip?: number
                    
                };
GetRun1: {
                    /**
 * Include counts of annotations and assets
 */
includeCounts?: boolean
infospaceId: number
runId: number
                    
                };
UpdateRun1: {
                    infospaceId: number
requestBody: AnnotationRunUpdate
runId: number
                    
                };
DeleteRun1: {
                    infospaceId: number
runId: number
                    
                };
RetryFailedAnnotations1: {
                    infospaceId: number
runId: number
                    
                };
CreatePackageFromRunEndpoint1: {
                    infospaceId: number
requestBody: CreatePackageFromRunRequest
runId: number
                    
                };
    }

export type AnnotationSchemasData = {
        CreateAnnotationSchema: {
                    /**
 * The ID of the infospace
 */
infospaceId: number
requestBody: AnnotationSchemaCreate
                    
                };
ListAnnotationSchemas: {
                    /**
 * Include archived (inactive) schemas
 */
includeArchived?: boolean
/**
 * Include counts of annotations using this schema
 */
includeCounts?: boolean
/**
 * The ID of the infospace
 */
infospaceId: number
limit?: number
skip?: number
                    
                };
CreateAnnotationSchema1: {
                    /**
 * The ID of the infospace
 */
infospaceId: number
requestBody: AnnotationSchemaCreate
                    
                };
ListAnnotationSchemas1: {
                    /**
 * Include archived (inactive) schemas
 */
includeArchived?: boolean
/**
 * Include counts of annotations using this schema
 */
includeCounts?: boolean
/**
 * The ID of the infospace
 */
infospaceId: number
limit?: number
skip?: number
                    
                };
GetAnnotationSchema: {
                    /**
 * Include counts of annotations using this schema
 */
includeCounts?: boolean
/**
 * The ID of the infospace
 */
infospaceId: number
schemaId: number
                    
                };
UpdateAnnotationSchema: {
                    /**
 * The ID of the infospace
 */
infospaceId: number
requestBody: AnnotationSchemaUpdate
schemaId: number
                    
                };
DeleteAnnotationSchema: {
                    /**
 * The ID of the infospace
 */
infospaceId: number
schemaId: number
                    
                };
RestoreAnnotationSchema: {
                    infospaceId: number
schemaId: number
                    
                };
CreateAnnotationSchema2: {
                    /**
 * The ID of the infospace
 */
infospaceId: number
requestBody: AnnotationSchemaCreate
                    
                };
ListAnnotationSchemas2: {
                    /**
 * Include archived (inactive) schemas
 */
includeArchived?: boolean
/**
 * Include counts of annotations using this schema
 */
includeCounts?: boolean
/**
 * The ID of the infospace
 */
infospaceId: number
limit?: number
skip?: number
                    
                };
CreateAnnotationSchema3: {
                    /**
 * The ID of the infospace
 */
infospaceId: number
requestBody: AnnotationSchemaCreate
                    
                };
ListAnnotationSchemas3: {
                    /**
 * Include archived (inactive) schemas
 */
includeArchived?: boolean
/**
 * Include counts of annotations using this schema
 */
includeCounts?: boolean
/**
 * The ID of the infospace
 */
infospaceId: number
limit?: number
skip?: number
                    
                };
GetAnnotationSchema1: {
                    /**
 * Include counts of annotations using this schema
 */
includeCounts?: boolean
/**
 * The ID of the infospace
 */
infospaceId: number
schemaId: number
                    
                };
UpdateAnnotationSchema1: {
                    /**
 * The ID of the infospace
 */
infospaceId: number
requestBody: AnnotationSchemaUpdate
schemaId: number
                    
                };
DeleteAnnotationSchema1: {
                    /**
 * The ID of the infospace
 */
infospaceId: number
schemaId: number
                    
                };
RestoreAnnotationSchema1: {
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
requestBody: AnnotationRetryRequest
                    
                };
RetrySingleAnnotation1: {
                    annotationId: number
infospaceId: number
requestBody: AnnotationRetryRequest
                    
                };
CreateAnnotation4: {
                    infospaceId: number
requestBody: AnnotationCreate
                    
                };
CreateAnnotation5: {
                    infospaceId: number
requestBody: AnnotationCreate
                    
                };
ListAnnotations4: {
                    infospaceId: number
limit?: number
schemaId?: number | null
skip?: number
sourceId?: number | null
                    
                };
ListAnnotations5: {
                    infospaceId: number
limit?: number
schemaId?: number | null
skip?: number
sourceId?: number | null
                    
                };
CreateAnnotation6: {
                    infospaceId: number
requestBody: AnnotationCreate
                    
                };
CreateAnnotation7: {
                    infospaceId: number
requestBody: AnnotationCreate
                    
                };
ListAnnotations6: {
                    infospaceId: number
limit?: number
schemaId?: number | null
skip?: number
sourceId?: number | null
                    
                };
ListAnnotations7: {
                    infospaceId: number
limit?: number
schemaId?: number | null
skip?: number
sourceId?: number | null
                    
                };
GetAnnotation2: {
                    annotationId: number
infospaceId: number
                    
                };
GetAnnotation3: {
                    annotationId: number
infospaceId: number
                    
                };
UpdateAnnotation2: {
                    annotationId: number
infospaceId: number
requestBody: AnnotationUpdate
                    
                };
UpdateAnnotation3: {
                    annotationId: number
infospaceId: number
requestBody: AnnotationUpdate
                    
                };
DeleteAnnotation2: {
                    annotationId: number
infospaceId: number
                    
                };
DeleteAnnotation3: {
                    annotationId: number
infospaceId: number
                    
                };
CreateBatchAnnotations2: {
                    infospaceId: number
requestBody: Array<AnnotationCreate>
                    
                };
CreateBatchAnnotations3: {
                    infospaceId: number
requestBody: Array<AnnotationCreate>
                    
                };
GetRunResults2: {
                    infospaceId: number
limit?: number
runId: number
skip?: number
                    
                };
GetRunResults3: {
                    infospaceId: number
limit?: number
runId: number
skip?: number
                    
                };
RetrySingleAnnotation2: {
                    annotationId: number
infospaceId: number
requestBody: AnnotationRetryRequest
                    
                };
RetrySingleAnnotation3: {
                    annotationId: number
infospaceId: number
requestBody: AnnotationRetryRequest
                    
                };
    }

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
ComposeArticle: {
                    infospaceId: number
requestBody: ArticleComposition
                    
                };
ComposeArticle1: {
                    infospaceId: number
requestBody: ArticleComposition
                    
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
CreateAsset4: {
                    infospaceId: number
requestBody: AssetCreate
                    
                };
CreateAsset5: {
                    infospaceId: number
requestBody: AssetCreate
                    
                };
ListAssets4: {
                    infospaceId: number
limit?: number
parentAssetId?: number | null
skip?: number
                    
                };
ListAssets5: {
                    infospaceId: number
limit?: number
parentAssetId?: number | null
skip?: number
                    
                };
CreateAsset6: {
                    infospaceId: number
requestBody: AssetCreate
                    
                };
CreateAsset7: {
                    infospaceId: number
requestBody: AssetCreate
                    
                };
ListAssets6: {
                    infospaceId: number
limit?: number
parentAssetId?: number | null
skip?: number
                    
                };
ListAssets7: {
                    infospaceId: number
limit?: number
parentAssetId?: number | null
skip?: number
                    
                };
UploadFile2: {
                    formData: Body_assets_upload_file
infospaceId: number
                    
                };
UploadFile3: {
                    formData: Body_assets_upload_file
infospaceId: number
                    
                };
IngestUrl2: {
                    infospaceId: number
scrapeImmediately?: boolean
title?: string | null
url: string
                    
                };
IngestUrl3: {
                    infospaceId: number
scrapeImmediately?: boolean
title?: string | null
url: string
                    
                };
IngestText2: {
                    eventTimestamp?: string | null
infospaceId: number
textContent: string
title?: string | null
                    
                };
IngestText3: {
                    eventTimestamp?: string | null
infospaceId: number
textContent: string
title?: string | null
                    
                };
ComposeArticle2: {
                    infospaceId: number
requestBody: ArticleComposition
                    
                };
ComposeArticle3: {
                    infospaceId: number
requestBody: ArticleComposition
                    
                };
BulkIngestUrls2: {
                    infospaceId: number
requestBody: BulkUrlIngestion
                    
                };
BulkIngestUrls3: {
                    infospaceId: number
requestBody: BulkUrlIngestion
                    
                };
ReprocessAsset2: {
                    assetId: number
infospaceId: number
requestBody: ReprocessOptions
                    
                };
ReprocessAsset3: {
                    assetId: number
infospaceId: number
requestBody: ReprocessOptions
                    
                };
GetAsset2: {
                    assetId: number
infospaceId: number
                    
                };
GetAsset3: {
                    assetId: number
infospaceId: number
                    
                };
UpdateAsset2: {
                    assetId: number
infospaceId: number
requestBody: AssetUpdate
                    
                };
UpdateAsset3: {
                    assetId: number
infospaceId: number
requestBody: AssetUpdate
                    
                };
DeleteAsset2: {
                    assetId: number
infospaceId: number
                    
                };
DeleteAsset3: {
                    assetId: number
infospaceId: number
                    
                };
GetAssetChildren2: {
                    assetId: number
infospaceId: number
limit?: number
skip?: number
                    
                };
GetAssetChildren3: {
                    assetId: number
infospaceId: number
limit?: number
skip?: number
                    
                };
CreateAssetsBackgroundBulk2: {
                    formData: Body_assets_create_assets_background_bulk
infospaceId: number
                    
                };
CreateAssetsBackgroundBulk3: {
                    formData: Body_assets_create_assets_background_bulk
infospaceId: number
                    
                };
CreateAssetsBackgroundUrls2: {
                    infospaceId: number
requestBody: BulkUrlIngestion
                    
                };
CreateAssetsBackgroundUrls3: {
                    infospaceId: number
requestBody: BulkUrlIngestion
                    
                };
AddFilesToBundleBackground2: {
                    bundleId: number
formData: Body_assets_add_files_to_bundle_background
infospaceId: number
                    
                };
AddFilesToBundleBackground3: {
                    bundleId: number
formData: Body_assets_add_files_to_bundle_background
infospaceId: number
                    
                };
GetTaskStatus2: {
                    taskId: string
                    
                };
GetTaskStatus3: {
                    taskId: string
                    
                };
    }

export type BackupsData = {
        CreateBackup: {
                    infospaceId: number
requestBody: InfospaceBackupCreate
                    
                };
ListBackups: {
                    infospaceId: number
limit?: number
skip?: number
                    
                };
ListAllUserBackups: {
                    limit?: number
skip?: number
                    
                };
GetBackup: {
                    backupId: number
                    
                };
UpdateBackup: {
                    backupId: number
requestBody: InfospaceBackupUpdate
                    
                };
DeleteBackup: {
                    backupId: number
                    
                };
RestoreBackup: {
                    backupId: number
requestBody: BackupRestoreRequest
                    
                };
CreateBackupShareLink: {
                    backupId: number
requestBody: BackupShareRequest
                    
                };
DownloadSharedBackup: {
                    shareToken: string
                    
                };
GetInfospacesBackupOverview: {
                    limit?: number
/**
 * Search infospace names or user emails
 */
search?: string | null
skip?: number
/**
 * Filter by specific user ID
 */
userId?: number | null
                    
                };
TriggerBackupAllInfospaces: {
                    backupType?: string
                    
                };
TriggerBackupSpecificInfospaces: {
                    backupType?: string
requestBody: Array<number>
                    
                };
CreateBackup1: {
                    infospaceId: number
requestBody: InfospaceBackupCreate
                    
                };
ListBackups1: {
                    infospaceId: number
limit?: number
skip?: number
                    
                };
ListAllUserBackups1: {
                    limit?: number
skip?: number
                    
                };
GetBackup1: {
                    backupId: number
                    
                };
UpdateBackup1: {
                    backupId: number
requestBody: InfospaceBackupUpdate
                    
                };
DeleteBackup1: {
                    backupId: number
                    
                };
RestoreBackup1: {
                    backupId: number
requestBody: BackupRestoreRequest
                    
                };
CreateBackupShareLink1: {
                    backupId: number
requestBody: BackupShareRequest
                    
                };
DownloadSharedBackup1: {
                    shareToken: string
                    
                };
GetInfospacesBackupOverview1: {
                    limit?: number
/**
 * Search infospace names or user emails
 */
search?: string | null
skip?: number
/**
 * Filter by specific user ID
 */
userId?: number | null
                    
                };
TriggerBackupAllInfospaces1: {
                    backupType?: string
                    
                };
TriggerBackupSpecificInfospaces1: {
                    backupType?: string
requestBody: Array<number>
                    
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
infospaceId: number
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
CreateBundle1: {
                    infospaceId: number
requestBody: BundleCreate
                    
                };
GetBundles1: {
                    infospaceId: number
limit?: number
skip?: number
                    
                };
GetBundle1: {
                    bundleId: number
                    
                };
UpdateBundle1: {
                    bundleId: number
requestBody: BundleUpdate
                    
                };
DeleteBundle1: {
                    bundleId: number
                    
                };
AddAssetToBundle1: {
                    assetId: number
bundleId: number
                    
                };
RemoveAssetFromBundle1: {
                    assetId: number
bundleId: number
                    
                };
GetAssetsInBundle1: {
                    bundleId: number
infospaceId: number
limit?: number
skip?: number
                    
                };
GetAsset1: {
                    assetId: number
                    
                };
TransferBundle1: {
                    bundleId: number
copy?: boolean
targetInfospaceId: number
                    
                };
    }

export type IntelligenceChatData = {
        IntelligenceChat: {
                    requestBody: ChatRequest
                    
                };
ExecuteToolCall: {
                    requestBody: ToolCallRequest
                    
                };
ListAvailableModels: {
                    capability?: string | null
                    
                };
GetInfospaceToolContext: {
                    infospaceId: number
                    
                };
IntelligenceChat1: {
                    requestBody: ChatRequest
                    
                };
ExecuteToolCall1: {
                    requestBody: ToolCallRequest
                    
                };
ListAvailableModels1: {
                    capability?: string | null
                    
                };
GetInfospaceToolContext1: {
                    infospaceId: number
                    
                };
    }

export type ChunkingData = {
        ChunkSingleAsset: {
                    assetId: number
requestBody: ChunkAssetRequest
                    
                };
ChunkMultipleAssets: {
                    requestBody: ChunkAssetsRequest
                    
                };
GetAssetChunks: {
                    assetId: number
                    
                };
RemoveAssetChunks: {
                    assetId: number
                    
                };
GetChunkingStatistics: {
                    /**
 * Filter by specific asset
 */
assetId?: number | null
/**
 * Filter by infospace
 */
infospaceId?: number | null
                    
                };
ChunkSingleAsset1: {
                    assetId: number
requestBody: ChunkAssetRequest
                    
                };
ChunkMultipleAssets1: {
                    requestBody: ChunkAssetsRequest
                    
                };
GetAssetChunks1: {
                    assetId: number
                    
                };
RemoveAssetChunks1: {
                    assetId: number
                    
                };
GetChunkingStatistics1: {
                    /**
 * Filter by specific asset
 */
assetId?: number | null
/**
 * Filter by infospace
 */
infospaceId?: number | null
                    
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
CreateDataset2: {
                    infospaceId: number
requestBody: DatasetCreate
                    
                };
ListDatasets2: {
                    infospaceId: number
limit?: number
skip?: number
                    
                };
CreateDataset3: {
                    infospaceId: number
requestBody: DatasetCreate
                    
                };
ListDatasets3: {
                    infospaceId: number
limit?: number
skip?: number
                    
                };
GetDataset1: {
                    datasetId: number
infospaceId: number
                    
                };
UpdateDataset1: {
                    datasetId: number
infospaceId: number
requestBody: DatasetUpdate
                    
                };
DeleteDataset1: {
                    datasetId: number
infospaceId: number
                    
                };
ExportDataset1: {
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
ImportDataset1: {
                    /**
 * How to handle conflicts
 */
conflictStrategy?: string
formData: Body_datasets_import_dataset
infospaceId: number
                    
                };
ImportDatasetFromToken1: {
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

export type EmbeddingsData = {
        ListEmbeddingModels: {
                    /**
 * Only return active models
 */
activeOnly?: boolean
                    
                };
CreateEmbeddingModel: {
                    requestBody: EmbeddingModelCreate
                    
                };
GetEmbeddingModelStats: {
                    modelId: number
                    
                };
GenerateEmbeddings: {
                    requestBody: EmbeddingGenerateRequest
                    
                };
SimilaritySearch: {
                    requestBody: EmbeddingSearchRequest
                    
                };
EmbedText: {
                    modelName: string
provider: EmbeddingProvider
text: string
                    
                };
DeactivateEmbeddingModel: {
                    modelId: number
                    
                };
ListEmbeddingModels1: {
                    /**
 * Only return active models
 */
activeOnly?: boolean
                    
                };
CreateEmbeddingModel1: {
                    requestBody: EmbeddingModelCreate
                    
                };
GetEmbeddingModelStats1: {
                    modelId: number
                    
                };
GenerateEmbeddings1: {
                    requestBody: EmbeddingGenerateRequest
                    
                };
SimilaritySearch1: {
                    requestBody: EmbeddingSearchRequest
                    
                };
EmbedText1: {
                    modelName: string
provider: EmbeddingProvider
text: string
                    
                };
DeactivateEmbeddingModel1: {
                    modelId: number
                    
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
FileUpload1: {
                    formData: Body_filestorage_file_upload
                    
                };
FileDownload1: {
                    filePath: string
                    
                };
ListFiles1: {
                    maxKeys?: number
prefix?: string | null
                    
                };
DeleteFile1: {
                    objectName: string
                    
                };
StreamFile1: {
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
FileUpload1: {
                    formData: Body_filestorage_file_upload
                    
                };
FileDownload1: {
                    filePath: string
                    
                };
ListFiles1: {
                    maxKeys?: number
prefix?: string | null
                    
                };
DeleteFile1: {
                    objectName: string
                    
                };
StreamFile1: {
                    filePath: string
                    
                };
    }

export type FiltersData = {
        SaveFilter: {
                    filterName: string
requestBody: Record<string, unknown>
                    
                };
GetFilter: {
                    filterName: string
                    
                };
DeleteFilter: {
                    filterName: string
                    
                };
TestFilter: {
                    requestBody: Body_filters_test_filter
                    
                };
CreateThresholdFilter: {
                    field: string
operator?: string
threshold: number
                    
                };
CreateRangeFilter: {
                    field: string
maxValue: number
minValue: number
                    
                };
CreateKeywordFilter: {
                    field: string
matchAny?: boolean
requestBody: Array<string>
                    
                };
SaveFilter1: {
                    filterName: string
requestBody: Record<string, unknown>
                    
                };
GetFilter1: {
                    filterName: string
                    
                };
DeleteFilter1: {
                    filterName: string
                    
                };
TestFilter1: {
                    requestBody: Body_filters_test_filter
                    
                };
CreateThresholdFilter1: {
                    field: string
operator?: string
threshold: number
                    
                };
CreateRangeFilter1: {
                    field: string
maxValue: number
minValue: number
                    
                };
CreateKeywordFilter1: {
                    field: string
matchAny?: boolean
requestBody: Array<string>
                    
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
CreateInfospace2: {
                    requestBody: InfospaceCreate
                    
                };
ListInfospaces2: {
                    limit?: number
skip?: number
                    
                };
CreateInfospace3: {
                    requestBody: InfospaceCreate
                    
                };
ListInfospaces3: {
                    limit?: number
skip?: number
                    
                };
GetInfospace1: {
                    infospaceId: number
                    
                };
UpdateInfospace1: {
                    infospaceId: number
requestBody: InfospaceUpdate
                    
                };
DeleteInfospace1: {
                    infospaceId: number
                    
                };
GetInfospaceStats1: {
                    infospaceId: number
                    
                };
ImportInfospace1: {
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
LoginAccessToken1: {
                    formData: Body_login_login_access_token
                    
                };
RecoverPassword1: {
                    email: string
                    
                };
ResetPassword1: {
                    requestBody: NewPassword
                    
                };
RecoverPasswordHtmlContent1: {
                    email: string
                    
                };
    }

export type MonitorsData = {
        CreateMonitor: {
                    infospaceId: number
requestBody: MonitorCreate
                    
                };
ListMonitors: {
                    infospaceId: number
limit?: number
skip?: number
                    
                };
GetMonitor: {
                    monitorId: number
                    
                };
UpdateMonitor: {
                    monitorId: number
requestBody: MonitorUpdate
                    
                };
DeleteMonitor: {
                    monitorId: number
                    
                };
ExecuteMonitorManually: {
                    monitorId: number
                    
                };
CreateMonitor1: {
                    infospaceId: number
requestBody: MonitorCreate
                    
                };
ListMonitors1: {
                    infospaceId: number
limit?: number
skip?: number
                    
                };
GetMonitor1: {
                    monitorId: number
                    
                };
UpdateMonitor1: {
                    monitorId: number
requestBody: MonitorUpdate
                    
                };
DeleteMonitor1: {
                    monitorId: number
                    
                };
ExecuteMonitorManually1: {
                    monitorId: number
                    
                };
    }

export type PipelinesData = {
        CreatePipeline: {
                    infospaceId: number
requestBody: IntelligencePipelineCreate
                    
                };
ListPipelines: {
                    infospaceId: number
                    
                };
GetPipeline: {
                    pipelineId: number
                    
                };
UpdatePipeline: {
                    pipelineId: number
requestBody: IntelligencePipelineUpdate
                    
                };
DeletePipeline: {
                    pipelineId: number
                    
                };
ExecutePipeline: {
                    pipelineId: number
requestBody: Array<number>
                    
                };
CreatePipeline1: {
                    infospaceId: number
requestBody: IntelligencePipelineCreate
                    
                };
ListPipelines1: {
                    infospaceId: number
                    
                };
GetPipeline1: {
                    pipelineId: number
                    
                };
UpdatePipeline1: {
                    pipelineId: number
requestBody: IntelligencePipelineUpdate
                    
                };
DeletePipeline1: {
                    pipelineId: number
                    
                };
ExecutePipeline1: {
                    pipelineId: number
requestBody: Array<number>
                    
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
CreateSearchHistory1: {
                    requestBody: SearchHistoryCreate
                    
                };
ReadSearchHistories1: {
                    limit?: number
skip?: number
                    
                };
    }

export type SharingData = {
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
ViewSharedResource: {
                    token: string
                    
                };
GetSharingStats: {
                    infospaceId: number
                    
                };
ExportResource: {
                    formData: Body_sharing_export_resource
infospaceId: number
                    
                };
ImportResource: {
                    formData: Body_sharing_import_resource
targetInfospaceId: number
                    
                };
ExportResourcesBatch: {
                    infospaceId: number
requestBody: ExportBatchRequest
                    
                };
ExportMixedBatch: {
                    infospaceId: number
requestBody: ExportMixedBatchRequest
                    
                };
StreamSharedAssetFile: {
                    assetId: number
token: string
                    
                };
DownloadSharedBundle: {
                    token: string
                    
                };
DownloadSharedAssetFile: {
                    assetId: number
token: string
                    
                };
ViewDatasetPackageSummary: {
                    token: string
                    
                };
ImportResourceFromToken: {
                    requestBody: ImportFromTokenRequest
token: string
                    
                };
CreateShareableLink1: {
                    infospaceId: number
requestBody: ShareableLinkCreate
                    
                };
GetShareableLinks1: {
                    infospaceId: number
resourceId?: number | null
resourceType?: ResourceType | null
                    
                };
GetShareableLinkByToken1: {
                    token: string
                    
                };
UpdateShareableLink1: {
                    linkId: number
requestBody: ShareableLinkUpdate
                    
                };
DeleteShareableLink1: {
                    linkId: number
                    
                };
AccessSharedResource1: {
                    token: string
                    
                };
ViewSharedResource1: {
                    token: string
                    
                };
GetSharingStats1: {
                    infospaceId: number
                    
                };
ExportResource1: {
                    formData: Body_sharing_export_resource
infospaceId: number
                    
                };
ImportResource1: {
                    formData: Body_sharing_import_resource
targetInfospaceId: number
                    
                };
ExportResourcesBatch1: {
                    infospaceId: number
requestBody: ExportBatchRequest
                    
                };
ExportMixedBatch1: {
                    infospaceId: number
requestBody: ExportMixedBatchRequest
                    
                };
StreamSharedAssetFile1: {
                    assetId: number
token: string
                    
                };
DownloadSharedBundle1: {
                    token: string
                    
                };
DownloadSharedAssetFile1: {
                    assetId: number
token: string
                    
                };
ViewDatasetPackageSummary1: {
                    token: string
                    
                };
ImportResourceFromToken1: {
                    requestBody: ImportFromTokenRequest
token: string
                    
                };
    }

export type SourcesData = {
        CreateSource: {
                    infospaceId: number
requestBody: SourceCreate
                    
                };
ListSources: {
                    /**
 * Include counts of assets
 */
includeCounts?: boolean
infospaceId: number
limit?: number
skip?: number
                    
                };
CreateSource1: {
                    infospaceId: number
requestBody: SourceCreate
                    
                };
ListSources1: {
                    /**
 * Include counts of assets
 */
includeCounts?: boolean
infospaceId: number
limit?: number
skip?: number
                    
                };
GetSource: {
                    /**
 * Include counts of assets
 */
includeCounts?: boolean
infospaceId: number
sourceId: number
                    
                };
UpdateSource: {
                    infospaceId: number
requestBody: SourceUpdate
sourceId: number
                    
                };
DeleteSource: {
                    infospaceId: number
sourceId: number
                    
                };
TransferSources: {
                    requestBody: SourceTransferRequest
                    
                };
CreateSource2: {
                    infospaceId: number
requestBody: SourceCreate
                    
                };
ListSources2: {
                    /**
 * Include counts of assets
 */
includeCounts?: boolean
infospaceId: number
limit?: number
skip?: number
                    
                };
CreateSource3: {
                    infospaceId: number
requestBody: SourceCreate
                    
                };
ListSources3: {
                    /**
 * Include counts of assets
 */
includeCounts?: boolean
infospaceId: number
limit?: number
skip?: number
                    
                };
GetSource1: {
                    /**
 * Include counts of assets
 */
includeCounts?: boolean
infospaceId: number
sourceId: number
                    
                };
UpdateSource1: {
                    infospaceId: number
requestBody: SourceUpdate
sourceId: number
                    
                };
DeleteSource1: {
                    infospaceId: number
sourceId: number
                    
                };
TransferSources1: {
                    requestBody: SourceTransferRequest
                    
                };
    }

export type SsoData = {
        HandleDiscourseSso: {
                    /**
 * Signature from Discourse
 */
sig?: string
/**
 * SSO payload from Discourse
 */
sso: string
                    
                };
HandleDiscourseSso1: {
                    /**
 * Signature from Discourse
 */
sig?: string
/**
 * SSO payload from Discourse
 */
sso: string
                    
                };
SyncUserToDiscourse: {
                    userId?: number
                    
                };
SyncUserToDiscourse1: {
                    userId?: number
                    
                };
CompleteDiscourseSso: {
                    formData: Body_sso_complete_discourse_sso
                    
                };
CompleteDiscourseSso1: {
                    formData: Body_sso_complete_discourse_sso
                    
                };
HandleDiscourseSso2: {
                    /**
 * Signature from Discourse
 */
sig?: string
/**
 * SSO payload from Discourse
 */
sso: string
                    
                };
HandleDiscourseSso3: {
                    /**
 * Signature from Discourse
 */
sig?: string
/**
 * SSO payload from Discourse
 */
sso: string
                    
                };
SyncUserToDiscourse2: {
                    userId?: number
                    
                };
SyncUserToDiscourse3: {
                    userId?: number
                    
                };
CompleteDiscourseSso2: {
                    formData: Body_sso_complete_discourse_sso
                    
                };
CompleteDiscourseSso3: {
                    formData: Body_sso_complete_discourse_sso
                    
                };
    }

export type TasksData = {
        CreateTask: {
                    args: unknown
infospaceId: number
kwargs: unknown
requestBody: TaskCreate
                    
                };
CreateTask1: {
                    args: unknown
infospaceId: number
kwargs: unknown
requestBody: TaskCreate
                    
                };
ListTasks: {
                    args: unknown
infospaceId: number
/**
 * Filter by is_enabled flag
 */
isEnabled?: boolean | null
kwargs: unknown
limit?: number
skip?: number
/**
 * Filter by task status
 */
status?: TaskStatus | null
/**
 * Filter by task type
 */
type?: TaskType | null
                    
                };
ListTasks1: {
                    args: unknown
infospaceId: number
/**
 * Filter by is_enabled flag
 */
isEnabled?: boolean | null
kwargs: unknown
limit?: number
skip?: number
/**
 * Filter by task status
 */
status?: TaskStatus | null
/**
 * Filter by task type
 */
type?: TaskType | null
                    
                };
CreateTask2: {
                    args: unknown
infospaceId: number
kwargs: unknown
requestBody: TaskCreate
                    
                };
CreateTask3: {
                    args: unknown
infospaceId: number
kwargs: unknown
requestBody: TaskCreate
                    
                };
ListTasks2: {
                    args: unknown
infospaceId: number
/**
 * Filter by is_enabled flag
 */
isEnabled?: boolean | null
kwargs: unknown
limit?: number
skip?: number
/**
 * Filter by task status
 */
status?: TaskStatus | null
/**
 * Filter by task type
 */
type?: TaskType | null
                    
                };
ListTasks3: {
                    args: unknown
infospaceId: number
/**
 * Filter by is_enabled flag
 */
isEnabled?: boolean | null
kwargs: unknown
limit?: number
skip?: number
/**
 * Filter by task status
 */
status?: TaskStatus | null
/**
 * Filter by task type
 */
type?: TaskType | null
                    
                };
GetTask: {
                    args: unknown
infospaceId: number
kwargs: unknown
taskId: number
                    
                };
GetTask1: {
                    args: unknown
infospaceId: number
kwargs: unknown
taskId: number
                    
                };
UpdateTask: {
                    args: unknown
infospaceId: number
kwargs: unknown
requestBody: TaskUpdate
taskId: number
                    
                };
UpdateTask1: {
                    args: unknown
infospaceId: number
kwargs: unknown
requestBody: TaskUpdate
taskId: number
                    
                };
DeleteTask: {
                    args: unknown
infospaceId: number
kwargs: unknown
taskId: number
                    
                };
DeleteTask1: {
                    args: unknown
infospaceId: number
kwargs: unknown
taskId: number
                    
                };
ExecuteTaskManually: {
                    args: unknown
infospaceId: number
kwargs: unknown
taskId: number
                    
                };
ExecuteTaskManually1: {
                    args: unknown
infospaceId: number
kwargs: unknown
taskId: number
                    
                };
CreateTask4: {
                    args: unknown
infospaceId: number
kwargs: unknown
requestBody: TaskCreate
                    
                };
CreateTask5: {
                    args: unknown
infospaceId: number
kwargs: unknown
requestBody: TaskCreate
                    
                };
ListTasks4: {
                    args: unknown
infospaceId: number
/**
 * Filter by is_enabled flag
 */
isEnabled?: boolean | null
kwargs: unknown
limit?: number
skip?: number
/**
 * Filter by task status
 */
status?: TaskStatus | null
/**
 * Filter by task type
 */
type?: TaskType | null
                    
                };
ListTasks5: {
                    args: unknown
infospaceId: number
/**
 * Filter by is_enabled flag
 */
isEnabled?: boolean | null
kwargs: unknown
limit?: number
skip?: number
/**
 * Filter by task status
 */
status?: TaskStatus | null
/**
 * Filter by task type
 */
type?: TaskType | null
                    
                };
CreateTask6: {
                    args: unknown
infospaceId: number
kwargs: unknown
requestBody: TaskCreate
                    
                };
CreateTask7: {
                    args: unknown
infospaceId: number
kwargs: unknown
requestBody: TaskCreate
                    
                };
ListTasks6: {
                    args: unknown
infospaceId: number
/**
 * Filter by is_enabled flag
 */
isEnabled?: boolean | null
kwargs: unknown
limit?: number
skip?: number
/**
 * Filter by task status
 */
status?: TaskStatus | null
/**
 * Filter by task type
 */
type?: TaskType | null
                    
                };
ListTasks7: {
                    args: unknown
infospaceId: number
/**
 * Filter by is_enabled flag
 */
isEnabled?: boolean | null
kwargs: unknown
limit?: number
skip?: number
/**
 * Filter by task status
 */
status?: TaskStatus | null
/**
 * Filter by task type
 */
type?: TaskType | null
                    
                };
GetTask2: {
                    args: unknown
infospaceId: number
kwargs: unknown
taskId: number
                    
                };
GetTask3: {
                    args: unknown
infospaceId: number
kwargs: unknown
taskId: number
                    
                };
UpdateTask2: {
                    args: unknown
infospaceId: number
kwargs: unknown
requestBody: TaskUpdate
taskId: number
                    
                };
UpdateTask3: {
                    args: unknown
infospaceId: number
kwargs: unknown
requestBody: TaskUpdate
taskId: number
                    
                };
DeleteTask2: {
                    args: unknown
infospaceId: number
kwargs: unknown
taskId: number
                    
                };
DeleteTask3: {
                    args: unknown
infospaceId: number
kwargs: unknown
taskId: number
                    
                };
ExecuteTaskManually2: {
                    args: unknown
infospaceId: number
kwargs: unknown
taskId: number
                    
                };
ExecuteTaskManually3: {
                    args: unknown
infospaceId: number
kwargs: unknown
taskId: number
                    
                };
    }

export type UserBackupsData = {
        CreateUserBackup: {
                    requestBody: UserBackupCreate
                    
                };
ListUserBackups: {
                    limit?: number
skip?: number
/**
 * Filter by specific target user
 */
targetUserId?: number | null
                    
                };
GetUserBackup: {
                    backupId: number
                    
                };
UpdateUserBackup: {
                    backupId: number
requestBody: UserBackupUpdate
                    
                };
DeleteUserBackup: {
                    backupId: number
                    
                };
RestoreUserBackup: {
                    backupId: number
requestBody: UserBackupRestoreRequest
                    
                };
CreateUserBackupShareLink: {
                    backupId: number
requestBody: UserBackupShareRequest
                    
                };
DownloadSharedUserBackup: {
                    shareToken: string
                    
                };
GetUsersBackupOverview: {
                    limit?: number
/**
 * Search user emails or names
 */
search?: string | null
skip?: number
                    
                };
TriggerBackupAllUsers: {
                    backupType?: string
                    
                };
TriggerBackupSpecificUsers: {
                    backupType?: string
requestBody: Array<number>
                    
                };
CreateUserBackup1: {
                    requestBody: UserBackupCreate
                    
                };
ListUserBackups1: {
                    limit?: number
skip?: number
/**
 * Filter by specific target user
 */
targetUserId?: number | null
                    
                };
GetUserBackup1: {
                    backupId: number
                    
                };
UpdateUserBackup1: {
                    backupId: number
requestBody: UserBackupUpdate
                    
                };
DeleteUserBackup1: {
                    backupId: number
                    
                };
RestoreUserBackup1: {
                    backupId: number
requestBody: UserBackupRestoreRequest
                    
                };
CreateUserBackupShareLink1: {
                    backupId: number
requestBody: UserBackupShareRequest
                    
                };
DownloadSharedUserBackup1: {
                    shareToken: string
                    
                };
GetUsersBackupOverview1: {
                    limit?: number
/**
 * Search user emails or names
 */
search?: string | null
skip?: number
                    
                };
TriggerBackupAllUsers1: {
                    backupType?: string
                    
                };
TriggerBackupSpecificUsers1: {
                    backupType?: string
requestBody: Array<number>
                    
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
UploadProfilePicture: {
                    formData: Body_users_upload_profile_picture
                    
                };
GetUserPublicProfile: {
                    userId: number
                    
                };
GetProfilePicture: {
                    filename: string
userId: number
                    
                };
ListUserProfiles: {
                    limit?: number
search?: string
skip?: number
                    
                };
GetUserProfileStats: {
                    userId: number
                    
                };
UpdateUserProfile: {
                    requestBody: UserProfileUpdate
                    
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
VerifyEmail: {
                    token: string
                    
                };
ResendVerification: {
                    email: string
                    
                };
ReadUsers2: {
                    limit?: number
skip?: number
                    
                };
CreateUser2: {
                    requestBody: UserCreate
                    
                };
ReadUsers3: {
                    limit?: number
skip?: number
                    
                };
CreateUser3: {
                    requestBody: UserCreate
                    
                };
UpdateUserMe1: {
                    requestBody: UserUpdateMe
                    
                };
UpdatePasswordMe1: {
                    requestBody: UpdatePassword
                    
                };
UploadProfilePicture1: {
                    formData: Body_users_upload_profile_picture
                    
                };
GetUserPublicProfile1: {
                    userId: number
                    
                };
GetProfilePicture1: {
                    filename: string
userId: number
                    
                };
ListUserProfiles1: {
                    limit?: number
search?: string
skip?: number
                    
                };
GetUserProfileStats1: {
                    userId: number
                    
                };
UpdateUserProfile1: {
                    requestBody: UserProfileUpdate
                    
                };
CreateUserOpen1: {
                    requestBody: UserCreateOpen
                    
                };
ReadUserById1: {
                    userId: number
                    
                };
UpdateUser1: {
                    requestBody: UserUpdate
userId: number
                    
                };
DeleteUser1: {
                    userId: number
                    
                };
VerifyEmail1: {
                    token: string
                    
                };
ResendVerification1: {
                    email: string
                    
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
PullOllamaModel: {
                    modelName: string
                    
                };
GetOllamaAvailableModels: {
                    limit?: number
sort?: string
                    
                };
RemoveOllamaModel: {
                    modelName: string
                    
                };
TestEmail1: {
                    emailTo: string
                    
                };
ExtractPdfText1: {
                    formData: Body_utils_extract_pdf_text
                    
                };
ExtractPdfMetadata1: {
                    formData: Body_utils_extract_pdf_metadata
                    
                };
ScrapeArticle1: {
                    url: string
                    
                };
PullOllamaModel1: {
                    modelName: string
                    
                };
GetOllamaAvailableModels1: {
                    limit?: number
sort?: string
                    
                };
RemoveOllamaModel1: {
                    modelName: string
                    
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
PullOllamaModel: {
                    modelName: string
                    
                };
GetOllamaAvailableModels: {
                    limit?: number
sort?: string
                    
                };
RemoveOllamaModel: {
                    modelName: string
                    
                };
TestEmail1: {
                    emailTo: string
                    
                };
ExtractPdfText1: {
                    formData: Body_utils_extract_pdf_text
                    
                };
ExtractPdfMetadata1: {
                    formData: Body_utils_extract_pdf_metadata
                    
                };
ScrapeArticle1: {
                    url: string
                    
                };
PullOllamaModel1: {
                    modelName: string
                    
                };
GetOllamaAvailableModels1: {
                    limit?: number
sort?: string
                    
                };
RemoveOllamaModel1: {
                    modelName: string
                    
                };
    }

export type EntitiesData = {
        GetLocationArticles: {
                    limit?: number
location: string
searchQuery?: string | null
searchType?: app__api__v1__entities__routes__SearchType
skip?: number
                    
                };
GetEntityArticles: {
                    entityName: string
limit?: number
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
GetEntityScoreOverTime: {
                    entity: string
scoreType: string
timeframeFrom: string
timeframeTo: string
                    
                };
GetTopEntitiesByScore: {
                    /**
 * Number of top entities to retrieve
 */
limit?: number
/**
 * Type of score to rank entities by
 */
scoreType: string
/**
 * Start date in ISO format
 */
timeframeFrom: string
/**
 * End date in ISO format
 */
timeframeTo: string
                    
                };
GetLocationArticles1: {
                    limit?: number
location: string
searchQuery?: string | null
searchType?: app__api__v1__entities__routes__SearchType
skip?: number
                    
                };
GetEntityArticles1: {
                    entityName: string
limit?: number
skip?: number
                    
                };
GetLeaderInfo1: {
                    state: string
                    
                };
GetLegislationData1: {
                    state: string
                    
                };
GetEconData1: {
                    indicators?: Array<string>
state: string
                    
                };
GetEntityScoreOverTime1: {
                    entity: string
scoreType: string
timeframeFrom: string
timeframeTo: string
                    
                };
GetTopEntitiesByScore1: {
                    /**
 * Number of top entities to retrieve
 */
limit?: number
/**
 * Type of score to rank entities by
 */
scoreType: string
/**
 * Start date in ISO format
 */
timeframeFrom: string
/**
 * End date in ISO format
 */
timeframeTo: string
                    
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
GetLocationContents1: {
                    limit?: number
location: string
skip?: number
                    
                };
GetLocationEntitiesContents1: {
                    limit?: number
location: string
skip?: number
                    
                };
LocationFromQuery1: {
                    query: string
                    
                };
GeojsonEventsView1: {
                    eventType: string
                    
                };
GetLocationEntities1: {
                    limit?: number
locationName: string
minRelevance?: number
skip?: number
                    
                };
GetLeaderInfo1: {
                    state: string
                    
                };
GetLegislationData1: {
                    state: string
                    
                };
GetEconData1: {
                    indicators?: Array<string>
state: string
                    
                };
GetCoordinates1: {
                    language?: string
location: string
                    
                };
GetGeojsonForArticleIds1: {
                    requestBody: Array<string>
                    
                };
GetLocationMetadata1: {
                    location: string
                    
                };
ChannelRoute1: {
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
searchType?: app__api__v1__search__routes__SearchType
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
GetContents1: {
                    classificationScores?: string | null
entities?: Array<string> | null
excludeKeywords?: Array<string> | null
keyword?: string | null
keywordWeights?: string | null
limit?: number
locations?: Array<string> | null
newsCategory?: string | null
searchQuery?: string | null
searchType?: app__api__v1__search__routes__SearchType
secondaryCategories?: Array<string> | null
skip?: number
topics?: Array<string> | null
                    
                };
GetMostRelevantEntities1: {
                    requestBody: MostRelevantEntitiesRequest
                    
                };
SearchSynthesizer1: {
                    searchQuery: string
                    
                };
    }

export class AdminService {

	/**
	 * Get Registration Stats
	 * Get registration statistics and status.
 * Admin only.
	 * @returns RegistrationStats Successful Response
	 * @throws ApiError
	 */
	public static getRegistrationStats(): CancelablePromise<RegistrationStats> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/admin/registration/stats',
		});
	}

	/**
	 * Get Registration Stats
	 * Get registration statistics and status.
 * Admin only.
	 * @returns RegistrationStats Successful Response
	 * @throws ApiError
	 */
	public static getRegistrationStats1(): CancelablePromise<RegistrationStats> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/admin/registration/stats',
		});
	}

}

export class AnalysisAdaptersService {

	/**
	 * List Analysis Adapters
	 * List all active and available analysis adapters.
	 * @returns AnalysisAdapterRead Successful Response
	 * @throws ApiError
	 */
	public static listAnalysisAdapters(): CancelablePromise<Array<AnalysisAdapterRead>> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/analysis/analysis/adapters',
		});
	}

	/**
	 * Execute Analysis Adapter
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static executeAnalysisAdapter(data: AnalysisAdaptersData['ExecuteAnalysisAdapter']): CancelablePromise<Record<string, unknown>> {
		const {
adapterName,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/analysis/analysis/{adapter_name}/execute',
			path: {
				adapter_name: adapterName
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Analysis Adapters
	 * List all active and available analysis adapters.
	 * @returns AnalysisAdapterRead Successful Response
	 * @throws ApiError
	 */
	public static listAnalysisAdapters1(): CancelablePromise<Array<AnalysisAdapterRead>> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/analysis/analysis/adapters',
		});
	}

	/**
	 * Execute Analysis Adapter
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static executeAnalysisAdapter1(data: AnalysisAdaptersData['ExecuteAnalysisAdapter1']): CancelablePromise<Record<string, unknown>> {
		const {
adapterName,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/analysis/analysis/{adapter_name}/execute',
			path: {
				adapter_name: adapterName
			},
			body: requestBody,
			mediaType: 'application/json',
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

	/**
	 * Create Run
	 * Create a new Run.
	 * @returns AnnotationRunRead Successful Response
	 * @throws ApiError
	 */
	public static createRun2(data: AnnotationJobsData['CreateRun2']): CancelablePromise<AnnotationRunRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs/',
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
	public static listRuns2(data: AnnotationJobsData['ListRuns2']): CancelablePromise<AnnotationRunsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs/',
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
	public static createRun3(data: AnnotationJobsData['CreateRun3']): CancelablePromise<AnnotationRunRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs',
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
	public static listRuns3(data: AnnotationJobsData['ListRuns3']): CancelablePromise<AnnotationRunsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs',
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
	public static getRun1(data: AnnotationJobsData['GetRun1']): CancelablePromise<AnnotationRunRead> {
		const {
infospaceId,
runId,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}',
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
	public static updateRun1(data: AnnotationJobsData['UpdateRun1']): CancelablePromise<AnnotationRunRead> {
		const {
infospaceId,
runId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}',
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
	public static deleteRun1(data: AnnotationJobsData['DeleteRun1']): CancelablePromise<void> {
		const {
infospaceId,
runId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}',
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
	public static retryFailedAnnotations1(data: AnnotationJobsData['RetryFailedAnnotations1']): CancelablePromise<Message> {
		const {
infospaceId,
runId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}/retry_failures',
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
	public static createPackageFromRunEndpoint1(data: AnnotationJobsData['CreatePackageFromRunEndpoint1']): CancelablePromise<PackageRead> {
		const {
infospaceId,
runId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}/create_package',
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

	/**
	 * Create Run
	 * Create a new Run.
	 * @returns AnnotationRunRead Successful Response
	 * @throws ApiError
	 */
	public static createRun2(data: RunsData['CreateRun2']): CancelablePromise<AnnotationRunRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs/',
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
	public static listRuns2(data: RunsData['ListRuns2']): CancelablePromise<AnnotationRunsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs/',
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
	public static createRun3(data: RunsData['CreateRun3']): CancelablePromise<AnnotationRunRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs',
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
	public static listRuns3(data: RunsData['ListRuns3']): CancelablePromise<AnnotationRunsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs',
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
	public static getRun1(data: RunsData['GetRun1']): CancelablePromise<AnnotationRunRead> {
		const {
infospaceId,
runId,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}',
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
	public static updateRun1(data: RunsData['UpdateRun1']): CancelablePromise<AnnotationRunRead> {
		const {
infospaceId,
runId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}',
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
	public static deleteRun1(data: RunsData['DeleteRun1']): CancelablePromise<void> {
		const {
infospaceId,
runId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}',
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
	public static retryFailedAnnotations1(data: RunsData['RetryFailedAnnotations1']): CancelablePromise<Message> {
		const {
infospaceId,
runId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}/retry_failures',
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
	public static createPackageFromRunEndpoint1(data: RunsData['CreatePackageFromRunEndpoint1']): CancelablePromise<PackageRead> {
		const {
infospaceId,
runId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/annotation_jobs/infospaces/{infospace_id}/runs/{run_id}/create_package',
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
			url: '/api/v1/infospaces/{infospace_id}/annotation_schemas/',
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
includeArchived = false,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/infospaces/{infospace_id}/annotation_schemas/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, include_counts: includeCounts, include_archived: includeArchived
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
			url: '/api/v1/infospaces/{infospace_id}/annotation_schemas',
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
includeArchived = false,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/infospaces/{infospace_id}/annotation_schemas',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, include_counts: includeCounts, include_archived: includeArchived
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
			url: '/api/v1/infospaces/{infospace_id}/annotation_schemas/{schema_id}',
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
			url: '/api/v1/infospaces/{infospace_id}/annotation_schemas/{schema_id}',
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
	 * Archive an annotation schema by setting it to inactive (soft delete).
 * This is a non-destructive operation.
	 * @returns AnnotationSchemaRead Successful Response
	 * @throws ApiError
	 */
	public static deleteAnnotationSchema(data: AnnotationSchemasData['DeleteAnnotationSchema']): CancelablePromise<AnnotationSchemaRead> {
		const {
infospaceId,
schemaId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/infospaces/{infospace_id}/annotation_schemas/{schema_id}',
			path: {
				infospace_id: infospaceId, schema_id: schemaId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Restore Annotation Schema
	 * Restores an archived (soft-deleted) annotation schema.
	 * @returns AnnotationSchemaRead Successful Response
	 * @throws ApiError
	 */
	public static restoreAnnotationSchema(data: AnnotationSchemasData['RestoreAnnotationSchema']): CancelablePromise<AnnotationSchemaRead> {
		const {
infospaceId,
schemaId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/infospaces/{infospace_id}/annotation_schemas/{schema_id}/restore',
			path: {
				infospace_id: infospaceId, schema_id: schemaId
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
	public static createAnnotationSchema2(data: AnnotationSchemasData['CreateAnnotationSchema2']): CancelablePromise<AnnotationSchemaRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/annotation_schemas/',
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
	public static listAnnotationSchemas2(data: AnnotationSchemasData['ListAnnotationSchemas2']): CancelablePromise<AnnotationSchemasOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
includeArchived = false,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/annotation_schemas/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, include_counts: includeCounts, include_archived: includeArchived
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
	public static createAnnotationSchema3(data: AnnotationSchemasData['CreateAnnotationSchema3']): CancelablePromise<AnnotationSchemaRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/annotation_schemas',
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
	public static listAnnotationSchemas3(data: AnnotationSchemasData['ListAnnotationSchemas3']): CancelablePromise<AnnotationSchemasOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
includeArchived = false,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/annotation_schemas',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, include_counts: includeCounts, include_archived: includeArchived
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
	public static getAnnotationSchema1(data: AnnotationSchemasData['GetAnnotationSchema1']): CancelablePromise<AnnotationSchemaRead> {
		const {
infospaceId,
schemaId,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/annotation_schemas/{schema_id}',
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
	public static updateAnnotationSchema1(data: AnnotationSchemasData['UpdateAnnotationSchema1']): CancelablePromise<AnnotationSchemaRead> {
		const {
infospaceId,
schemaId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v2/infospaces/{infospace_id}/annotation_schemas/{schema_id}',
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
	 * Archive an annotation schema by setting it to inactive (soft delete).
 * This is a non-destructive operation.
	 * @returns AnnotationSchemaRead Successful Response
	 * @throws ApiError
	 */
	public static deleteAnnotationSchema1(data: AnnotationSchemasData['DeleteAnnotationSchema1']): CancelablePromise<AnnotationSchemaRead> {
		const {
infospaceId,
schemaId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/infospaces/{infospace_id}/annotation_schemas/{schema_id}',
			path: {
				infospace_id: infospaceId, schema_id: schemaId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Restore Annotation Schema
	 * Restores an archived (soft-deleted) annotation schema.
	 * @returns AnnotationSchemaRead Successful Response
	 * @throws ApiError
	 */
	public static restoreAnnotationSchema1(data: AnnotationSchemasData['RestoreAnnotationSchema1']): CancelablePromise<AnnotationSchemaRead> {
		const {
infospaceId,
schemaId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/annotation_schemas/{schema_id}/restore',
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
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/{annotation_id}/retry',
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
	 * Retry Single Annotation
	 * Retries a single failed annotation synchronously.
	 * @returns AnnotationRead Successful Response
	 * @throws ApiError
	 */
	public static retrySingleAnnotation1(data: AnnotationsData['RetrySingleAnnotation1']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
annotationId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/annotations/infospaces/{infospace_id}/annotations/{annotation_id}/retry',
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
	 * Create Annotation
	 * Create a new annotation.
	 * @returns AnnotationRead Successful Response
	 * @throws ApiError
	 */
	public static createAnnotation4(data: AnnotationsData['CreateAnnotation4']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations/',
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
	public static createAnnotation5(data: AnnotationsData['CreateAnnotation5']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations/',
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
	public static listAnnotations4(data: AnnotationsData['ListAnnotations4']): CancelablePromise<AnnotationsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
sourceId,
schemaId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations/',
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
	public static listAnnotations5(data: AnnotationsData['ListAnnotations5']): CancelablePromise<AnnotationsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
sourceId,
schemaId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations/',
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
	public static createAnnotation6(data: AnnotationsData['CreateAnnotation6']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations',
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
	public static createAnnotation7(data: AnnotationsData['CreateAnnotation7']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations',
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
	public static listAnnotations6(data: AnnotationsData['ListAnnotations6']): CancelablePromise<AnnotationsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
sourceId,
schemaId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations',
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
	public static listAnnotations7(data: AnnotationsData['ListAnnotations7']): CancelablePromise<AnnotationsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
sourceId,
schemaId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations',
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
	public static getAnnotation2(data: AnnotationsData['GetAnnotation2']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
annotationId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations/{annotation_id}',
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
	public static getAnnotation3(data: AnnotationsData['GetAnnotation3']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
annotationId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations/{annotation_id}',
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
	public static updateAnnotation2(data: AnnotationsData['UpdateAnnotation2']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
annotationId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations/{annotation_id}',
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
	public static updateAnnotation3(data: AnnotationsData['UpdateAnnotation3']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
annotationId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations/{annotation_id}',
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
	public static deleteAnnotation2(data: AnnotationsData['DeleteAnnotation2']): CancelablePromise<void> {
		const {
infospaceId,
annotationId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations/{annotation_id}',
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
	public static deleteAnnotation3(data: AnnotationsData['DeleteAnnotation3']): CancelablePromise<void> {
		const {
infospaceId,
annotationId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations/{annotation_id}',
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
	public static createBatchAnnotations2(data: AnnotationsData['CreateBatchAnnotations2']): CancelablePromise<Message> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations/batch',
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
	public static createBatchAnnotations3(data: AnnotationsData['CreateBatchAnnotations3']): CancelablePromise<Message> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations/batch',
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
	public static getRunResults2(data: AnnotationsData['GetRunResults2']): CancelablePromise<Array<AnnotationRead>> {
		const {
infospaceId,
runId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations/run/{run_id}/results',
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
	public static getRunResults3(data: AnnotationsData['GetRunResults3']): CancelablePromise<Array<AnnotationRead>> {
		const {
infospaceId,
runId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations/run/{run_id}/results',
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
	public static retrySingleAnnotation2(data: AnnotationsData['RetrySingleAnnotation2']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
annotationId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations/{annotation_id}/retry',
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
	 * Retry Single Annotation
	 * Retries a single failed annotation synchronously.
	 * @returns AnnotationRead Successful Response
	 * @throws ApiError
	 */
	public static retrySingleAnnotation3(data: AnnotationsData['RetrySingleAnnotation3']): CancelablePromise<AnnotationRead> {
		const {
infospaceId,
annotationId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/annotations/infospaces/{infospace_id}/annotations/{annotation_id}/retry',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/',
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
			url: '/api/v1/infospaces/{infospace_id}/assets',
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
			url: '/api/v1/infospaces/{infospace_id}/assets',
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
			url: '/api/v1/infospaces/{infospace_id}/assets',
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
			url: '/api/v1/infospaces/{infospace_id}/assets',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/upload',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/upload',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/ingest-url',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/ingest-url',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/ingest-text',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/ingest-text',
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
	 * Compose Article
	 * Compose a free-form article with embedded assets and bundle references.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static composeArticle(data: AssetsData['ComposeArticle']): CancelablePromise<AssetRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/infospaces/{infospace_id}/assets/compose-article',
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
	 * Compose Article
	 * Compose a free-form article with embedded assets and bundle references.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static composeArticle1(data: AssetsData['ComposeArticle1']): CancelablePromise<AssetRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/infospaces/{infospace_id}/assets/compose-article',
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
	public static bulkIngestUrls(data: AssetsData['BulkIngestUrls']): CancelablePromise<Array<AssetRead>> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/infospaces/{infospace_id}/assets/bulk-ingest-urls',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/bulk-ingest-urls',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/{asset_id}/reprocess',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/{asset_id}/reprocess',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/{asset_id}',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/{asset_id}',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/{asset_id}',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/{asset_id}',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/{asset_id}',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/{asset_id}',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/{asset_id}/children',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/{asset_id}/children',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/supported-types',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/supported-types',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/bulk-upload-background',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/bulk-upload-background',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/bulk-urls-background',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/bulk-urls-background',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/bundles/{bundle_id}/add-files-background',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/bundles/{bundle_id}/add-files-background',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/tasks/{task_id}/status',
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
			url: '/api/v1/infospaces/{infospace_id}/assets/tasks/{task_id}/status',
			path: {
				task_id: taskId
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
	public static createAsset4(data: AssetsData['CreateAsset4']): CancelablePromise<AssetRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/',
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
	public static createAsset5(data: AssetsData['CreateAsset5']): CancelablePromise<AssetRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/',
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
	public static listAssets4(data: AssetsData['ListAssets4']): CancelablePromise<AssetsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
parentAssetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/assets/',
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
	public static listAssets5(data: AssetsData['ListAssets5']): CancelablePromise<AssetsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
parentAssetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/assets/',
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
	public static createAsset6(data: AssetsData['CreateAsset6']): CancelablePromise<AssetRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets',
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
	public static createAsset7(data: AssetsData['CreateAsset7']): CancelablePromise<AssetRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets',
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
	public static listAssets6(data: AssetsData['ListAssets6']): CancelablePromise<AssetsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
parentAssetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/assets',
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
	public static listAssets7(data: AssetsData['ListAssets7']): CancelablePromise<AssetsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
parentAssetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/assets',
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
	public static uploadFile2(data: AssetsData['UploadFile2']): CancelablePromise<AssetRead> {
		const {
infospaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/upload',
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
	public static uploadFile3(data: AssetsData['UploadFile3']): CancelablePromise<AssetRead> {
		const {
infospaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/upload',
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
	public static ingestUrl2(data: AssetsData['IngestUrl2']): CancelablePromise<AssetRead> {
		const {
infospaceId,
url,
title,
scrapeImmediately = true,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/ingest-url',
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
	public static ingestUrl3(data: AssetsData['IngestUrl3']): CancelablePromise<AssetRead> {
		const {
infospaceId,
url,
title,
scrapeImmediately = true,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/ingest-url',
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
	public static ingestText2(data: AssetsData['IngestText2']): CancelablePromise<AssetRead> {
		const {
infospaceId,
textContent,
title,
eventTimestamp,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/ingest-text',
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
	public static ingestText3(data: AssetsData['IngestText3']): CancelablePromise<AssetRead> {
		const {
infospaceId,
textContent,
title,
eventTimestamp,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/ingest-text',
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
	 * Compose Article
	 * Compose a free-form article with embedded assets and bundle references.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static composeArticle2(data: AssetsData['ComposeArticle2']): CancelablePromise<AssetRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/compose-article',
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
	 * Compose Article
	 * Compose a free-form article with embedded assets and bundle references.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static composeArticle3(data: AssetsData['ComposeArticle3']): CancelablePromise<AssetRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/compose-article',
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
	public static bulkIngestUrls2(data: AssetsData['BulkIngestUrls2']): CancelablePromise<Array<AssetRead>> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/bulk-ingest-urls',
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
	public static bulkIngestUrls3(data: AssetsData['BulkIngestUrls3']): CancelablePromise<Array<AssetRead>> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/bulk-ingest-urls',
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
	public static reprocessAsset2(data: AssetsData['ReprocessAsset2']): CancelablePromise<Message> {
		const {
infospaceId,
assetId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/{asset_id}/reprocess',
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
	public static reprocessAsset3(data: AssetsData['ReprocessAsset3']): CancelablePromise<Message> {
		const {
infospaceId,
assetId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/{asset_id}/reprocess',
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
	public static getAsset2(data: AssetsData['GetAsset2']): CancelablePromise<AssetRead> {
		const {
infospaceId,
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/assets/{asset_id}',
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
	public static getAsset3(data: AssetsData['GetAsset3']): CancelablePromise<AssetRead> {
		const {
infospaceId,
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/assets/{asset_id}',
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
	public static updateAsset2(data: AssetsData['UpdateAsset2']): CancelablePromise<AssetRead> {
		const {
infospaceId,
assetId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v2/infospaces/{infospace_id}/assets/{asset_id}',
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
	public static updateAsset3(data: AssetsData['UpdateAsset3']): CancelablePromise<AssetRead> {
		const {
infospaceId,
assetId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v2/infospaces/{infospace_id}/assets/{asset_id}',
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
	public static deleteAsset2(data: AssetsData['DeleteAsset2']): CancelablePromise<Message> {
		const {
infospaceId,
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/infospaces/{infospace_id}/assets/{asset_id}',
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
	public static deleteAsset3(data: AssetsData['DeleteAsset3']): CancelablePromise<Message> {
		const {
infospaceId,
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/infospaces/{infospace_id}/assets/{asset_id}',
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
	public static getAssetChildren2(data: AssetsData['GetAssetChildren2']): CancelablePromise<Array<AssetRead>> {
		const {
infospaceId,
assetId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/assets/{asset_id}/children',
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
	public static getAssetChildren3(data: AssetsData['GetAssetChildren3']): CancelablePromise<Array<AssetRead>> {
		const {
infospaceId,
assetId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/assets/{asset_id}/children',
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
	public static getSupportedContentTypes2(): CancelablePromise<Record<string, Array<string>>> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/assets/supported-types',
		});
	}

	/**
	 * Get Supported Content Types
	 * Get list of supported content types.
	 * @returns string Successful Response
	 * @throws ApiError
	 */
	public static getSupportedContentTypes3(): CancelablePromise<Record<string, Array<string>>> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/assets/supported-types',
		});
	}

	/**
	 * Create Assets Background Bulk
	 * Upload multiple files as individual assets using background processing.
 * Returns task IDs for progress tracking.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static createAssetsBackgroundBulk2(data: AssetsData['CreateAssetsBackgroundBulk2']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/bulk-upload-background',
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
	public static createAssetsBackgroundBulk3(data: AssetsData['CreateAssetsBackgroundBulk3']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/bulk-upload-background',
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
	public static createAssetsBackgroundUrls2(data: AssetsData['CreateAssetsBackgroundUrls2']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/bulk-urls-background',
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
	public static createAssetsBackgroundUrls3(data: AssetsData['CreateAssetsBackgroundUrls3']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/bulk-urls-background',
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
	public static addFilesToBundleBackground2(data: AssetsData['AddFilesToBundleBackground2']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
bundleId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/bundles/{bundle_id}/add-files-background',
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
	public static addFilesToBundleBackground3(data: AssetsData['AddFilesToBundleBackground3']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
bundleId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/assets/bundles/{bundle_id}/add-files-background',
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
	public static getTaskStatus2(data: AssetsData['GetTaskStatus2']): CancelablePromise<Record<string, unknown>> {
		const {
taskId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/assets/tasks/{task_id}/status',
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
	public static getTaskStatus3(data: AssetsData['GetTaskStatus3']): CancelablePromise<Record<string, unknown>> {
		const {
taskId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/assets/tasks/{task_id}/status',
			path: {
				task_id: taskId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class BackupsService {

	/**
	 * Create Backup
	 * Create a new backup of an infospace.
	 * @returns InfospaceBackupRead Successful Response
	 * @throws ApiError
	 */
	public static createBackup(data: BackupsData['CreateBackup']): CancelablePromise<InfospaceBackupRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/infospaces/{infospace_id}/backups',
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
	 * List Backups
	 * List backups for an infospace.
	 * @returns InfospaceBackupsOut Successful Response
	 * @throws ApiError
	 */
	public static listBackups(data: BackupsData['ListBackups']): CancelablePromise<InfospaceBackupsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/infospaces/{infospace_id}/backups',
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
	 * List All User Backups
	 * List all backups for a user across all infospaces.
	 * @returns InfospaceBackupsOut Successful Response
	 * @throws ApiError
	 */
	public static listAllUserBackups(data: BackupsData['ListAllUserBackups'] = {}): CancelablePromise<InfospaceBackupsOut> {
		const {
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/backups',
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Backup
	 * Get a specific backup by ID.
	 * @returns InfospaceBackupRead Successful Response
	 * @throws ApiError
	 */
	public static getBackup(data: BackupsData['GetBackup']): CancelablePromise<InfospaceBackupRead> {
		const {
backupId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/backups/{backup_id}',
			path: {
				backup_id: backupId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Backup
	 * Update backup metadata.
	 * @returns InfospaceBackupRead Successful Response
	 * @throws ApiError
	 */
	public static updateBackup(data: BackupsData['UpdateBackup']): CancelablePromise<InfospaceBackupRead> {
		const {
backupId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v1/backups/{backup_id}',
			path: {
				backup_id: backupId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Backup
	 * Delete a backup and its associated file.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static deleteBackup(data: BackupsData['DeleteBackup']): CancelablePromise<Message> {
		const {
backupId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/backups/{backup_id}',
			path: {
				backup_id: backupId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Restore Backup
	 * Restore an infospace from a backup.
	 * @returns InfospaceRead Successful Response
	 * @throws ApiError
	 */
	public static restoreBackup(data: BackupsData['RestoreBackup']): CancelablePromise<InfospaceRead> {
		const {
backupId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/backups/{backup_id}/restore',
			path: {
				backup_id: backupId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Backup Share Link
	 * Create a shareable link for a backup.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static createBackupShareLink(data: BackupsData['CreateBackupShareLink']): CancelablePromise<Record<string, unknown>> {
		const {
backupId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/backups/{backup_id}/share',
			path: {
				backup_id: backupId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Download Shared Backup
	 * Download a backup using a share token.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static downloadSharedBackup(data: BackupsData['DownloadSharedBackup']): CancelablePromise<unknown> {
		const {
shareToken,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/backups/download/{share_token}',
			path: {
				share_token: shareToken
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Cleanup Expired Backups
	 * Manually trigger cleanup of expired backups (admin function).
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static cleanupExpiredBackups(): CancelablePromise<Message> {
				return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/backups/cleanup',
		});
	}

	/**
	 * Get Infospaces Backup Overview
	 * Admin endpoint: Get overview of all infospaces with backup status.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getInfospacesBackupOverview(data: BackupsData['GetInfospacesBackupOverview'] = {}): CancelablePromise<Record<string, unknown>> {
		const {
limit = 100,
skip = 0,
search,
userId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/backups/admin/infospaces-overview',
			query: {
				limit, skip, search, user_id: userId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Trigger Backup All Infospaces
	 * Admin endpoint: Trigger backup creation for all infospaces.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static triggerBackupAllInfospaces(data: BackupsData['TriggerBackupAllInfospaces'] = {}): CancelablePromise<Message> {
		const {
backupType = 'manual',
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/backups/admin/backup-all',
			query: {
				backup_type: backupType
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Trigger Backup Specific Infospaces
	 * Admin endpoint: Trigger backup creation for specific infospaces.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static triggerBackupSpecificInfospaces(data: BackupsData['TriggerBackupSpecificInfospaces']): CancelablePromise<Message> {
		const {
requestBody,
backupType = 'manual',
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/backups/admin/backup-specific',
			query: {
				backup_type: backupType
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Backup
	 * Create a new backup of an infospace.
	 * @returns InfospaceBackupRead Successful Response
	 * @throws ApiError
	 */
	public static createBackup1(data: BackupsData['CreateBackup1']): CancelablePromise<InfospaceBackupRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/backups',
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
	 * List Backups
	 * List backups for an infospace.
	 * @returns InfospaceBackupsOut Successful Response
	 * @throws ApiError
	 */
	public static listBackups1(data: BackupsData['ListBackups1']): CancelablePromise<InfospaceBackupsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/backups',
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
	 * List All User Backups
	 * List all backups for a user across all infospaces.
	 * @returns InfospaceBackupsOut Successful Response
	 * @throws ApiError
	 */
	public static listAllUserBackups1(data: BackupsData['ListAllUserBackups1'] = {}): CancelablePromise<InfospaceBackupsOut> {
		const {
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/backups',
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Backup
	 * Get a specific backup by ID.
	 * @returns InfospaceBackupRead Successful Response
	 * @throws ApiError
	 */
	public static getBackup1(data: BackupsData['GetBackup1']): CancelablePromise<InfospaceBackupRead> {
		const {
backupId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/backups/{backup_id}',
			path: {
				backup_id: backupId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Backup
	 * Update backup metadata.
	 * @returns InfospaceBackupRead Successful Response
	 * @throws ApiError
	 */
	public static updateBackup1(data: BackupsData['UpdateBackup1']): CancelablePromise<InfospaceBackupRead> {
		const {
backupId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v2/backups/{backup_id}',
			path: {
				backup_id: backupId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Backup
	 * Delete a backup and its associated file.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static deleteBackup1(data: BackupsData['DeleteBackup1']): CancelablePromise<Message> {
		const {
backupId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/backups/{backup_id}',
			path: {
				backup_id: backupId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Restore Backup
	 * Restore an infospace from a backup.
	 * @returns InfospaceRead Successful Response
	 * @throws ApiError
	 */
	public static restoreBackup1(data: BackupsData['RestoreBackup1']): CancelablePromise<InfospaceRead> {
		const {
backupId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/backups/{backup_id}/restore',
			path: {
				backup_id: backupId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Backup Share Link
	 * Create a shareable link for a backup.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static createBackupShareLink1(data: BackupsData['CreateBackupShareLink1']): CancelablePromise<Record<string, unknown>> {
		const {
backupId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/backups/{backup_id}/share',
			path: {
				backup_id: backupId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Download Shared Backup
	 * Download a backup using a share token.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static downloadSharedBackup1(data: BackupsData['DownloadSharedBackup1']): CancelablePromise<unknown> {
		const {
shareToken,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/backups/download/{share_token}',
			path: {
				share_token: shareToken
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Cleanup Expired Backups
	 * Manually trigger cleanup of expired backups (admin function).
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static cleanupExpiredBackups1(): CancelablePromise<Message> {
				return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/backups/cleanup',
		});
	}

	/**
	 * Get Infospaces Backup Overview
	 * Admin endpoint: Get overview of all infospaces with backup status.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getInfospacesBackupOverview1(data: BackupsData['GetInfospacesBackupOverview1'] = {}): CancelablePromise<Record<string, unknown>> {
		const {
limit = 100,
skip = 0,
search,
userId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/backups/admin/infospaces-overview',
			query: {
				limit, skip, search, user_id: userId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Trigger Backup All Infospaces
	 * Admin endpoint: Trigger backup creation for all infospaces.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static triggerBackupAllInfospaces1(data: BackupsData['TriggerBackupAllInfospaces1'] = {}): CancelablePromise<Message> {
		const {
backupType = 'manual',
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/backups/admin/backup-all',
			query: {
				backup_type: backupType
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Trigger Backup Specific Infospaces
	 * Admin endpoint: Trigger backup creation for specific infospaces.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static triggerBackupSpecificInfospaces1(data: BackupsData['TriggerBackupSpecificInfospaces1']): CancelablePromise<Message> {
		const {
requestBody,
backupType = 'manual',
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/backups/admin/backup-specific',
			query: {
				backup_type: backupType
			},
			body: requestBody,
			mediaType: 'application/json',
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
	 * Get all assets within a specific bundle.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static getAssetsInBundle(data: BundlesData['GetAssetsInBundle']): CancelablePromise<Array<AssetRead>> {
		const {
bundleId,
infospaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/bundles/infospaces/{infospace_id}/bundles/{bundle_id}/assets',
			path: {
				bundle_id: bundleId, infospace_id: infospaceId
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

	/**
	 * Create Bundle
	 * Create a new bundle in an infospace.
	 * @returns BundleRead Successful Response
	 * @throws ApiError
	 */
	public static createBundle1(data: BundlesData['CreateBundle1']): CancelablePromise<BundleRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/bundles/infospaces/{infospace_id}/bundles',
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
	public static getBundles1(data: BundlesData['GetBundles1']): CancelablePromise<Array<BundleRead>> {
		const {
infospaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/bundles/infospaces/{infospace_id}/bundles',
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
	public static getBundle1(data: BundlesData['GetBundle1']): CancelablePromise<BundleRead> {
		const {
bundleId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/bundles/bundles/{bundle_id}',
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
	public static updateBundle1(data: BundlesData['UpdateBundle1']): CancelablePromise<BundleRead> {
		const {
bundleId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v2/bundles/bundles/{bundle_id}',
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
	public static deleteBundle1(data: BundlesData['DeleteBundle1']): CancelablePromise<void> {
		const {
bundleId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/bundles/bundles/{bundle_id}',
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
	public static addAssetToBundle1(data: BundlesData['AddAssetToBundle1']): CancelablePromise<BundleRead> {
		const {
bundleId,
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/bundles/bundles/{bundle_id}/assets/{asset_id}',
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
	public static removeAssetFromBundle1(data: BundlesData['RemoveAssetFromBundle1']): CancelablePromise<BundleRead> {
		const {
bundleId,
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/bundles/bundles/{bundle_id}/assets/{asset_id}',
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
	 * Get all assets within a specific bundle.
	 * @returns AssetRead Successful Response
	 * @throws ApiError
	 */
	public static getAssetsInBundle1(data: BundlesData['GetAssetsInBundle1']): CancelablePromise<Array<AssetRead>> {
		const {
bundleId,
infospaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/bundles/infospaces/{infospace_id}/bundles/{bundle_id}/assets',
			path: {
				bundle_id: bundleId, infospace_id: infospaceId
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
	public static getAsset1(data: BundlesData['GetAsset1']): CancelablePromise<AssetRead> {
		const {
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/bundles/assets/{asset_id}',
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
	public static transferBundle1(data: BundlesData['TransferBundle1']): CancelablePromise<BundleRead> {
		const {
bundleId,
targetInfospaceId,
copy = true,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/bundles/bundles/{bundle_id}/transfer',
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

export class IntelligenceChatService {

	/**
	 * Intelligence Chat
	 * Intelligence analysis chat with tool orchestration.
 * 
 * The AI model can search, analyze, and interact with your intelligence data.
 * Example conversation:
 * - User: "What are the main themes in recent political documents?"
 * - AI: *calls search_assets tool* → *analyzes results* → Responds with findings
	 * @returns ChatResponse Successful Response
	 * @throws ApiError
	 */
	public static intelligenceChat(data: IntelligenceChatData['IntelligenceChat']): CancelablePromise<ChatResponse> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/chat/chat',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Execute Tool Call
	 * Execute a tool call made by an AI model.
 * 
 * This endpoint is used when the AI model wants to interact with the intelligence platform
 * through function calls (search assets, get annotations, etc.).
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static executeToolCall(data: IntelligenceChatData['ExecuteToolCall']): CancelablePromise<unknown> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/chat/tools/execute',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Available Models
	 * Discover available language models across all providers.
 * 
 * Query parameters:
 * - capability: Filter by capability ('tools', 'streaming', 'thinking', 'multimodal', etc.)
 * 
 * Returns all available models from OpenAI, Ollama, Gemini, etc.
	 * @returns ModelListResponse Successful Response
	 * @throws ApiError
	 */
	public static listAvailableModels(data: IntelligenceChatData['ListAvailableModels'] = {}): CancelablePromise<ModelListResponse> {
		const {
capability,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/chat/models',
			query: {
				capability
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Universal Tools
	 * List universal intelligence analysis tool definitions.
 * 
 * These are the capabilities available to AI models. No authentication required
 * as this only returns tool schemas, not data access.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static listUniversalTools(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/chat/tools',
		});
	}

	/**
	 * Get Infospace Tool Context
	 * Get infospace-specific context for tools (what's actually available).
 * 
 * This provides real data about available asset types, schemas, bundles, etc.
 * to help AI models make better tool usage decisions.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getInfospaceToolContext(data: IntelligenceChatData['GetInfospaceToolContext']): CancelablePromise<unknown> {
		const {
infospaceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/chat/tools/context/{infospace_id}',
			path: {
				infospace_id: infospaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Intelligence Chat
	 * Intelligence analysis chat with tool orchestration.
 * 
 * The AI model can search, analyze, and interact with your intelligence data.
 * Example conversation:
 * - User: "What are the main themes in recent political documents?"
 * - AI: *calls search_assets tool* → *analyzes results* → Responds with findings
	 * @returns ChatResponse Successful Response
	 * @throws ApiError
	 */
	public static intelligenceChat1(data: IntelligenceChatData['IntelligenceChat1']): CancelablePromise<ChatResponse> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/chat/chat',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Execute Tool Call
	 * Execute a tool call made by an AI model.
 * 
 * This endpoint is used when the AI model wants to interact with the intelligence platform
 * through function calls (search assets, get annotations, etc.).
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static executeToolCall1(data: IntelligenceChatData['ExecuteToolCall1']): CancelablePromise<unknown> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/chat/tools/execute',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Available Models
	 * Discover available language models across all providers.
 * 
 * Query parameters:
 * - capability: Filter by capability ('tools', 'streaming', 'thinking', 'multimodal', etc.)
 * 
 * Returns all available models from OpenAI, Ollama, Gemini, etc.
	 * @returns ModelListResponse Successful Response
	 * @throws ApiError
	 */
	public static listAvailableModels1(data: IntelligenceChatData['ListAvailableModels1'] = {}): CancelablePromise<ModelListResponse> {
		const {
capability,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/chat/models',
			query: {
				capability
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Universal Tools
	 * List universal intelligence analysis tool definitions.
 * 
 * These are the capabilities available to AI models. No authentication required
 * as this only returns tool schemas, not data access.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static listUniversalTools1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/chat/tools',
		});
	}

	/**
	 * Get Infospace Tool Context
	 * Get infospace-specific context for tools (what's actually available).
 * 
 * This provides real data about available asset types, schemas, bundles, etc.
 * to help AI models make better tool usage decisions.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getInfospaceToolContext1(data: IntelligenceChatData['GetInfospaceToolContext1']): CancelablePromise<unknown> {
		const {
infospaceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/chat/tools/context/{infospace_id}',
			path: {
				infospace_id: infospaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class ChunkingService {

	/**
	 * Chunk Single Asset
	 * Chunk a single asset into text chunks.
	 * @returns ChunkingResultResponse Successful Response
	 * @throws ApiError
	 */
	public static chunkSingleAsset(data: ChunkingData['ChunkSingleAsset']): CancelablePromise<ChunkingResultResponse> {
		const {
assetId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/chunking/assets/{asset_id}/chunk',
			path: {
				asset_id: assetId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Chunk Multiple Assets
	 * Chunk multiple assets based on filters.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static chunkMultipleAssets(data: ChunkingData['ChunkMultipleAssets']): CancelablePromise<Record<string, unknown>> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/chunking/assets/chunk-batch',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Asset Chunks
	 * Get all chunks for a specific asset.
	 * @returns AssetChunkRead Successful Response
	 * @throws ApiError
	 */
	public static getAssetChunks(data: ChunkingData['GetAssetChunks']): CancelablePromise<Array<AssetChunkRead>> {
		const {
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/chunking/assets/{asset_id}/chunks',
			path: {
				asset_id: assetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Remove Asset Chunks
	 * Remove all chunks for an asset.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static removeAssetChunks(data: ChunkingData['RemoveAssetChunks']): CancelablePromise<unknown> {
		const {
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/chunking/assets/{asset_id}/chunks',
			path: {
				asset_id: assetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Chunking Statistics
	 * Get chunking statistics.
	 * @returns ChunkingStatsResponse Successful Response
	 * @throws ApiError
	 */
	public static getChunkingStatistics(data: ChunkingData['GetChunkingStatistics'] = {}): CancelablePromise<ChunkingStatsResponse> {
		const {
assetId,
infospaceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/chunking/stats',
			query: {
				asset_id: assetId, infospace_id: infospaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Chunk Single Asset
	 * Chunk a single asset into text chunks.
	 * @returns ChunkingResultResponse Successful Response
	 * @throws ApiError
	 */
	public static chunkSingleAsset1(data: ChunkingData['ChunkSingleAsset1']): CancelablePromise<ChunkingResultResponse> {
		const {
assetId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/chunking/assets/{asset_id}/chunk',
			path: {
				asset_id: assetId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Chunk Multiple Assets
	 * Chunk multiple assets based on filters.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static chunkMultipleAssets1(data: ChunkingData['ChunkMultipleAssets1']): CancelablePromise<Record<string, unknown>> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/chunking/assets/chunk-batch',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Asset Chunks
	 * Get all chunks for a specific asset.
	 * @returns AssetChunkRead Successful Response
	 * @throws ApiError
	 */
	public static getAssetChunks1(data: ChunkingData['GetAssetChunks1']): CancelablePromise<Array<AssetChunkRead>> {
		const {
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/chunking/assets/{asset_id}/chunks',
			path: {
				asset_id: assetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Remove Asset Chunks
	 * Remove all chunks for an asset.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static removeAssetChunks1(data: ChunkingData['RemoveAssetChunks1']): CancelablePromise<unknown> {
		const {
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/chunking/assets/{asset_id}/chunks',
			path: {
				asset_id: assetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Chunking Statistics
	 * Get chunking statistics.
	 * @returns ChunkingStatsResponse Successful Response
	 * @throws ApiError
	 */
	public static getChunkingStatistics1(data: ChunkingData['GetChunkingStatistics1'] = {}): CancelablePromise<ChunkingStatsResponse> {
		const {
assetId,
infospaceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/chunking/stats',
			query: {
				asset_id: assetId, infospace_id: infospaceId
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

	/**
	 * Create Dataset
	 * Create a new dataset within a specific infospace.
	 * @returns DatasetRead Successful Response
	 * @throws ApiError
	 */
	public static createDataset2(data: DatasetsData['CreateDataset2']): CancelablePromise<DatasetRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/datasets/',
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
	public static listDatasets2(data: DatasetsData['ListDatasets2']): CancelablePromise<DatasetsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/datasets/',
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
	public static createDataset3(data: DatasetsData['CreateDataset3']): CancelablePromise<DatasetRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/datasets',
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
	public static listDatasets3(data: DatasetsData['ListDatasets3']): CancelablePromise<DatasetsOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/datasets',
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
	public static getDataset1(data: DatasetsData['GetDataset1']): CancelablePromise<DatasetRead> {
		const {
infospaceId,
datasetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/datasets/{dataset_id}',
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
	public static updateDataset1(data: DatasetsData['UpdateDataset1']): CancelablePromise<DatasetRead> {
		const {
infospaceId,
datasetId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v2/infospaces/{infospace_id}/datasets/{dataset_id}',
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
	public static deleteDataset1(data: DatasetsData['DeleteDataset1']): CancelablePromise<Message> {
		const {
infospaceId,
datasetId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/infospaces/{infospace_id}/datasets/{dataset_id}',
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
	public static exportDataset1(data: DatasetsData['ExportDataset1']): CancelablePromise<any> {
		const {
infospaceId,
datasetId,
includeContent = false,
includeResults = false,
includeSourceFiles = true,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/datasets/{dataset_id}/export',
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
	public static importDataset1(data: DatasetsData['ImportDataset1']): CancelablePromise<DatasetRead> {
		const {
infospaceId,
formData,
conflictStrategy = 'skip',
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/datasets/import',
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
	public static importDatasetFromToken1(data: DatasetsData['ImportDatasetFromToken1']): CancelablePromise<DatasetRead> {
		const {
infospaceId,
shareToken,
includeContent = false,
includeResults = false,
conflictStrategy = 'skip',
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/datasets/import_from_token',
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

export class EmbeddingsService {

	/**
	 * List Embedding Models
	 * List all available embedding models.
	 * @returns EmbeddingModelRead Successful Response
	 * @throws ApiError
	 */
	public static listEmbeddingModels(data: EmbeddingsData['ListEmbeddingModels'] = {}): CancelablePromise<Array<EmbeddingModelRead>> {
		const {
activeOnly = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/embeddings/models',
			query: {
				active_only: activeOnly
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Embedding Model
	 * Create a new embedding model.
	 * @returns EmbeddingModelRead Successful Response
	 * @throws ApiError
	 */
	public static createEmbeddingModel(data: EmbeddingsData['CreateEmbeddingModel']): CancelablePromise<EmbeddingModelRead> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/embeddings/models',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Available Models
	 * Get available models from the current embedding provider.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getAvailableModels(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/embeddings/models/available',
		});
	}

	/**
	 * Get Embedding Model Stats
	 * Get statistics for an embedding model.
	 * @returns EmbeddingStatsResponse Successful Response
	 * @throws ApiError
	 */
	public static getEmbeddingModelStats(data: EmbeddingsData['GetEmbeddingModelStats']): CancelablePromise<EmbeddingStatsResponse> {
		const {
modelId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/embeddings/models/{model_id}/stats',
			path: {
				model_id: modelId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Generate Embeddings
	 * Generate embeddings for a list of asset chunks.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static generateEmbeddings(data: EmbeddingsData['GenerateEmbeddings']): CancelablePromise<unknown> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/embeddings/generate',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Similarity Search
	 * Perform similarity search using embeddings.
	 * @returns EmbeddingSearchResponse Successful Response
	 * @throws ApiError
	 */
	public static similaritySearch(data: EmbeddingsData['SimilaritySearch']): CancelablePromise<EmbeddingSearchResponse> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/embeddings/search',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Embed Text
	 * Generate embedding for a single text (utility endpoint).
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static embedText(data: EmbeddingsData['EmbedText']): CancelablePromise<unknown> {
		const {
text,
modelName,
provider,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/embeddings/embed-text',
			query: {
				text, model_name: modelName, provider
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Deactivate Embedding Model
	 * Deactivate an embedding model (soft delete).
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deactivateEmbeddingModel(data: EmbeddingsData['DeactivateEmbeddingModel']): CancelablePromise<unknown> {
		const {
modelId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/embeddings/models/{model_id}',
			path: {
				model_id: modelId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Embedding Models
	 * List all available embedding models.
	 * @returns EmbeddingModelRead Successful Response
	 * @throws ApiError
	 */
	public static listEmbeddingModels1(data: EmbeddingsData['ListEmbeddingModels1'] = {}): CancelablePromise<Array<EmbeddingModelRead>> {
		const {
activeOnly = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/embeddings/models',
			query: {
				active_only: activeOnly
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Embedding Model
	 * Create a new embedding model.
	 * @returns EmbeddingModelRead Successful Response
	 * @throws ApiError
	 */
	public static createEmbeddingModel1(data: EmbeddingsData['CreateEmbeddingModel1']): CancelablePromise<EmbeddingModelRead> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/embeddings/models',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Available Models
	 * Get available models from the current embedding provider.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getAvailableModels1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/embeddings/models/available',
		});
	}

	/**
	 * Get Embedding Model Stats
	 * Get statistics for an embedding model.
	 * @returns EmbeddingStatsResponse Successful Response
	 * @throws ApiError
	 */
	public static getEmbeddingModelStats1(data: EmbeddingsData['GetEmbeddingModelStats1']): CancelablePromise<EmbeddingStatsResponse> {
		const {
modelId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/embeddings/models/{model_id}/stats',
			path: {
				model_id: modelId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Generate Embeddings
	 * Generate embeddings for a list of asset chunks.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static generateEmbeddings1(data: EmbeddingsData['GenerateEmbeddings1']): CancelablePromise<unknown> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/embeddings/generate',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Similarity Search
	 * Perform similarity search using embeddings.
	 * @returns EmbeddingSearchResponse Successful Response
	 * @throws ApiError
	 */
	public static similaritySearch1(data: EmbeddingsData['SimilaritySearch1']): CancelablePromise<EmbeddingSearchResponse> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/embeddings/search',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Embed Text
	 * Generate embedding for a single text (utility endpoint).
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static embedText1(data: EmbeddingsData['EmbedText1']): CancelablePromise<unknown> {
		const {
text,
modelName,
provider,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/embeddings/embed-text',
			query: {
				text, model_name: modelName, provider
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Deactivate Embedding Model
	 * Deactivate an embedding model (soft delete).
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deactivateEmbeddingModel1(data: EmbeddingsData['DeactivateEmbeddingModel1']): CancelablePromise<unknown> {
		const {
modelId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/embeddings/models/{model_id}',
			path: {
				model_id: modelId
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

	/**
	 * File Upload
	 * Upload a file to the configured storage provider.
 * Expects form-data with a file.
 * Generates a unique object name based on user ID and filename.
	 * @returns FileUploadResponse Successful Response
	 * @throws ApiError
	 */
	public static fileUpload1(data: FilestorageData['FileUpload1']): CancelablePromise<FileUploadResponse> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/files/upload',
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
	public static fileDownload1(data: FilestorageData['FileDownload1']): CancelablePromise<any> {
		const {
filePath,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/files/download',
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
	public static listFiles1(data: FilestorageData['ListFiles1'] = {}): CancelablePromise<unknown> {
		const {
prefix,
maxKeys = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/files/list',
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
	public static deleteFile1(data: FilestorageData['DeleteFile1']): CancelablePromise<unknown> {
		const {
objectName,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/files/delete',
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
	public static streamFile1(data: FilestorageData['StreamFile1']): CancelablePromise<any> {
		const {
filePath,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/files/stream/{file_path}',
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

	/**
	 * File Upload
	 * Upload a file to the configured storage provider.
 * Expects form-data with a file.
 * Generates a unique object name based on user ID and filename.
	 * @returns FileUploadResponse Successful Response
	 * @throws ApiError
	 */
	public static fileUpload1(data: FilesData['FileUpload1']): CancelablePromise<FileUploadResponse> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/files/upload',
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
	public static fileDownload1(data: FilesData['FileDownload1']): CancelablePromise<any> {
		const {
filePath,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/files/download',
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
	public static listFiles1(data: FilesData['ListFiles1'] = {}): CancelablePromise<unknown> {
		const {
prefix,
maxKeys = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/files/list',
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
	public static deleteFile1(data: FilesData['DeleteFile1']): CancelablePromise<unknown> {
		const {
objectName,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/files/delete',
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
	public static streamFile1(data: FilesData['StreamFile1']): CancelablePromise<any> {
		const {
filePath,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/files/stream/{file_path}',
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

export class FiltersService {

	/**
	 * Save Filter
	 * Save a reusable filter definition.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static saveFilter(data: FiltersData['SaveFilter']): CancelablePromise<Message> {
		const {
filterName,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/filters/filters',
			query: {
				filter_name: filterName
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Filters
	 * List all saved filter names.
	 * @returns string Successful Response
	 * @throws ApiError
	 */
	public static listFilters(): CancelablePromise<Array<string>> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/filters/filters',
		});
	}

	/**
	 * Get Filter
	 * Get a saved filter definition.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getFilter(data: FiltersData['GetFilter']): CancelablePromise<Record<string, unknown>> {
		const {
filterName,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/filters/filters/{filter_name}',
			path: {
				filter_name: filterName
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Filter
	 * Delete a saved filter.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static deleteFilter(data: FiltersData['DeleteFilter']): CancelablePromise<Message> {
		const {
filterName,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/filters/filters/{filter_name}',
			path: {
				filter_name: filterName
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Test Filter
	 * Test a filter against sample data.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static testFilter(data: FiltersData['TestFilter']): CancelablePromise<Record<string, unknown>> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/filters/filters/test',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Basic Filter Examples
	 * Get examples of basic filter configurations.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getBasicFilterExamples(): CancelablePromise<Record<string, unknown>> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/filters/filters/examples/basic',
		});
	}

	/**
	 * Get Advanced Filter Examples
	 * Get examples of advanced filter configurations with composition.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getAdvancedFilterExamples(): CancelablePromise<Record<string, unknown>> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/filters/filters/examples/advanced',
		});
	}

	/**
	 * Create Threshold Filter
	 * Create a threshold filter using the factory.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static createThresholdFilter(data: FiltersData['CreateThresholdFilter']): CancelablePromise<Record<string, unknown>> {
		const {
field,
threshold,
operator = '>=',
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/filters/filters/factory/threshold',
			query: {
				field, threshold, operator
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Range Filter
	 * Create a range filter using the factory.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static createRangeFilter(data: FiltersData['CreateRangeFilter']): CancelablePromise<Record<string, unknown>> {
		const {
field,
minValue,
maxValue,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/filters/filters/factory/range',
			query: {
				field, min_value: minValue, max_value: maxValue
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Keyword Filter
	 * Create a keyword filter using the factory.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static createKeywordFilter(data: FiltersData['CreateKeywordFilter']): CancelablePromise<Record<string, unknown>> {
		const {
field,
requestBody,
matchAny = true,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/filters/filters/factory/keywords',
			query: {
				field, match_any: matchAny
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Save Filter
	 * Save a reusable filter definition.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static saveFilter1(data: FiltersData['SaveFilter1']): CancelablePromise<Message> {
		const {
filterName,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/filters/filters',
			query: {
				filter_name: filterName
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Filters
	 * List all saved filter names.
	 * @returns string Successful Response
	 * @throws ApiError
	 */
	public static listFilters1(): CancelablePromise<Array<string>> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/filters/filters',
		});
	}

	/**
	 * Get Filter
	 * Get a saved filter definition.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getFilter1(data: FiltersData['GetFilter1']): CancelablePromise<Record<string, unknown>> {
		const {
filterName,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/filters/filters/{filter_name}',
			path: {
				filter_name: filterName
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Filter
	 * Delete a saved filter.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static deleteFilter1(data: FiltersData['DeleteFilter1']): CancelablePromise<Message> {
		const {
filterName,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/filters/filters/{filter_name}',
			path: {
				filter_name: filterName
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Test Filter
	 * Test a filter against sample data.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static testFilter1(data: FiltersData['TestFilter1']): CancelablePromise<Record<string, unknown>> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/filters/filters/test',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Basic Filter Examples
	 * Get examples of basic filter configurations.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getBasicFilterExamples1(): CancelablePromise<Record<string, unknown>> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/filters/filters/examples/basic',
		});
	}

	/**
	 * Get Advanced Filter Examples
	 * Get examples of advanced filter configurations with composition.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getAdvancedFilterExamples1(): CancelablePromise<Record<string, unknown>> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/filters/filters/examples/advanced',
		});
	}

	/**
	 * Create Threshold Filter
	 * Create a threshold filter using the factory.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static createThresholdFilter1(data: FiltersData['CreateThresholdFilter1']): CancelablePromise<Record<string, unknown>> {
		const {
field,
threshold,
operator = '>=',
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/filters/filters/factory/threshold',
			query: {
				field, threshold, operator
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Range Filter
	 * Create a range filter using the factory.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static createRangeFilter1(data: FiltersData['CreateRangeFilter1']): CancelablePromise<Record<string, unknown>> {
		const {
field,
minValue,
maxValue,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/filters/filters/factory/range',
			query: {
				field, min_value: minValue, max_value: maxValue
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Keyword Filter
	 * Create a keyword filter using the factory.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static createKeywordFilter1(data: FiltersData['CreateKeywordFilter1']): CancelablePromise<Record<string, unknown>> {
		const {
field,
requestBody,
matchAny = true,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/filters/filters/factory/keywords',
			query: {
				field, match_any: matchAny
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
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

	/**
	 * Readyz
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static readyz1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/healthz/readiness',
		});
	}

	/**
	 * Liveness
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static liveness1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/healthz/liveness',
		});
	}

	/**
	 * Healthz
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static healthz1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/healthz/healthz',
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

	/**
	 * Create Infospace
	 * Create a new Infospace.
	 * @returns InfospaceRead Successful Response
	 * @throws ApiError
	 */
	public static createInfospace2(data: InfospacesData['CreateInfospace2']): CancelablePromise<InfospaceRead> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/infospaces/',
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
	public static listInfospaces2(data: InfospacesData['ListInfospaces2'] = {}): CancelablePromise<InfospacesOut> {
		const {
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/infospaces/',
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
	public static createInfospace3(data: InfospacesData['CreateInfospace3']): CancelablePromise<InfospaceRead> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/infospaces',
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
	public static listInfospaces3(data: InfospacesData['ListInfospaces3'] = {}): CancelablePromise<InfospacesOut> {
		const {
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/infospaces',
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
	public static getInfospace1(data: InfospacesData['GetInfospace1']): CancelablePromise<InfospaceRead> {
		const {
infospaceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/infospaces/{infospace_id}',
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
	public static updateInfospace1(data: InfospacesData['UpdateInfospace1']): CancelablePromise<InfospaceRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v2/infospaces/infospaces/{infospace_id}',
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
	public static deleteInfospace1(data: InfospacesData['DeleteInfospace1']): CancelablePromise<void> {
		const {
infospaceId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/infospaces/infospaces/{infospace_id}',
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
	public static getInfospaceStats1(data: InfospacesData['GetInfospaceStats1']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/infospaces/{infospace_id}/stats',
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
	public static importInfospace1(data: InfospacesData['ImportInfospace1']): CancelablePromise<InfospaceRead> {
		const {
infospaceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/infospaces/import',
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

	/**
	 * Login Access Token
	 * OAuth2 compatible token login, get an access token for future requests
	 * @returns Token Successful Response
	 * @throws ApiError
	 */
	public static loginAccessToken1(data: LoginData['LoginAccessToken1']): CancelablePromise<Token> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/login/access-token',
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
	public static testToken1(): CancelablePromise<UserOut> {
				return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/login/test-token',
		});
	}

	/**
	 * Recover Password
	 * Password Recovery
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static recoverPassword1(data: LoginData['RecoverPassword1']): CancelablePromise<Message> {
		const {
email,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/password-recovery/{email}',
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
	public static resetPassword1(data: LoginData['ResetPassword1']): CancelablePromise<Message> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/reset-password/',
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
	public static recoverPasswordHtmlContent1(data: LoginData['RecoverPasswordHtmlContent1']): CancelablePromise<string> {
		const {
email,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/password-recovery-html-content/{email}',
			path: {
				email
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class MonitorsService {

	/**
	 * Create Monitor
	 * Create a new monitor in an infospace.
	 * @returns MonitorRead Successful Response
	 * @throws ApiError
	 */
	public static createMonitor(data: MonitorsData['CreateMonitor']): CancelablePromise<MonitorRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/infospaces/{infospace_id}/monitors',
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
	 * List Monitors
	 * List all monitors in an infospace.
	 * @returns MonitorRead Successful Response
	 * @throws ApiError
	 */
	public static listMonitors(data: MonitorsData['ListMonitors']): CancelablePromise<Array<MonitorRead>> {
		const {
infospaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/infospaces/{infospace_id}/monitors',
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
	 * Get Monitor
	 * Get a specific monitor by ID.
	 * @returns MonitorRead Successful Response
	 * @throws ApiError
	 */
	public static getMonitor(data: MonitorsData['GetMonitor']): CancelablePromise<MonitorRead> {
		const {
monitorId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/monitors/{monitor_id}',
			path: {
				monitor_id: monitorId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Monitor
	 * Update a monitor.
	 * @returns MonitorRead Successful Response
	 * @throws ApiError
	 */
	public static updateMonitor(data: MonitorsData['UpdateMonitor']): CancelablePromise<MonitorRead> {
		const {
monitorId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v1/monitors/{monitor_id}',
			path: {
				monitor_id: monitorId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Monitor
	 * Delete a monitor.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteMonitor(data: MonitorsData['DeleteMonitor']): CancelablePromise<void> {
		const {
monitorId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/monitors/{monitor_id}',
			path: {
				monitor_id: monitorId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Execute Monitor Manually
	 * Manually trigger a monitor to check for new assets and create a run.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static executeMonitorManually(data: MonitorsData['ExecuteMonitorManually']): CancelablePromise<Message> {
		const {
monitorId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/monitors/{monitor_id}/execute',
			path: {
				monitor_id: monitorId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Monitor
	 * Create a new monitor in an infospace.
	 * @returns MonitorRead Successful Response
	 * @throws ApiError
	 */
	public static createMonitor1(data: MonitorsData['CreateMonitor1']): CancelablePromise<MonitorRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/infospaces/{infospace_id}/monitors',
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
	 * List Monitors
	 * List all monitors in an infospace.
	 * @returns MonitorRead Successful Response
	 * @throws ApiError
	 */
	public static listMonitors1(data: MonitorsData['ListMonitors1']): CancelablePromise<Array<MonitorRead>> {
		const {
infospaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/infospaces/{infospace_id}/monitors',
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
	 * Get Monitor
	 * Get a specific monitor by ID.
	 * @returns MonitorRead Successful Response
	 * @throws ApiError
	 */
	public static getMonitor1(data: MonitorsData['GetMonitor1']): CancelablePromise<MonitorRead> {
		const {
monitorId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/monitors/{monitor_id}',
			path: {
				monitor_id: monitorId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Monitor
	 * Update a monitor.
	 * @returns MonitorRead Successful Response
	 * @throws ApiError
	 */
	public static updateMonitor1(data: MonitorsData['UpdateMonitor1']): CancelablePromise<MonitorRead> {
		const {
monitorId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v2/monitors/{monitor_id}',
			path: {
				monitor_id: monitorId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Monitor
	 * Delete a monitor.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteMonitor1(data: MonitorsData['DeleteMonitor1']): CancelablePromise<void> {
		const {
monitorId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/monitors/{monitor_id}',
			path: {
				monitor_id: monitorId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Execute Monitor Manually
	 * Manually trigger a monitor to check for new assets and create a run.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static executeMonitorManually1(data: MonitorsData['ExecuteMonitorManually1']): CancelablePromise<Message> {
		const {
monitorId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/monitors/{monitor_id}/execute',
			path: {
				monitor_id: monitorId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class PipelinesService {

	/**
	 * Create Pipeline
	 * Create a new Intelligence Pipeline.
	 * @returns IntelligencePipelineRead Successful Response
	 * @throws ApiError
	 */
	public static createPipeline(data: PipelinesData['CreatePipeline']): CancelablePromise<IntelligencePipelineRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/pipelines/infospaces/{infospace_id}/pipelines',
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
	 * List Pipelines
	 * List all Intelligence Pipelines in an infospace.
	 * @returns IntelligencePipelineRead Successful Response
	 * @throws ApiError
	 */
	public static listPipelines(data: PipelinesData['ListPipelines']): CancelablePromise<Array<IntelligencePipelineRead>> {
		const {
infospaceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/pipelines/infospaces/{infospace_id}/pipelines',
			path: {
				infospace_id: infospaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Pipeline
	 * Get a specific Intelligence Pipeline by ID.
	 * @returns IntelligencePipelineRead Successful Response
	 * @throws ApiError
	 */
	public static getPipeline(data: PipelinesData['GetPipeline']): CancelablePromise<IntelligencePipelineRead> {
		const {
pipelineId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/pipelines/{pipeline_id}',
			path: {
				pipeline_id: pipelineId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Pipeline
	 * Update an Intelligence Pipeline.
	 * @returns IntelligencePipelineRead Successful Response
	 * @throws ApiError
	 */
	public static updatePipeline(data: PipelinesData['UpdatePipeline']): CancelablePromise<IntelligencePipelineRead> {
		const {
pipelineId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v1/pipelines/{pipeline_id}',
			path: {
				pipeline_id: pipelineId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Pipeline
	 * Delete an Intelligence Pipeline.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deletePipeline(data: PipelinesData['DeletePipeline']): CancelablePromise<void> {
		const {
pipelineId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/pipelines/{pipeline_id}',
			path: {
				pipeline_id: pipelineId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Execute Pipeline
	 * Manually trigger an Intelligence Pipeline for a specific set of assets.
	 * @returns PipelineExecutionRead Successful Response
	 * @throws ApiError
	 */
	public static executePipeline(data: PipelinesData['ExecutePipeline']): CancelablePromise<PipelineExecutionRead> {
		const {
pipelineId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/pipelines/{pipeline_id}/execute',
			path: {
				pipeline_id: pipelineId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Pipeline
	 * Create a new Intelligence Pipeline.
	 * @returns IntelligencePipelineRead Successful Response
	 * @throws ApiError
	 */
	public static createPipeline1(data: PipelinesData['CreatePipeline1']): CancelablePromise<IntelligencePipelineRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/pipelines/infospaces/{infospace_id}/pipelines',
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
	 * List Pipelines
	 * List all Intelligence Pipelines in an infospace.
	 * @returns IntelligencePipelineRead Successful Response
	 * @throws ApiError
	 */
	public static listPipelines1(data: PipelinesData['ListPipelines1']): CancelablePromise<Array<IntelligencePipelineRead>> {
		const {
infospaceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/pipelines/infospaces/{infospace_id}/pipelines',
			path: {
				infospace_id: infospaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Pipeline
	 * Get a specific Intelligence Pipeline by ID.
	 * @returns IntelligencePipelineRead Successful Response
	 * @throws ApiError
	 */
	public static getPipeline1(data: PipelinesData['GetPipeline1']): CancelablePromise<IntelligencePipelineRead> {
		const {
pipelineId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/pipelines/{pipeline_id}',
			path: {
				pipeline_id: pipelineId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Pipeline
	 * Update an Intelligence Pipeline.
	 * @returns IntelligencePipelineRead Successful Response
	 * @throws ApiError
	 */
	public static updatePipeline1(data: PipelinesData['UpdatePipeline1']): CancelablePromise<IntelligencePipelineRead> {
		const {
pipelineId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v2/pipelines/{pipeline_id}',
			path: {
				pipeline_id: pipelineId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Pipeline
	 * Delete an Intelligence Pipeline.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deletePipeline1(data: PipelinesData['DeletePipeline1']): CancelablePromise<void> {
		const {
pipelineId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/pipelines/{pipeline_id}',
			path: {
				pipeline_id: pipelineId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Execute Pipeline
	 * Manually trigger an Intelligence Pipeline for a specific set of assets.
	 * @returns PipelineExecutionRead Successful Response
	 * @throws ApiError
	 */
	public static executePipeline1(data: PipelinesData['ExecutePipeline1']): CancelablePromise<PipelineExecutionRead> {
		const {
pipelineId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/pipelines/{pipeline_id}/execute',
			path: {
				pipeline_id: pipelineId
			},
			body: requestBody,
			mediaType: 'application/json',
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

	/**
	 * Create Search History
	 * Create a new search history entry.
	 * @returns SearchHistoryRead Successful Response
	 * @throws ApiError
	 */
	public static createSearchHistory1(data: SearchHistoryData['CreateSearchHistory1']): CancelablePromise<SearchHistoryRead> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/search_histories/create',
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
	public static readSearchHistories1(data: SearchHistoryData['ReadSearchHistories1'] = {}): CancelablePromise<SearchHistoriesOut> {
		const {
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/search_histories/read',
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class SharingService {

	/**
	 * Create Shareable Link
	 * Create a new shareable link for a resource within an infospace.
	 * @returns ShareableLinkRead Successful Response
	 * @throws ApiError
	 */
	public static createShareableLink(data: SharingData['CreateShareableLink']): CancelablePromise<ShareableLinkRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/sharing/{infospace_id}/links',
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
	public static getShareableLinks(data: SharingData['GetShareableLinks']): CancelablePromise<Paginated> {
		const {
infospaceId,
resourceType,
resourceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sharing/{infospace_id}/links',
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
	public static getShareableLinkByToken(data: SharingData['GetShareableLinkByToken']): CancelablePromise<ShareableLinkRead> {
		const {
token,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sharing/links/{token}',
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
	public static updateShareableLink(data: SharingData['UpdateShareableLink']): CancelablePromise<ShareableLinkRead> {
		const {
linkId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v1/sharing/links/{link_id}',
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
	public static deleteShareableLink(data: SharingData['DeleteShareableLink']): CancelablePromise<void> {
		const {
linkId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/sharing/links/{link_id}',
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
	public static accessSharedResource(data: SharingData['AccessSharedResource']): CancelablePromise<Record<string, unknown>> {
		const {
token,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sharing/access/{token}',
			path: {
				token
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * View Shared Resource
	 * Provides a read-only, public view of a shared resource (Asset or Bundle).
 * This endpoint is unauthenticated and relies on the link's validity.
	 * @returns SharedResourcePreview Successful Response
	 * @throws ApiError
	 */
	public static viewSharedResource(data: SharingData['ViewSharedResource']): CancelablePromise<SharedResourcePreview> {
		const {
token,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sharing/view/{token}',
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
	public static getSharingStats(data: SharingData['GetSharingStats']): CancelablePromise<ShareableLinkStats> {
		const {
infospaceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sharing/{infospace_id}/stats',
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
	public static exportResource(data: SharingData['ExportResource']): CancelablePromise<any> {
		const {
infospaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/sharing/{infospace_id}/export',
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
	public static importResource(data: SharingData['ImportResource']): CancelablePromise<unknown> {
		const {
targetInfospaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/sharing/import/{target_infospace_id}',
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
	public static exportResourcesBatch(data: SharingData['ExportResourcesBatch']): CancelablePromise<Blob | File> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/sharing/export-batch/{infospace_id}',
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
	 * Export Mixed Batch
	 * Export a mix of assets and bundles to a single ZIP archive.
	 * @returns any Successful Response
	 * @throws ApiError
	 */
	public static exportMixedBatch(data: SharingData['ExportMixedBatch']): CancelablePromise<any> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/sharing/export-mixed-batch/{infospace_id}',
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
	 * Stream Shared Asset File
	 * Stream the file blob associated with a publicly shared asset.
 * Access is validated via the share token.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static streamSharedAssetFile(data: SharingData['StreamSharedAssetFile']): CancelablePromise<unknown> {
		const {
token,
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sharing/stream/{token}/{asset_id}',
			path: {
				token, asset_id: assetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Download Shared Bundle
	 * Download all assets within a publicly shared bundle as a ZIP archive.
 * Access is validated via the share token.
	 * @returns any Successful Response
	 * @throws ApiError
	 */
	public static downloadSharedBundle(data: SharingData['DownloadSharedBundle']): CancelablePromise<any> {
		const {
token,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sharing/download-bundle/{token}',
			path: {
				token
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Download Shared Asset File
	 * Download the file blob associated with a publicly shared asset.
 * Access is validated via the share token.
	 * @returns any Successful Response
	 * @throws ApiError
	 */
	public static downloadSharedAssetFile(data: SharingData['DownloadSharedAssetFile']): CancelablePromise<any> {
		const {
token,
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sharing/download/{token}/{asset_id}',
			path: {
				token, asset_id: assetId
			},
			errors: {
				422: `Validation Error`,
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
	public static viewDatasetPackageSummary(data: SharingData['ViewDatasetPackageSummary']): CancelablePromise<DatasetPackageSummary> {
		const {
token,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sharing/view_dataset_package_summary/{token}',
			path: {
				token
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Import Resource From Token
	 * Import a shared resource into the current user's specified infospace.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static importResourceFromToken(data: SharingData['ImportResourceFromToken']): CancelablePromise<unknown> {
		const {
token,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/sharing/import-from-token/{token}',
			path: {
				token
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Shareable Link
	 * Create a new shareable link for a resource within an infospace.
	 * @returns ShareableLinkRead Successful Response
	 * @throws ApiError
	 */
	public static createShareableLink1(data: SharingData['CreateShareableLink1']): CancelablePromise<ShareableLinkRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/sharing/{infospace_id}/links',
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
	public static getShareableLinks1(data: SharingData['GetShareableLinks1']): CancelablePromise<Paginated> {
		const {
infospaceId,
resourceType,
resourceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sharing/{infospace_id}/links',
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
	public static getShareableLinkByToken1(data: SharingData['GetShareableLinkByToken1']): CancelablePromise<ShareableLinkRead> {
		const {
token,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sharing/links/{token}',
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
	public static updateShareableLink1(data: SharingData['UpdateShareableLink1']): CancelablePromise<ShareableLinkRead> {
		const {
linkId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v2/sharing/links/{link_id}',
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
	public static deleteShareableLink1(data: SharingData['DeleteShareableLink1']): CancelablePromise<void> {
		const {
linkId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/sharing/links/{link_id}',
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
	public static accessSharedResource1(data: SharingData['AccessSharedResource1']): CancelablePromise<Record<string, unknown>> {
		const {
token,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sharing/access/{token}',
			path: {
				token
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * View Shared Resource
	 * Provides a read-only, public view of a shared resource (Asset or Bundle).
 * This endpoint is unauthenticated and relies on the link's validity.
	 * @returns SharedResourcePreview Successful Response
	 * @throws ApiError
	 */
	public static viewSharedResource1(data: SharingData['ViewSharedResource1']): CancelablePromise<SharedResourcePreview> {
		const {
token,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sharing/view/{token}',
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
	public static getSharingStats1(data: SharingData['GetSharingStats1']): CancelablePromise<ShareableLinkStats> {
		const {
infospaceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sharing/{infospace_id}/stats',
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
	public static exportResource1(data: SharingData['ExportResource1']): CancelablePromise<any> {
		const {
infospaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/sharing/{infospace_id}/export',
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
	public static importResource1(data: SharingData['ImportResource1']): CancelablePromise<unknown> {
		const {
targetInfospaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/sharing/import/{target_infospace_id}',
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
	public static exportResourcesBatch1(data: SharingData['ExportResourcesBatch1']): CancelablePromise<Blob | File> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/sharing/export-batch/{infospace_id}',
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
	 * Export Mixed Batch
	 * Export a mix of assets and bundles to a single ZIP archive.
	 * @returns any Successful Response
	 * @throws ApiError
	 */
	public static exportMixedBatch1(data: SharingData['ExportMixedBatch1']): CancelablePromise<any> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/sharing/export-mixed-batch/{infospace_id}',
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
	 * Stream Shared Asset File
	 * Stream the file blob associated with a publicly shared asset.
 * Access is validated via the share token.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static streamSharedAssetFile1(data: SharingData['StreamSharedAssetFile1']): CancelablePromise<unknown> {
		const {
token,
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sharing/stream/{token}/{asset_id}',
			path: {
				token, asset_id: assetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Download Shared Bundle
	 * Download all assets within a publicly shared bundle as a ZIP archive.
 * Access is validated via the share token.
	 * @returns any Successful Response
	 * @throws ApiError
	 */
	public static downloadSharedBundle1(data: SharingData['DownloadSharedBundle1']): CancelablePromise<any> {
		const {
token,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sharing/download-bundle/{token}',
			path: {
				token
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Download Shared Asset File
	 * Download the file blob associated with a publicly shared asset.
 * Access is validated via the share token.
	 * @returns any Successful Response
	 * @throws ApiError
	 */
	public static downloadSharedAssetFile1(data: SharingData['DownloadSharedAssetFile1']): CancelablePromise<any> {
		const {
token,
assetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sharing/download/{token}/{asset_id}',
			path: {
				token, asset_id: assetId
			},
			errors: {
				422: `Validation Error`,
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
	public static viewDatasetPackageSummary1(data: SharingData['ViewDatasetPackageSummary1']): CancelablePromise<DatasetPackageSummary> {
		const {
token,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sharing/view_dataset_package_summary/{token}',
			path: {
				token
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Import Resource From Token
	 * Import a shared resource into the current user's specified infospace.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static importResourceFromToken1(data: SharingData['ImportResourceFromToken1']): CancelablePromise<unknown> {
		const {
token,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/sharing/import-from-token/{token}',
			path: {
				token
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class SourcesService {

	/**
	 * Create Source
	 * Create a new Source record (e.g., for a URL list, text block, or to pre-define a source before files are added).
 * File uploads that immediately create Assets should use a different endpoint that calls IngestionService.create_source_and_assets.
	 * @returns SourceRead Successful Response
	 * @throws ApiError
	 */
	public static createSource(data: SourcesData['CreateSource']): CancelablePromise<SourceRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/sources/infospaces/{infospace_id}/sources/',
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
	 * List Sources
	 * Retrieve Sources for the infospace.
	 * @returns SourcesOut Successful Response
	 * @throws ApiError
	 */
	public static listSources(data: SourcesData['ListSources']): CancelablePromise<SourcesOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sources/infospaces/{infospace_id}/sources/',
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
	 * Create Source
	 * Create a new Source record (e.g., for a URL list, text block, or to pre-define a source before files are added).
 * File uploads that immediately create Assets should use a different endpoint that calls IngestionService.create_source_and_assets.
	 * @returns SourceRead Successful Response
	 * @throws ApiError
	 */
	public static createSource1(data: SourcesData['CreateSource1']): CancelablePromise<SourceRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/sources/infospaces/{infospace_id}/sources',
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
	 * List Sources
	 * Retrieve Sources for the infospace.
	 * @returns SourcesOut Successful Response
	 * @throws ApiError
	 */
	public static listSources1(data: SourcesData['ListSources1']): CancelablePromise<SourcesOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sources/infospaces/{infospace_id}/sources',
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
	 * Get Source
	 * Retrieve a specific Source by its ID.
	 * @returns SourceRead Successful Response
	 * @throws ApiError
	 */
	public static getSource(data: SourcesData['GetSource']): CancelablePromise<SourceRead> {
		const {
infospaceId,
sourceId,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sources/infospaces/{infospace_id}/sources/{source_id}',
			path: {
				infospace_id: infospaceId, source_id: sourceId
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
	 * Update Source
	 * Update a Source.
	 * @returns SourceRead Successful Response
	 * @throws ApiError
	 */
	public static updateSource(data: SourcesData['UpdateSource']): CancelablePromise<SourceRead> {
		const {
infospaceId,
sourceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/sources/infospaces/{infospace_id}/sources/{source_id}',
			path: {
				infospace_id: infospaceId, source_id: sourceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Source
	 * Delete a Source.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteSource(data: SourcesData['DeleteSource']): CancelablePromise<void> {
		const {
infospaceId,
sourceId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/sources/infospaces/{infospace_id}/sources/{source_id}',
			path: {
				infospace_id: infospaceId, source_id: sourceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Transfer Sources
	 * Transfer sources between infospaces.
	 * @returns SourceTransferResponse Successful Response
	 * @throws ApiError
	 */
	public static transferSources(data: SourcesData['TransferSources']): CancelablePromise<SourceTransferResponse> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/sources/infospaces/{infospace_id}/sources/transfer',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Source
	 * Create a new Source record (e.g., for a URL list, text block, or to pre-define a source before files are added).
 * File uploads that immediately create Assets should use a different endpoint that calls IngestionService.create_source_and_assets.
	 * @returns SourceRead Successful Response
	 * @throws ApiError
	 */
	public static createSource2(data: SourcesData['CreateSource2']): CancelablePromise<SourceRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/sources/infospaces/{infospace_id}/sources/',
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
	 * List Sources
	 * Retrieve Sources for the infospace.
	 * @returns SourcesOut Successful Response
	 * @throws ApiError
	 */
	public static listSources2(data: SourcesData['ListSources2']): CancelablePromise<SourcesOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sources/infospaces/{infospace_id}/sources/',
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
	 * Create Source
	 * Create a new Source record (e.g., for a URL list, text block, or to pre-define a source before files are added).
 * File uploads that immediately create Assets should use a different endpoint that calls IngestionService.create_source_and_assets.
	 * @returns SourceRead Successful Response
	 * @throws ApiError
	 */
	public static createSource3(data: SourcesData['CreateSource3']): CancelablePromise<SourceRead> {
		const {
infospaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/sources/infospaces/{infospace_id}/sources',
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
	 * List Sources
	 * Retrieve Sources for the infospace.
	 * @returns SourcesOut Successful Response
	 * @throws ApiError
	 */
	public static listSources3(data: SourcesData['ListSources3']): CancelablePromise<SourcesOut> {
		const {
infospaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sources/infospaces/{infospace_id}/sources',
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
	 * Get Source
	 * Retrieve a specific Source by its ID.
	 * @returns SourceRead Successful Response
	 * @throws ApiError
	 */
	public static getSource1(data: SourcesData['GetSource1']): CancelablePromise<SourceRead> {
		const {
infospaceId,
sourceId,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sources/infospaces/{infospace_id}/sources/{source_id}',
			path: {
				infospace_id: infospaceId, source_id: sourceId
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
	 * Update Source
	 * Update a Source.
	 * @returns SourceRead Successful Response
	 * @throws ApiError
	 */
	public static updateSource1(data: SourcesData['UpdateSource1']): CancelablePromise<SourceRead> {
		const {
infospaceId,
sourceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v2/sources/infospaces/{infospace_id}/sources/{source_id}',
			path: {
				infospace_id: infospaceId, source_id: sourceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Source
	 * Delete a Source.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteSource1(data: SourcesData['DeleteSource1']): CancelablePromise<void> {
		const {
infospaceId,
sourceId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/sources/infospaces/{infospace_id}/sources/{source_id}',
			path: {
				infospace_id: infospaceId, source_id: sourceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Transfer Sources
	 * Transfer sources between infospaces.
	 * @returns SourceTransferResponse Successful Response
	 * @throws ApiError
	 */
	public static transferSources1(data: SourcesData['TransferSources1']): CancelablePromise<SourceTransferResponse> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/sources/infospaces/{infospace_id}/sources/transfer',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class SsoService {

	/**
	 * Initiate Discourse Login
	 * Convenience endpoint to redirect users to Discourse login.
 * When they click "Log In" on Discourse, Discourse will automatically
 * redirect back to our /callback endpoint to handle SSO.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static initiateDiscourseLogin(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sso/discourse/login',
		});
	}

	/**
	 * Initiate Discourse Login
	 * Convenience endpoint to redirect users to Discourse login.
 * When they click "Log In" on Discourse, Discourse will automatically
 * redirect back to our /callback endpoint to handle SSO.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static initiateDiscourseLogin1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sso/discourse/login',
		});
	}

	/**
	 * Handle Discourse Sso
	 * Handle SSO callback from Discourse.
 * Since this is a server-to-server redirect, we can't rely on JWT tokens.
 * Instead, redirect to a frontend page that can handle the authentication.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static handleDiscourseSso(data: SsoData['HandleDiscourseSso']): CancelablePromise<unknown> {
		const {
sso,
sig,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sso/discourse/callback',
			query: {
				sso, sig
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Handle Discourse Sso
	 * Handle SSO callback from Discourse.
 * Since this is a server-to-server redirect, we can't rely on JWT tokens.
 * Instead, redirect to a frontend page that can handle the authentication.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static handleDiscourseSso1(data: SsoData['HandleDiscourseSso1']): CancelablePromise<unknown> {
		const {
sso,
sig,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sso/discourse/callback',
			query: {
				sso, sig
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Handle Discourse Logout
	 * Handle logout from Discourse.
 * This is called when a user logs out from Discourse to also log them out of your app.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static handleDiscourseLogout(): CancelablePromise<Message> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sso/discourse/logout',
		});
	}

	/**
	 * Handle Discourse Logout
	 * Handle logout from Discourse.
 * This is called when a user logs out from Discourse to also log them out of your app.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static handleDiscourseLogout1(): CancelablePromise<Message> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sso/discourse/logout',
		});
	}

	/**
	 * Get Discourse Sso Info
	 * Get information about Discourse SSO configuration.
 * Useful for debugging and setup verification.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getDiscourseSsoInfo(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sso/discourse/info',
		});
	}

	/**
	 * Get Discourse Sso Info
	 * Get information about Discourse SSO configuration.
 * Useful for debugging and setup verification.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getDiscourseSsoInfo1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/sso/discourse/info',
		});
	}

	/**
	 * Sync User To Discourse
	 * Manually sync a user to Discourse.
 * This can be useful for testing or forcing a user sync.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static syncUserToDiscourse(data: SsoData['SyncUserToDiscourse'] = {}): CancelablePromise<Message> {
		const {
userId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/sso/discourse/user-sync',
			query: {
				user_id: userId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Sync User To Discourse
	 * Manually sync a user to Discourse.
 * This can be useful for testing or forcing a user sync.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static syncUserToDiscourse1(data: SsoData['SyncUserToDiscourse1'] = {}): CancelablePromise<Message> {
		const {
userId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/sso/discourse/user-sync',
			query: {
				user_id: userId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Complete Discourse Sso
	 * Complete the SSO process with an authenticated user.
 * Returns the redirect URL as JSON to avoid CORS issues with manual redirects.
	 * @returns string Successful Response
	 * @throws ApiError
	 */
	public static completeDiscourseSso(data: SsoData['CompleteDiscourseSso']): CancelablePromise<Record<string, string>> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/sso/discourse/complete',
			formData: formData,
			mediaType: 'application/x-www-form-urlencoded',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Complete Discourse Sso
	 * Complete the SSO process with an authenticated user.
 * Returns the redirect URL as JSON to avoid CORS issues with manual redirects.
	 * @returns string Successful Response
	 * @throws ApiError
	 */
	public static completeDiscourseSso1(data: SsoData['CompleteDiscourseSso1']): CancelablePromise<Record<string, string>> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/sso/discourse/complete',
			formData: formData,
			mediaType: 'application/x-www-form-urlencoded',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Initiate Discourse Login
	 * Convenience endpoint to redirect users to Discourse login.
 * When they click "Log In" on Discourse, Discourse will automatically
 * redirect back to our /callback endpoint to handle SSO.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static initiateDiscourseLogin2(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sso/discourse/login',
		});
	}

	/**
	 * Initiate Discourse Login
	 * Convenience endpoint to redirect users to Discourse login.
 * When they click "Log In" on Discourse, Discourse will automatically
 * redirect back to our /callback endpoint to handle SSO.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static initiateDiscourseLogin3(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sso/discourse/login',
		});
	}

	/**
	 * Handle Discourse Sso
	 * Handle SSO callback from Discourse.
 * Since this is a server-to-server redirect, we can't rely on JWT tokens.
 * Instead, redirect to a frontend page that can handle the authentication.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static handleDiscourseSso2(data: SsoData['HandleDiscourseSso2']): CancelablePromise<unknown> {
		const {
sso,
sig,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sso/discourse/callback',
			query: {
				sso, sig
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Handle Discourse Sso
	 * Handle SSO callback from Discourse.
 * Since this is a server-to-server redirect, we can't rely on JWT tokens.
 * Instead, redirect to a frontend page that can handle the authentication.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static handleDiscourseSso3(data: SsoData['HandleDiscourseSso3']): CancelablePromise<unknown> {
		const {
sso,
sig,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sso/discourse/callback',
			query: {
				sso, sig
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Handle Discourse Logout
	 * Handle logout from Discourse.
 * This is called when a user logs out from Discourse to also log them out of your app.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static handleDiscourseLogout2(): CancelablePromise<Message> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sso/discourse/logout',
		});
	}

	/**
	 * Handle Discourse Logout
	 * Handle logout from Discourse.
 * This is called when a user logs out from Discourse to also log them out of your app.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static handleDiscourseLogout3(): CancelablePromise<Message> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sso/discourse/logout',
		});
	}

	/**
	 * Get Discourse Sso Info
	 * Get information about Discourse SSO configuration.
 * Useful for debugging and setup verification.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getDiscourseSsoInfo2(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sso/discourse/info',
		});
	}

	/**
	 * Get Discourse Sso Info
	 * Get information about Discourse SSO configuration.
 * Useful for debugging and setup verification.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getDiscourseSsoInfo3(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/sso/discourse/info',
		});
	}

	/**
	 * Sync User To Discourse
	 * Manually sync a user to Discourse.
 * This can be useful for testing or forcing a user sync.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static syncUserToDiscourse2(data: SsoData['SyncUserToDiscourse2'] = {}): CancelablePromise<Message> {
		const {
userId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/sso/discourse/user-sync',
			query: {
				user_id: userId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Sync User To Discourse
	 * Manually sync a user to Discourse.
 * This can be useful for testing or forcing a user sync.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static syncUserToDiscourse3(data: SsoData['SyncUserToDiscourse3'] = {}): CancelablePromise<Message> {
		const {
userId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/sso/discourse/user-sync',
			query: {
				user_id: userId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Complete Discourse Sso
	 * Complete the SSO process with an authenticated user.
 * Returns the redirect URL as JSON to avoid CORS issues with manual redirects.
	 * @returns string Successful Response
	 * @throws ApiError
	 */
	public static completeDiscourseSso2(data: SsoData['CompleteDiscourseSso2']): CancelablePromise<Record<string, string>> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/sso/discourse/complete',
			formData: formData,
			mediaType: 'application/x-www-form-urlencoded',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Complete Discourse Sso
	 * Complete the SSO process with an authenticated user.
 * Returns the redirect URL as JSON to avoid CORS issues with manual redirects.
	 * @returns string Successful Response
	 * @throws ApiError
	 */
	public static completeDiscourseSso3(data: SsoData['CompleteDiscourseSso3']): CancelablePromise<Record<string, string>> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/sso/discourse/complete',
			formData: formData,
			mediaType: 'application/x-www-form-urlencoded',
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class TasksService {

	/**
	 * Create Task
	 * Create a new Recurring Task in the specified infospace.
	 * @returns TaskRead Successful Response
	 * @throws ApiError
	 */
	public static createTask(data: TasksData['CreateTask']): CancelablePromise<TaskRead> {
		const {
infospaceId,
args,
kwargs,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/tasks/infospaces/{infospace_id}/tasks/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				args, kwargs
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Task
	 * Create a new Recurring Task in the specified infospace.
	 * @returns TaskRead Successful Response
	 * @throws ApiError
	 */
	public static createTask1(data: TasksData['CreateTask1']): CancelablePromise<TaskRead> {
		const {
infospaceId,
args,
kwargs,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/tasks/infospaces/{infospace_id}/tasks/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				args, kwargs
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Tasks
	 * Retrieve Tasks for the infospace using the service.
	 * @returns TasksOut Successful Response
	 * @throws ApiError
	 */
	public static listTasks(data: TasksData['ListTasks']): CancelablePromise<TasksOut> {
		const {
infospaceId,
args,
kwargs,
skip = 0,
limit = 100,
status,
type,
isEnabled,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/tasks/infospaces/{infospace_id}/tasks/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, status, type, is_enabled: isEnabled, args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Tasks
	 * Retrieve Tasks for the infospace using the service.
	 * @returns TasksOut Successful Response
	 * @throws ApiError
	 */
	public static listTasks1(data: TasksData['ListTasks1']): CancelablePromise<TasksOut> {
		const {
infospaceId,
args,
kwargs,
skip = 0,
limit = 100,
status,
type,
isEnabled,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/tasks/infospaces/{infospace_id}/tasks/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, status, type, is_enabled: isEnabled, args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Task
	 * Create a new Recurring Task in the specified infospace.
	 * @returns TaskRead Successful Response
	 * @throws ApiError
	 */
	public static createTask2(data: TasksData['CreateTask2']): CancelablePromise<TaskRead> {
		const {
infospaceId,
args,
kwargs,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/tasks/infospaces/{infospace_id}/tasks',
			path: {
				infospace_id: infospaceId
			},
			query: {
				args, kwargs
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Task
	 * Create a new Recurring Task in the specified infospace.
	 * @returns TaskRead Successful Response
	 * @throws ApiError
	 */
	public static createTask3(data: TasksData['CreateTask3']): CancelablePromise<TaskRead> {
		const {
infospaceId,
args,
kwargs,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/tasks/infospaces/{infospace_id}/tasks',
			path: {
				infospace_id: infospaceId
			},
			query: {
				args, kwargs
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Tasks
	 * Retrieve Tasks for the infospace using the service.
	 * @returns TasksOut Successful Response
	 * @throws ApiError
	 */
	public static listTasks2(data: TasksData['ListTasks2']): CancelablePromise<TasksOut> {
		const {
infospaceId,
args,
kwargs,
skip = 0,
limit = 100,
status,
type,
isEnabled,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/tasks/infospaces/{infospace_id}/tasks',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, status, type, is_enabled: isEnabled, args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Tasks
	 * Retrieve Tasks for the infospace using the service.
	 * @returns TasksOut Successful Response
	 * @throws ApiError
	 */
	public static listTasks3(data: TasksData['ListTasks3']): CancelablePromise<TasksOut> {
		const {
infospaceId,
args,
kwargs,
skip = 0,
limit = 100,
status,
type,
isEnabled,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/tasks/infospaces/{infospace_id}/tasks',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, status, type, is_enabled: isEnabled, args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Task
	 * Retrieve a specific Task by its ID from the infospace.
	 * @returns TaskRead Successful Response
	 * @throws ApiError
	 */
	public static getTask(data: TasksData['GetTask']): CancelablePromise<TaskRead> {
		const {
infospaceId,
taskId,
args,
kwargs,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/tasks/infospaces/{infospace_id}/tasks/{task_id}',
			path: {
				infospace_id: infospaceId, task_id: taskId
			},
			query: {
				args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Task
	 * Retrieve a specific Task by its ID from the infospace.
	 * @returns TaskRead Successful Response
	 * @throws ApiError
	 */
	public static getTask1(data: TasksData['GetTask1']): CancelablePromise<TaskRead> {
		const {
infospaceId,
taskId,
args,
kwargs,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/tasks/infospaces/{infospace_id}/tasks/{task_id}',
			path: {
				infospace_id: infospaceId, task_id: taskId
			},
			query: {
				args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Task
	 * Update a Task in the infospace.
	 * @returns TaskRead Successful Response
	 * @throws ApiError
	 */
	public static updateTask(data: TasksData['UpdateTask']): CancelablePromise<TaskRead> {
		const {
infospaceId,
taskId,
args,
kwargs,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v1/tasks/infospaces/{infospace_id}/tasks/{task_id}',
			path: {
				infospace_id: infospaceId, task_id: taskId
			},
			query: {
				args, kwargs
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Task
	 * Update a Task in the infospace.
	 * @returns TaskRead Successful Response
	 * @throws ApiError
	 */
	public static updateTask1(data: TasksData['UpdateTask1']): CancelablePromise<TaskRead> {
		const {
infospaceId,
taskId,
args,
kwargs,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v1/tasks/infospaces/{infospace_id}/tasks/{task_id}',
			path: {
				infospace_id: infospaceId, task_id: taskId
			},
			query: {
				args, kwargs
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Task
	 * Delete a Task from the infospace.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteTask(data: TasksData['DeleteTask']): CancelablePromise<void> {
		const {
infospaceId,
taskId,
args,
kwargs,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/tasks/infospaces/{infospace_id}/tasks/{task_id}',
			path: {
				infospace_id: infospaceId, task_id: taskId
			},
			query: {
				args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Task
	 * Delete a Task from the infospace.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteTask1(data: TasksData['DeleteTask1']): CancelablePromise<void> {
		const {
infospaceId,
taskId,
args,
kwargs,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/tasks/infospaces/{infospace_id}/tasks/{task_id}',
			path: {
				infospace_id: infospaceId, task_id: taskId
			},
			query: {
				args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Execute Task Manually
	 * Manually trigger the execution of a specific task.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static executeTaskManually(data: TasksData['ExecuteTaskManually']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
taskId,
args,
kwargs,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/tasks/infospaces/{infospace_id}/tasks/{task_id}/execute',
			path: {
				infospace_id: infospaceId, task_id: taskId
			},
			query: {
				args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Execute Task Manually
	 * Manually trigger the execution of a specific task.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static executeTaskManually1(data: TasksData['ExecuteTaskManually1']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
taskId,
args,
kwargs,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/tasks/infospaces/{infospace_id}/tasks/{task_id}/execute',
			path: {
				infospace_id: infospaceId, task_id: taskId
			},
			query: {
				args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Task
	 * Create a new Recurring Task in the specified infospace.
	 * @returns TaskRead Successful Response
	 * @throws ApiError
	 */
	public static createTask4(data: TasksData['CreateTask4']): CancelablePromise<TaskRead> {
		const {
infospaceId,
args,
kwargs,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/tasks/infospaces/{infospace_id}/tasks/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				args, kwargs
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Task
	 * Create a new Recurring Task in the specified infospace.
	 * @returns TaskRead Successful Response
	 * @throws ApiError
	 */
	public static createTask5(data: TasksData['CreateTask5']): CancelablePromise<TaskRead> {
		const {
infospaceId,
args,
kwargs,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/tasks/infospaces/{infospace_id}/tasks/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				args, kwargs
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Tasks
	 * Retrieve Tasks for the infospace using the service.
	 * @returns TasksOut Successful Response
	 * @throws ApiError
	 */
	public static listTasks4(data: TasksData['ListTasks4']): CancelablePromise<TasksOut> {
		const {
infospaceId,
args,
kwargs,
skip = 0,
limit = 100,
status,
type,
isEnabled,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/tasks/infospaces/{infospace_id}/tasks/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, status, type, is_enabled: isEnabled, args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Tasks
	 * Retrieve Tasks for the infospace using the service.
	 * @returns TasksOut Successful Response
	 * @throws ApiError
	 */
	public static listTasks5(data: TasksData['ListTasks5']): CancelablePromise<TasksOut> {
		const {
infospaceId,
args,
kwargs,
skip = 0,
limit = 100,
status,
type,
isEnabled,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/tasks/infospaces/{infospace_id}/tasks/',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, status, type, is_enabled: isEnabled, args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Task
	 * Create a new Recurring Task in the specified infospace.
	 * @returns TaskRead Successful Response
	 * @throws ApiError
	 */
	public static createTask6(data: TasksData['CreateTask6']): CancelablePromise<TaskRead> {
		const {
infospaceId,
args,
kwargs,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/tasks/infospaces/{infospace_id}/tasks',
			path: {
				infospace_id: infospaceId
			},
			query: {
				args, kwargs
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Task
	 * Create a new Recurring Task in the specified infospace.
	 * @returns TaskRead Successful Response
	 * @throws ApiError
	 */
	public static createTask7(data: TasksData['CreateTask7']): CancelablePromise<TaskRead> {
		const {
infospaceId,
args,
kwargs,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/tasks/infospaces/{infospace_id}/tasks',
			path: {
				infospace_id: infospaceId
			},
			query: {
				args, kwargs
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Tasks
	 * Retrieve Tasks for the infospace using the service.
	 * @returns TasksOut Successful Response
	 * @throws ApiError
	 */
	public static listTasks6(data: TasksData['ListTasks6']): CancelablePromise<TasksOut> {
		const {
infospaceId,
args,
kwargs,
skip = 0,
limit = 100,
status,
type,
isEnabled,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/tasks/infospaces/{infospace_id}/tasks',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, status, type, is_enabled: isEnabled, args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Tasks
	 * Retrieve Tasks for the infospace using the service.
	 * @returns TasksOut Successful Response
	 * @throws ApiError
	 */
	public static listTasks7(data: TasksData['ListTasks7']): CancelablePromise<TasksOut> {
		const {
infospaceId,
args,
kwargs,
skip = 0,
limit = 100,
status,
type,
isEnabled,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/tasks/infospaces/{infospace_id}/tasks',
			path: {
				infospace_id: infospaceId
			},
			query: {
				skip, limit, status, type, is_enabled: isEnabled, args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Task
	 * Retrieve a specific Task by its ID from the infospace.
	 * @returns TaskRead Successful Response
	 * @throws ApiError
	 */
	public static getTask2(data: TasksData['GetTask2']): CancelablePromise<TaskRead> {
		const {
infospaceId,
taskId,
args,
kwargs,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/tasks/infospaces/{infospace_id}/tasks/{task_id}',
			path: {
				infospace_id: infospaceId, task_id: taskId
			},
			query: {
				args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Task
	 * Retrieve a specific Task by its ID from the infospace.
	 * @returns TaskRead Successful Response
	 * @throws ApiError
	 */
	public static getTask3(data: TasksData['GetTask3']): CancelablePromise<TaskRead> {
		const {
infospaceId,
taskId,
args,
kwargs,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/tasks/infospaces/{infospace_id}/tasks/{task_id}',
			path: {
				infospace_id: infospaceId, task_id: taskId
			},
			query: {
				args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Task
	 * Update a Task in the infospace.
	 * @returns TaskRead Successful Response
	 * @throws ApiError
	 */
	public static updateTask2(data: TasksData['UpdateTask2']): CancelablePromise<TaskRead> {
		const {
infospaceId,
taskId,
args,
kwargs,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v2/tasks/infospaces/{infospace_id}/tasks/{task_id}',
			path: {
				infospace_id: infospaceId, task_id: taskId
			},
			query: {
				args, kwargs
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Task
	 * Update a Task in the infospace.
	 * @returns TaskRead Successful Response
	 * @throws ApiError
	 */
	public static updateTask3(data: TasksData['UpdateTask3']): CancelablePromise<TaskRead> {
		const {
infospaceId,
taskId,
args,
kwargs,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v2/tasks/infospaces/{infospace_id}/tasks/{task_id}',
			path: {
				infospace_id: infospaceId, task_id: taskId
			},
			query: {
				args, kwargs
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Task
	 * Delete a Task from the infospace.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteTask2(data: TasksData['DeleteTask2']): CancelablePromise<void> {
		const {
infospaceId,
taskId,
args,
kwargs,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/tasks/infospaces/{infospace_id}/tasks/{task_id}',
			path: {
				infospace_id: infospaceId, task_id: taskId
			},
			query: {
				args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Task
	 * Delete a Task from the infospace.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteTask3(data: TasksData['DeleteTask3']): CancelablePromise<void> {
		const {
infospaceId,
taskId,
args,
kwargs,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/tasks/infospaces/{infospace_id}/tasks/{task_id}',
			path: {
				infospace_id: infospaceId, task_id: taskId
			},
			query: {
				args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Execute Task Manually
	 * Manually trigger the execution of a specific task.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static executeTaskManually2(data: TasksData['ExecuteTaskManually2']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
taskId,
args,
kwargs,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/tasks/infospaces/{infospace_id}/tasks/{task_id}/execute',
			path: {
				infospace_id: infospaceId, task_id: taskId
			},
			query: {
				args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Execute Task Manually
	 * Manually trigger the execution of a specific task.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static executeTaskManually3(data: TasksData['ExecuteTaskManually3']): CancelablePromise<Record<string, unknown>> {
		const {
infospaceId,
taskId,
args,
kwargs,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/tasks/infospaces/{infospace_id}/tasks/{task_id}/execute',
			path: {
				infospace_id: infospaceId, task_id: taskId
			},
			query: {
				args, kwargs
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class UserBackupsService {

	/**
	 * Create User Backup
	 * Create a new backup of a complete user account (Admin only).
	 * @returns UserBackupRead Successful Response
	 * @throws ApiError
	 */
	public static createUserBackup(data: UserBackupsData['CreateUserBackup']): CancelablePromise<UserBackupRead> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/user-backups',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List User Backups
	 * List user backups (Admin only).
	 * @returns UserBackupsOut Successful Response
	 * @throws ApiError
	 */
	public static listUserBackups(data: UserBackupsData['ListUserBackups'] = {}): CancelablePromise<UserBackupsOut> {
		const {
skip = 0,
limit = 100,
targetUserId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/user-backups',
			query: {
				skip, limit, target_user_id: targetUserId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get User Backup
	 * Get a specific user backup (Admin only).
	 * @returns UserBackupRead Successful Response
	 * @throws ApiError
	 */
	public static getUserBackup(data: UserBackupsData['GetUserBackup']): CancelablePromise<UserBackupRead> {
		const {
backupId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/user-backups/{backup_id}',
			path: {
				backup_id: backupId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update User Backup
	 * Update user backup metadata (Admin only).
	 * @returns UserBackupRead Successful Response
	 * @throws ApiError
	 */
	public static updateUserBackup(data: UserBackupsData['UpdateUserBackup']): CancelablePromise<UserBackupRead> {
		const {
backupId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v1/user-backups/{backup_id}',
			path: {
				backup_id: backupId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete User Backup
	 * Delete a user backup and its files (Admin only).
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static deleteUserBackup(data: UserBackupsData['DeleteUserBackup']): CancelablePromise<Message> {
		const {
backupId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/user-backups/{backup_id}',
			path: {
				backup_id: backupId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Restore User Backup
	 * Restore a user from a backup (Admin only).
	 * @returns UserOut Successful Response
	 * @throws ApiError
	 */
	public static restoreUserBackup(data: UserBackupsData['RestoreUserBackup']): CancelablePromise<UserOut> {
		const {
backupId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/user-backups/{backup_id}/restore',
			path: {
				backup_id: backupId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create User Backup Share Link
	 * Create a shareable link for a user backup (Admin only).
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static createUserBackupShareLink(data: UserBackupsData['CreateUserBackupShareLink']): CancelablePromise<Record<string, unknown>> {
		const {
backupId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/user-backups/{backup_id}/share',
			path: {
				backup_id: backupId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Download Shared User Backup
	 * Download a shared user backup.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static downloadSharedUserBackup(data: UserBackupsData['DownloadSharedUserBackup']): CancelablePromise<unknown> {
		const {
shareToken,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/user-backups/download/{share_token}',
			path: {
				share_token: shareToken
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Cleanup Expired User Backups
	 * Manually trigger cleanup of expired user backups (Admin only).
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static cleanupExpiredUserBackups(): CancelablePromise<Message> {
				return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/user-backups/cleanup',
		});
	}

	/**
	 * Get Users Backup Overview
	 * Admin endpoint: Get overview of all users with backup status.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getUsersBackupOverview(data: UserBackupsData['GetUsersBackupOverview'] = {}): CancelablePromise<Record<string, unknown>> {
		const {
limit = 100,
skip = 0,
search,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/user-backups/admin/users-overview',
			query: {
				limit, skip, search
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Trigger Backup All Users
	 * Admin endpoint: Trigger backup creation for all users.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static triggerBackupAllUsers(data: UserBackupsData['TriggerBackupAllUsers'] = {}): CancelablePromise<Message> {
		const {
backupType = 'system',
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/user-backups/admin/backup-all',
			query: {
				backup_type: backupType
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Trigger Backup Specific Users
	 * Admin endpoint: Trigger backup creation for specific users.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static triggerBackupSpecificUsers(data: UserBackupsData['TriggerBackupSpecificUsers']): CancelablePromise<Message> {
		const {
requestBody,
backupType = 'manual',
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/user-backups/admin/backup-specific',
			query: {
				backup_type: backupType
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create User Backup
	 * Create a new backup of a complete user account (Admin only).
	 * @returns UserBackupRead Successful Response
	 * @throws ApiError
	 */
	public static createUserBackup1(data: UserBackupsData['CreateUserBackup1']): CancelablePromise<UserBackupRead> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/user-backups',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List User Backups
	 * List user backups (Admin only).
	 * @returns UserBackupsOut Successful Response
	 * @throws ApiError
	 */
	public static listUserBackups1(data: UserBackupsData['ListUserBackups1'] = {}): CancelablePromise<UserBackupsOut> {
		const {
skip = 0,
limit = 100,
targetUserId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/user-backups',
			query: {
				skip, limit, target_user_id: targetUserId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get User Backup
	 * Get a specific user backup (Admin only).
	 * @returns UserBackupRead Successful Response
	 * @throws ApiError
	 */
	public static getUserBackup1(data: UserBackupsData['GetUserBackup1']): CancelablePromise<UserBackupRead> {
		const {
backupId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/user-backups/{backup_id}',
			path: {
				backup_id: backupId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update User Backup
	 * Update user backup metadata (Admin only).
	 * @returns UserBackupRead Successful Response
	 * @throws ApiError
	 */
	public static updateUserBackup1(data: UserBackupsData['UpdateUserBackup1']): CancelablePromise<UserBackupRead> {
		const {
backupId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v2/user-backups/{backup_id}',
			path: {
				backup_id: backupId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete User Backup
	 * Delete a user backup and its files (Admin only).
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static deleteUserBackup1(data: UserBackupsData['DeleteUserBackup1']): CancelablePromise<Message> {
		const {
backupId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/user-backups/{backup_id}',
			path: {
				backup_id: backupId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Restore User Backup
	 * Restore a user from a backup (Admin only).
	 * @returns UserOut Successful Response
	 * @throws ApiError
	 */
	public static restoreUserBackup1(data: UserBackupsData['RestoreUserBackup1']): CancelablePromise<UserOut> {
		const {
backupId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/user-backups/{backup_id}/restore',
			path: {
				backup_id: backupId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create User Backup Share Link
	 * Create a shareable link for a user backup (Admin only).
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static createUserBackupShareLink1(data: UserBackupsData['CreateUserBackupShareLink1']): CancelablePromise<Record<string, unknown>> {
		const {
backupId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/user-backups/{backup_id}/share',
			path: {
				backup_id: backupId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Download Shared User Backup
	 * Download a shared user backup.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static downloadSharedUserBackup1(data: UserBackupsData['DownloadSharedUserBackup1']): CancelablePromise<unknown> {
		const {
shareToken,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/user-backups/download/{share_token}',
			path: {
				share_token: shareToken
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Cleanup Expired User Backups
	 * Manually trigger cleanup of expired user backups (Admin only).
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static cleanupExpiredUserBackups1(): CancelablePromise<Message> {
				return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/user-backups/cleanup',
		});
	}

	/**
	 * Get Users Backup Overview
	 * Admin endpoint: Get overview of all users with backup status.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getUsersBackupOverview1(data: UserBackupsData['GetUsersBackupOverview1'] = {}): CancelablePromise<Record<string, unknown>> {
		const {
limit = 100,
skip = 0,
search,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/user-backups/admin/users-overview',
			query: {
				limit, skip, search
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Trigger Backup All Users
	 * Admin endpoint: Trigger backup creation for all users.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static triggerBackupAllUsers1(data: UserBackupsData['TriggerBackupAllUsers1'] = {}): CancelablePromise<Message> {
		const {
backupType = 'system',
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/user-backups/admin/backup-all',
			query: {
				backup_type: backupType
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Trigger Backup Specific Users
	 * Admin endpoint: Trigger backup creation for specific users.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static triggerBackupSpecificUsers1(data: UserBackupsData['TriggerBackupSpecificUsers1']): CancelablePromise<Message> {
		const {
requestBody,
backupType = 'manual',
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/user-backups/admin/backup-specific',
			query: {
				backup_type: backupType
			},
			body: requestBody,
			mediaType: 'application/json',
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
	 * Update own user profile.
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
	 * Upload Profile Picture
	 * Upload a profile picture for the current user.
	 * @returns UserOut Successful Response
	 * @throws ApiError
	 */
	public static uploadProfilePicture(data: UsersData['UploadProfilePicture']): CancelablePromise<UserOut> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/users/me/upload-profile-picture',
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get User Public Profile
	 * Get a user's public profile (no authentication required).
 * Returns only non-sensitive profile information.
	 * @returns UserPublicProfile Successful Response
	 * @throws ApiError
	 */
	public static getUserPublicProfile(data: UsersData['GetUserPublicProfile']): CancelablePromise<UserPublicProfile> {
		const {
userId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/users/profile/{user_id}',
			path: {
				user_id: userId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Profile Picture
	 * Serve profile pictures publicly (no authentication required).
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getProfilePicture(data: UsersData['GetProfilePicture']): CancelablePromise<unknown> {
		const {
userId,
filename,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/users/profile-picture/{user_id}/{filename}',
			path: {
				user_id: userId, filename
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List User Profiles
	 * List user profiles with optional search.
 * Search looks in full_name and bio fields.
	 * @returns UserPublicProfile Successful Response
	 * @throws ApiError
	 */
	public static listUserProfiles(data: UsersData['ListUserProfiles'] = {}): CancelablePromise<Array<UserPublicProfile>> {
		const {
skip = 0,
limit = 20,
search,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/users/profiles',
			query: {
				skip, limit, search
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get User Profile Stats
	 * Get user profile statistics.
	 * @returns UserProfileStats Successful Response
	 * @throws ApiError
	 */
	public static getUserProfileStats(data: UsersData['GetUserProfileStats']): CancelablePromise<UserProfileStats> {
		const {
userId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/users/profile/{user_id}/stats',
			path: {
				user_id: userId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update User Profile
	 * Update user profile information only (no email or password changes).
	 * @returns UserOut Successful Response
	 * @throws ApiError
	 */
	public static updateUserProfile(data: UsersData['UpdateUserProfile']): CancelablePromise<UserOut> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/users/me/profile',
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
 * Sends email verification if REQUIRE_EMAIL_VERIFICATION is enabled.
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

	/**
	 * Verify Email
	 * Verify user email address using verification token.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static verifyEmail(data: UsersData['VerifyEmail']): CancelablePromise<Message> {
		const {
token,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/users/verify-email',
			query: {
				token
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Resend Verification
	 * Resend email verification for a user.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static resendVerification(data: UsersData['ResendVerification']): CancelablePromise<Message> {
		const {
email,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/users/resend-verification',
			query: {
				email
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Email Debug Status
	 * Debug endpoint to check email configuration status.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getEmailDebugStatus(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/users/debug/email-status',
		});
	}

	/**
	 * Read Users
	 * Retrieve users.
	 * @returns UsersOut Successful Response
	 * @throws ApiError
	 */
	public static readUsers2(data: UsersData['ReadUsers2'] = {}): CancelablePromise<UsersOut> {
		const {
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/users/',
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
	public static createUser2(data: UsersData['CreateUser2']): CancelablePromise<UserOut> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/users/',
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
	public static readUsers3(data: UsersData['ReadUsers3'] = {}): CancelablePromise<UsersOut> {
		const {
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/users',
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
	public static createUser3(data: UsersData['CreateUser3']): CancelablePromise<UserOut> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/users',
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
	public static readUserMe1(): CancelablePromise<UserOut> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/users/me',
		});
	}

	/**
	 * Update User Me
	 * Update own user profile.
	 * @returns UserOut Successful Response
	 * @throws ApiError
	 */
	public static updateUserMe1(data: UsersData['UpdateUserMe1']): CancelablePromise<UserOut> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v2/users/me',
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
	public static updatePasswordMe1(data: UsersData['UpdatePasswordMe1']): CancelablePromise<Message> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v2/users/me/password',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Upload Profile Picture
	 * Upload a profile picture for the current user.
	 * @returns UserOut Successful Response
	 * @throws ApiError
	 */
	public static uploadProfilePicture1(data: UsersData['UploadProfilePicture1']): CancelablePromise<UserOut> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/users/me/upload-profile-picture',
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get User Public Profile
	 * Get a user's public profile (no authentication required).
 * Returns only non-sensitive profile information.
	 * @returns UserPublicProfile Successful Response
	 * @throws ApiError
	 */
	public static getUserPublicProfile1(data: UsersData['GetUserPublicProfile1']): CancelablePromise<UserPublicProfile> {
		const {
userId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/users/profile/{user_id}',
			path: {
				user_id: userId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Profile Picture
	 * Serve profile pictures publicly (no authentication required).
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getProfilePicture1(data: UsersData['GetProfilePicture1']): CancelablePromise<unknown> {
		const {
userId,
filename,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/users/profile-picture/{user_id}/{filename}',
			path: {
				user_id: userId, filename
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List User Profiles
	 * List user profiles with optional search.
 * Search looks in full_name and bio fields.
	 * @returns UserPublicProfile Successful Response
	 * @throws ApiError
	 */
	public static listUserProfiles1(data: UsersData['ListUserProfiles1'] = {}): CancelablePromise<Array<UserPublicProfile>> {
		const {
skip = 0,
limit = 20,
search,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/users/profiles',
			query: {
				skip, limit, search
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get User Profile Stats
	 * Get user profile statistics.
	 * @returns UserProfileStats Successful Response
	 * @throws ApiError
	 */
	public static getUserProfileStats1(data: UsersData['GetUserProfileStats1']): CancelablePromise<UserProfileStats> {
		const {
userId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/users/profile/{user_id}/stats',
			path: {
				user_id: userId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update User Profile
	 * Update user profile information only (no email or password changes).
	 * @returns UserOut Successful Response
	 * @throws ApiError
	 */
	public static updateUserProfile1(data: UsersData['UpdateUserProfile1']): CancelablePromise<UserOut> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v2/users/me/profile',
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
 * Sends email verification if REQUIRE_EMAIL_VERIFICATION is enabled.
	 * @returns UserOut Successful Response
	 * @throws ApiError
	 */
	public static createUserOpen1(data: UsersData['CreateUserOpen1']): CancelablePromise<UserOut> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/users/open',
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
	public static readUserById1(data: UsersData['ReadUserById1']): CancelablePromise<UserOut> {
		const {
userId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/users/{user_id}',
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
	public static updateUser1(data: UsersData['UpdateUser1']): CancelablePromise<UserOut> {
		const {
userId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v2/users/{user_id}',
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
	public static deleteUser1(data: UsersData['DeleteUser1']): CancelablePromise<Message> {
		const {
userId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/users/{user_id}',
			path: {
				user_id: userId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Verify Email
	 * Verify user email address using verification token.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static verifyEmail1(data: UsersData['VerifyEmail1']): CancelablePromise<Message> {
		const {
token,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/users/verify-email',
			query: {
				token
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Resend Verification
	 * Resend email verification for a user.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static resendVerification1(data: UsersData['ResendVerification1']): CancelablePromise<Message> {
		const {
email,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/users/resend-verification',
			query: {
				email
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Email Debug Status
	 * Debug endpoint to check email configuration status.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getEmailDebugStatus1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/users/debug/email-status',
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
			url: '/api/v1/utils/test-email/',
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
			url: '/api/v1/utils/healthz',
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
			url: '/api/v1/utils/healthz/readiness',
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
			url: '/api/v1/utils/healthz/liveness',
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
			url: '/api/v1/utils/extract-pdf-text',
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
			url: '/api/v1/utils/extract-pdf-metadata',
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
			url: '/api/v1/utils/scrape_article',
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
	 * Returns a dynamic list of available classification providers and their models.
 * Discovers models from all configured providers (Ollama, OpenAI, Gemini).
	 * @returns ProviderListResponse Successful Response
	 * @throws ApiError
	 */
	public static getProviders(): CancelablePromise<ProviderListResponse> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/utils/providers',
		});
	}

	/**
	 * Pull Ollama Model
	 * Pull a model from Ollama registry.
 * Admin only endpoint for security.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static pullOllamaModel(data: UtilsData['PullOllamaModel']): CancelablePromise<Message> {
		const {
modelName,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/utils/ollama/pull-model',
			query: {
				model_name: modelName
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Ollama Available Models
	 * Fetch models from the *plain* Ollama Library page and return normalized JSON.
 * Only calls https://ollama.com/library (follows redirect from /library/).
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getOllamaAvailableModels(data: UtilsData['GetOllamaAvailableModels'] = {}): CancelablePromise<Record<string, unknown>> {
		const {
sort = 'newest',
limit = 50,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/utils/ollama/available-models',
			query: {
				sort, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Remove Ollama Model
	 * Remove a model from Ollama.
 * Admin only endpoint for security.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static removeOllamaModel(data: UtilsData['RemoveOllamaModel']): CancelablePromise<Message> {
		const {
modelName,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/utils/ollama/remove-model',
			query: {
				model_name: modelName
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Test Email
	 * Test emails.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static testEmail1(data: UtilsData['TestEmail1']): CancelablePromise<Message> {
		const {
emailTo,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/utils/test-email/',
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
	public static healthz1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/utils/healthz',
		});
	}

	/**
	 * Readyz
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static readyz1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/utils/healthz/readiness',
		});
	}

	/**
	 * Liveness
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static liveness1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/utils/healthz/liveness',
		});
	}

	/**
	 * Extract Pdf Text
	 * Extract text from PDF without authentication
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static extractPdfText1(data: UtilsData['ExtractPdfText1']): CancelablePromise<unknown> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/utils/extract-pdf-text',
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
	public static extractPdfMetadata1(data: UtilsData['ExtractPdfMetadata1']): CancelablePromise<unknown> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/utils/extract-pdf-metadata',
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
	public static scrapeArticle1(data: UtilsData['ScrapeArticle1']): CancelablePromise<unknown> {
		const {
url,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/utils/scrape_article',
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
	 * Returns a dynamic list of available classification providers and their models.
 * Discovers models from all configured providers (Ollama, OpenAI, Gemini).
	 * @returns ProviderListResponse Successful Response
	 * @throws ApiError
	 */
	public static getProviders1(): CancelablePromise<ProviderListResponse> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/utils/providers',
		});
	}

	/**
	 * Pull Ollama Model
	 * Pull a model from Ollama registry.
 * Admin only endpoint for security.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static pullOllamaModel1(data: UtilsData['PullOllamaModel1']): CancelablePromise<Message> {
		const {
modelName,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/utils/ollama/pull-model',
			query: {
				model_name: modelName
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Ollama Available Models
	 * Fetch models from the *plain* Ollama Library page and return normalized JSON.
 * Only calls https://ollama.com/library (follows redirect from /library/).
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getOllamaAvailableModels1(data: UtilsData['GetOllamaAvailableModels1'] = {}): CancelablePromise<Record<string, unknown>> {
		const {
sort = 'newest',
limit = 50,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/utils/ollama/available-models',
			query: {
				sort, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Remove Ollama Model
	 * Remove a model from Ollama.
 * Admin only endpoint for security.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static removeOllamaModel1(data: UtilsData['RemoveOllamaModel1']): CancelablePromise<Message> {
		const {
modelName,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/utils/ollama/remove-model',
			query: {
				model_name: modelName
			},
			errors: {
				422: `Validation Error`,
			},
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
			url: '/api/v1/utils/test-email/',
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
			url: '/api/v1/utils/healthz',
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
			url: '/api/v1/utils/healthz/readiness',
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
			url: '/api/v1/utils/healthz/liveness',
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
			url: '/api/v1/utils/extract-pdf-text',
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
			url: '/api/v1/utils/extract-pdf-metadata',
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
			url: '/api/v1/utils/scrape_article',
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
	 * Returns a dynamic list of available classification providers and their models.
 * Discovers models from all configured providers (Ollama, OpenAI, Gemini).
	 * @returns ProviderListResponse Successful Response
	 * @throws ApiError
	 */
	public static getProviders(): CancelablePromise<ProviderListResponse> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/utils/providers',
		});
	}

	/**
	 * Pull Ollama Model
	 * Pull a model from Ollama registry.
 * Admin only endpoint for security.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static pullOllamaModel(data: UtilitiesData['PullOllamaModel']): CancelablePromise<Message> {
		const {
modelName,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/utils/ollama/pull-model',
			query: {
				model_name: modelName
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Ollama Available Models
	 * Fetch models from the *plain* Ollama Library page and return normalized JSON.
 * Only calls https://ollama.com/library (follows redirect from /library/).
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getOllamaAvailableModels(data: UtilitiesData['GetOllamaAvailableModels'] = {}): CancelablePromise<Record<string, unknown>> {
		const {
sort = 'newest',
limit = 50,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/utils/ollama/available-models',
			query: {
				sort, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Remove Ollama Model
	 * Remove a model from Ollama.
 * Admin only endpoint for security.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static removeOllamaModel(data: UtilitiesData['RemoveOllamaModel']): CancelablePromise<Message> {
		const {
modelName,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/utils/ollama/remove-model',
			query: {
				model_name: modelName
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Test Email
	 * Test emails.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static testEmail1(data: UtilitiesData['TestEmail1']): CancelablePromise<Message> {
		const {
emailTo,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/utils/test-email/',
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
	public static healthz1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/utils/healthz',
		});
	}

	/**
	 * Readyz
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static readyz1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/utils/healthz/readiness',
		});
	}

	/**
	 * Liveness
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static liveness1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/utils/healthz/liveness',
		});
	}

	/**
	 * Extract Pdf Text
	 * Extract text from PDF without authentication
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static extractPdfText1(data: UtilitiesData['ExtractPdfText1']): CancelablePromise<unknown> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/utils/extract-pdf-text',
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
	public static extractPdfMetadata1(data: UtilitiesData['ExtractPdfMetadata1']): CancelablePromise<unknown> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/utils/extract-pdf-metadata',
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
	public static scrapeArticle1(data: UtilitiesData['ScrapeArticle1']): CancelablePromise<unknown> {
		const {
url,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/utils/scrape_article',
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
	 * Returns a dynamic list of available classification providers and their models.
 * Discovers models from all configured providers (Ollama, OpenAI, Gemini).
	 * @returns ProviderListResponse Successful Response
	 * @throws ApiError
	 */
	public static getProviders1(): CancelablePromise<ProviderListResponse> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/utils/providers',
		});
	}

	/**
	 * Pull Ollama Model
	 * Pull a model from Ollama registry.
 * Admin only endpoint for security.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static pullOllamaModel1(data: UtilitiesData['PullOllamaModel1']): CancelablePromise<Message> {
		const {
modelName,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/utils/ollama/pull-model',
			query: {
				model_name: modelName
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Ollama Available Models
	 * Fetch models from the *plain* Ollama Library page and return normalized JSON.
 * Only calls https://ollama.com/library (follows redirect from /library/).
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getOllamaAvailableModels1(data: UtilitiesData['GetOllamaAvailableModels1'] = {}): CancelablePromise<Record<string, unknown>> {
		const {
sort = 'newest',
limit = 50,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/utils/ollama/available-models',
			query: {
				sort, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Remove Ollama Model
	 * Remove a model from Ollama.
 * Admin only endpoint for security.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static removeOllamaModel1(data: UtilitiesData['RemoveOllamaModel1']): CancelablePromise<Message> {
		const {
modelName,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v2/utils/ollama/remove-model',
			query: {
				model_name: modelName
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class EntitiesService {

	/**
	 * Get Location Articles
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getLocationArticles(data: EntitiesData['GetLocationArticles']): CancelablePromise<unknown> {
		const {
location,
skip = 0,
limit = 20,
searchQuery,
searchType = 'text',
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/entities/{location}/articles',
			path: {
				location
			},
			query: {
				skip, limit, search_query: searchQuery, search_type: searchType
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
			url: '/api/v1/entities/geojson/',
		});
	}

	/**
	 * Get Entity Articles
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getEntityArticles(data: EntitiesData['GetEntityArticles']): CancelablePromise<unknown> {
		const {
entityName,
skip = 0,
limit = 50,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/entities/{entity_name}/articles',
			path: {
				entity_name: entityName
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
	 * Get Leader Info
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getLeaderInfo(data: EntitiesData['GetLeaderInfo']): CancelablePromise<unknown> {
		const {
state,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/entities/leaders/{state}',
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
	public static getLegislationData(data: EntitiesData['GetLegislationData']): CancelablePromise<unknown> {
		const {
state,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/entities/legislation/{state}',
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
	public static getEconData(data: EntitiesData['GetEconData']): CancelablePromise<unknown> {
		const {
state,
indicators = [
    "GDP",
    "GDP_GROWTH"
],
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/entities/econ_data/{state}',
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
			url: '/api/v1/entities/update_leaders/',
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
			url: '/api/v1/entities/get_articles',
		});
	}

	/**
	 * Get Entity Score Over Time
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getEntityScoreOverTime(data: EntitiesData['GetEntityScoreOverTime']): CancelablePromise<unknown> {
		const {
entity,
scoreType,
timeframeFrom,
timeframeTo,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/entities/score_over_time/{entity}',
			path: {
				entity
			},
			query: {
				score_type: scoreType, timeframe_from: timeframeFrom, timeframe_to: timeframeTo
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Top Entities By Score
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getTopEntitiesByScore(data: EntitiesData['GetTopEntitiesByScore']): CancelablePromise<unknown> {
		const {
scoreType,
timeframeFrom,
timeframeTo,
limit = 10,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/entities/top_entities_by_score',
			query: {
				score_type: scoreType, timeframe_from: timeframeFrom, timeframe_to: timeframeTo, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Location Articles
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getLocationArticles1(data: EntitiesData['GetLocationArticles1']): CancelablePromise<unknown> {
		const {
location,
skip = 0,
limit = 20,
searchQuery,
searchType = 'text',
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/entities/{location}/articles',
			path: {
				location
			},
			query: {
				skip, limit, search_query: searchQuery, search_type: searchType
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
	public static geojsonView1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/entities/geojson/',
		});
	}

	/**
	 * Get Entity Articles
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getEntityArticles1(data: EntitiesData['GetEntityArticles1']): CancelablePromise<unknown> {
		const {
entityName,
skip = 0,
limit = 50,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/entities/{entity_name}/articles',
			path: {
				entity_name: entityName
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
	 * Get Leader Info
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getLeaderInfo1(data: EntitiesData['GetLeaderInfo1']): CancelablePromise<unknown> {
		const {
state,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/entities/leaders/{state}',
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
	public static getLegislationData1(data: EntitiesData['GetLegislationData1']): CancelablePromise<unknown> {
		const {
state,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/entities/legislation/{state}',
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
	public static getEconData1(data: EntitiesData['GetEconData1']): CancelablePromise<unknown> {
		const {
state,
indicators = [
    "GDP",
    "GDP_GROWTH"
],
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/entities/econ_data/{state}',
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
	public static updateLeaders1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/entities/update_leaders/',
		});
	}

	/**
	 * Get Tavily Data
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getTavilyData1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/entities/get_articles',
		});
	}

	/**
	 * Get Entity Score Over Time
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getEntityScoreOverTime1(data: EntitiesData['GetEntityScoreOverTime1']): CancelablePromise<unknown> {
		const {
entity,
scoreType,
timeframeFrom,
timeframeTo,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/entities/score_over_time/{entity}',
			path: {
				entity
			},
			query: {
				score_type: scoreType, timeframe_from: timeframeFrom, timeframe_to: timeframeTo
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Top Entities By Score
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getTopEntitiesByScore1(data: EntitiesData['GetTopEntitiesByScore1']): CancelablePromise<unknown> {
		const {
scoreType,
timeframeFrom,
timeframeTo,
limit = 10,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/entities/top_entities_by_score',
			query: {
				score_type: scoreType, timeframe_from: timeframeFrom, timeframe_to: timeframeTo, limit
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

	/**
	 * Get Location Contents
	 * Get articles related to a location with basic pagination.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getLocationContents1(data: LocationsData['GetLocationContents1']): CancelablePromise<unknown> {
		const {
location,
skip = 0,
limit = 20,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/locations/{location}/contents',
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
	public static getLocationEntitiesContents1(data: LocationsData['GetLocationEntitiesContents1']): CancelablePromise<unknown> {
		const {
location,
skip = 0,
limit = 20,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/locations/{location}/entities/contents',
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
	public static locationFromQuery1(data: LocationsData['LocationFromQuery1']): CancelablePromise<unknown> {
		const {
query,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/locations/location_from_query',
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
	public static geojsonView1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/locations/geojson/',
		});
	}

	/**
	 * Geojson Events View
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static geojsonEventsView1(data: LocationsData['GeojsonEventsView1']): CancelablePromise<unknown> {
		const {
eventType,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/locations/geojson_events',
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
	public static dashboardView1(): CancelablePromise<string> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/locations/dashboard',
		});
	}

	/**
	 * Get Location Entities
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getLocationEntities1(data: LocationsData['GetLocationEntities1']): CancelablePromise<unknown> {
		const {
locationName,
skip = 0,
limit = 50,
minRelevance = 0,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/locations/{location_name}/entities',
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
	public static getLeaderInfo1(data: LocationsData['GetLeaderInfo1']): CancelablePromise<unknown> {
		const {
state,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/locations/leaders/{state}',
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
	public static getLegislationData1(data: LocationsData['GetLegislationData1']): CancelablePromise<unknown> {
		const {
state,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/locations/legislation/{state}',
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
	public static getEconData1(data: LocationsData['GetEconData1']): CancelablePromise<unknown> {
		const {
state,
indicators = [
    "GDP",
    "GDP_GROWTH"
],
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/locations/econ_data/{state}',
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
	public static updateLeaders1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/locations/update_leaders/',
		});
	}

	/**
	 * Get Tavily Data
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getTavilyData1(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/locations/get_articles',
		});
	}

	/**
	 * Get Coordinates
	 * Fetches the coordinates, bounding box, and location type for a given location.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getCoordinates1(data: LocationsData['GetCoordinates1']): CancelablePromise<unknown> {
		const {
location,
language = 'en',
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/locations/get_coordinates',
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
	public static getGeojsonForArticleIds1(data: LocationsData['GetGeojsonForArticleIds1']): CancelablePromise<unknown> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/locations/get_geojson_for_article_ids',
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
	public static getLocationMetadata1(data: LocationsData['GetLocationMetadata1']): CancelablePromise<unknown> {
		const {
location,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/locations/metadata/{location}',
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
	public static channelRoute1(data: LocationsData['ChannelRoute1']): CancelablePromise<unknown> {
		const {
serviceName,
path,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/locations/channel/{service_name}/{path}',
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

	/**
	 * Get Contents
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getContents1(data: SearchData['GetContents1'] = {}): CancelablePromise<unknown> {
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
			url: '/api/v2/search/contents',
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
	public static getMostRelevantEntities1(data: SearchData['GetMostRelevantEntities1']): CancelablePromise<unknown> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/search/most_relevant_entities',
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
	public static searchSynthesizer1(data: SearchData['SearchSynthesizer1']): CancelablePromise<unknown> {
		const {
searchQuery,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/search/search_synthesizer',
			query: {
				search_query: searchQuery
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}