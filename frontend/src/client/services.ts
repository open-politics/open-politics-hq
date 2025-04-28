import type { CancelablePromise } from './core/CancelablePromise';
import { OpenAPI } from './core/OpenAPI';
import { request as __request } from './core/request';

import type { Body_login_login_access_token,Message,NewPassword,Token,UserOut,UpdatePassword,UserCreate,UserCreateOpen,UsersOut,UserUpdate,UserUpdateMe,Body_utils_extract_pdf_metadata,Body_utils_extract_pdf_text,ItemCreate,ItemOut,ItemsOut,ItemUpdate,Body_shareables_import_resource,ResourceType,ShareableLinkCreate,ShareableLinkRead,ShareableLinkStats,ShareableLinkUpdate,SearchHistoriesOut,SearchHistory,SearchHistoryCreate,Body_filestorage_file_upload,FileUploadResponse,DataSourceTransferRequest,DataSourceTransferResponse,WorkspaceCreate,WorkspaceRead,WorkspaceUpdate,ClassificationSchemeCreate,ClassificationSchemeRead,ClassificationSchemeUpdate,ClassificationResultRead,EnhancedClassificationResultRead,ClassificationJobCreate,ClassificationJobRead,ClassificationJobsOut,ClassificationJobUpdate,Body_datasources_create_datasource,Body_datasources_update_datasource_urls,CsvRowsOut,DataSourceRead,DataSourcesOut,DataSourceUpdate,AppendRecordInput,DataRecordRead,RecurringTaskCreate,RecurringTaskRead,RecurringTasksOut,RecurringTaskStatus,RecurringTaskUpdate,Body_datasets_import_dataset,DatasetCreate,DatasetRead,DatasetsOut,DatasetUpdate,Request,MostRelevantEntitiesRequest,SearchType,ArticleResponse } from './models';

export type AppData = {
        
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

export type ItemsData = {
        ReadItems: {
                    limit?: number
skip?: number
                    
                };
CreateItem: {
                    requestBody: ItemCreate
                    
                };
ReadItem: {
                    id: number
                    
                };
UpdateItem: {
                    id: number
requestBody: ItemUpdate
                    
                };
DeleteItem: {
                    id: number
                    
                };
    }

export type ShareablesData = {
        CreateShareableLink: {
                    requestBody: ShareableLinkCreate
                    
                };
GetShareableLinks: {
                    /**
 * Filter by resource ID
 */
resourceId?: number | null
/**
 * Filter by resource type
 */
resourceType?: ResourceType | null
                    
                };
GetShareableLink: {
                    linkId: number
                    
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
ExportResource: {
                    resourceId: number
resourceType: ResourceType
                    
                };
ImportResource: {
                    formData: Body_shareables_import_resource
workspaceId: number
                    
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

export type FilestorageData = {
        FileUpload: {
                    formData: Body_filestorage_file_upload
                    
                };
FileDownload: {
                    filePath: string
                    
                };
DeleteFile: {
                    objectName: string
                    
                };
    }

export type FilesData = {
        FileUpload: {
                    formData: Body_filestorage_file_upload
                    
                };
FileDownload: {
                    filePath: string
                    
                };
DeleteFile: {
                    objectName: string
                    
                };
    }

export type WorkspacesData = {
        CreateWorkspace: {
                    requestBody: WorkspaceCreate
                    
                };
ReadWorkspaces: {
                    limit?: number
skip?: number
                    
                };
CreateWorkspace1: {
                    requestBody: WorkspaceCreate
                    
                };
ReadWorkspaces1: {
                    limit?: number
skip?: number
                    
                };
ReadWorkspaceById: {
                    workspaceId: number
                    
                };
UpdateWorkspace: {
                    requestBody: WorkspaceUpdate
workspaceId: number
                    
                };
DeleteWorkspace: {
                    workspaceId: number
                    
                };
TransferDatasourcesEndpoint: {
                    requestBody: DataSourceTransferRequest
                    
                };
    }

export type ClassificationSchemesData = {
        CreateClassificationScheme: {
                    requestBody: ClassificationSchemeCreate
workspaceId: number
                    
                };
CreateClassificationScheme1: {
                    requestBody: ClassificationSchemeCreate
workspaceId: number
                    
                };
ReadClassificationSchemes: {
                    limit?: number
skip?: number
workspaceId: number
                    
                };
ReadClassificationSchemes1: {
                    limit?: number
skip?: number
workspaceId: number
                    
                };
DeleteAllClassificationSchemes: {
                    workspaceId: number
                    
                };
DeleteAllClassificationSchemes1: {
                    workspaceId: number
                    
                };
CreateClassificationScheme2: {
                    requestBody: ClassificationSchemeCreate
workspaceId: number
                    
                };
CreateClassificationScheme3: {
                    requestBody: ClassificationSchemeCreate
workspaceId: number
                    
                };
ReadClassificationSchemes2: {
                    limit?: number
skip?: number
workspaceId: number
                    
                };
ReadClassificationSchemes3: {
                    limit?: number
skip?: number
workspaceId: number
                    
                };
DeleteAllClassificationSchemes2: {
                    workspaceId: number
                    
                };
DeleteAllClassificationSchemes3: {
                    workspaceId: number
                    
                };
ReadClassificationScheme: {
                    schemeId: number
workspaceId: number
                    
                };
ReadClassificationScheme1: {
                    schemeId: number
workspaceId: number
                    
                };
UpdateClassificationScheme: {
                    requestBody: ClassificationSchemeUpdate
schemeId: number
workspaceId: number
                    
                };
UpdateClassificationScheme1: {
                    requestBody: ClassificationSchemeUpdate
schemeId: number
workspaceId: number
                    
                };
DeleteClassificationScheme: {
                    schemeId: number
workspaceId: number
                    
                };
DeleteClassificationScheme1: {
                    schemeId: number
workspaceId: number
                    
                };
    }

export type ClassificationResultsData = {
        GetClassificationResult: {
                    resultId: number
workspaceId: number
                    
                };
GetClassificationResult1: {
                    resultId: number
workspaceId: number
                    
                };
ListClassificationResults: {
                    /**
 * Filter results by DataRecord IDs
 */
datarecordIds?: Array<number> | null
/**
 * Filter results by ClassificationJob ID
 */
jobId?: number | null
limit?: number
/**
 * Filter results by ClassificationScheme IDs
 */
schemeIds?: Array<number> | null
skip?: number
workspaceId: number
                    
                };
ListClassificationResults1: {
                    /**
 * Filter results by DataRecord IDs
 */
datarecordIds?: Array<number> | null
/**
 * Filter results by ClassificationJob ID
 */
jobId?: number | null
limit?: number
/**
 * Filter results by ClassificationScheme IDs
 */
schemeIds?: Array<number> | null
skip?: number
workspaceId: number
                    
                };
ListClassificationResults2: {
                    /**
 * Filter results by DataRecord IDs
 */
datarecordIds?: Array<number> | null
/**
 * Filter results by ClassificationJob ID
 */
jobId?: number | null
limit?: number
/**
 * Filter results by ClassificationScheme IDs
 */
schemeIds?: Array<number> | null
skip?: number
workspaceId: number
                    
                };
ListClassificationResults3: {
                    /**
 * Filter results by DataRecord IDs
 */
datarecordIds?: Array<number> | null
/**
 * Filter results by ClassificationJob ID
 */
jobId?: number | null
limit?: number
/**
 * Filter results by ClassificationScheme IDs
 */
schemeIds?: Array<number> | null
skip?: number
workspaceId: number
                    
                };
GetJobResults: {
                    jobId: number
limit?: number
skip?: number
workspaceId: number
                    
                };
GetJobResults1: {
                    jobId: number
limit?: number
skip?: number
workspaceId: number
                    
                };
    }

export type ClassificationJobsData = {
        CreateClassificationJob: {
                    requestBody: ClassificationJobCreate
workspaceId: number
                    
                };
CreateClassificationJob1: {
                    requestBody: ClassificationJobCreate
workspaceId: number
                    
                };
ListClassificationJobs: {
                    /**
 * Include counts of results and data records
 */
includeCounts?: boolean
limit?: number
skip?: number
workspaceId: number
                    
                };
ListClassificationJobs1: {
                    /**
 * Include counts of results and data records
 */
includeCounts?: boolean
limit?: number
skip?: number
workspaceId: number
                    
                };
CreateClassificationJob2: {
                    requestBody: ClassificationJobCreate
workspaceId: number
                    
                };
CreateClassificationJob3: {
                    requestBody: ClassificationJobCreate
workspaceId: number
                    
                };
ListClassificationJobs2: {
                    /**
 * Include counts of results and data records
 */
includeCounts?: boolean
limit?: number
skip?: number
workspaceId: number
                    
                };
ListClassificationJobs3: {
                    /**
 * Include counts of results and data records
 */
includeCounts?: boolean
limit?: number
skip?: number
workspaceId: number
                    
                };
GetClassificationJob: {
                    /**
 * Include counts of results and data records
 */
includeCounts?: boolean
jobId: number
workspaceId: number
                    
                };
GetClassificationJob1: {
                    /**
 * Include counts of results and data records
 */
includeCounts?: boolean
jobId: number
workspaceId: number
                    
                };
UpdateClassificationJob: {
                    jobId: number
requestBody: ClassificationJobUpdate
workspaceId: number
                    
                };
UpdateClassificationJob1: {
                    jobId: number
requestBody: ClassificationJobUpdate
workspaceId: number
                    
                };
DeleteClassificationJob: {
                    jobId: number
workspaceId: number
                    
                };
DeleteClassificationJob1: {
                    jobId: number
workspaceId: number
                    
                };
    }

export type DatasourcesData = {
        CreateDatasource: {
                    formData: Body_datasources_create_datasource
workspaceId: number
                    
                };
ListDatasources: {
                    limit?: number
skip?: number
workspaceId: number
                    
                };
CreateDatasource1: {
                    formData: Body_datasources_create_datasource
workspaceId: number
                    
                };
ListDatasources1: {
                    limit?: number
skip?: number
workspaceId: number
                    
                };
GetDatasource: {
                    datasourceId: number
workspaceId: number
                    
                };
DeleteDatasource: {
                    datasourceId: number
workspaceId: number
                    
                };
UpdateDatasource: {
                    datasourceId: number
requestBody: DataSourceUpdate
workspaceId: number
                    
                };
GetDatasourceUrls: {
                    datasourceId: number
workspaceId: number
                    
                };
UpdateDatasourceUrls: {
                    datasourceId: number
requestBody: Body_datasources_update_datasource_urls
workspaceId: number
                    
                };
ReadDatasourceRows: {
                    datasourceId: number
/**
 * Number of rows to return
 */
limit?: number
/**
 * Number of rows to skip
 */
skip?: number
workspaceId: number
                    
                };
RefetchDatasource: {
                    datasourceId: number
workspaceId: number
                    
                };
GetDatasourceContent: {
                    datasourceId: number
workspaceId: number
                    
                };
DownloadDatasourcePdf: {
                    datasourceId: number
workspaceId: number
                    
                };
    }

export type DatarecordsData = {
        GetDatarecord: {
                    datarecordId: number
workspaceId: number
                    
                };
ListDatarecords: {
                    datasourceId: number
limit?: number
skip?: number
workspaceId: number
                    
                };
GetDatarecordContent: {
                    datarecordId: number
workspaceId: number
                    
                };
AppendRecord: {
                    datasourceId: number
requestBody: AppendRecordInput
workspaceId: number
                    
                };
    }

export type RecurringTasksData = {
        CreateRecurringTask: {
                    requestBody: RecurringTaskCreate
workspaceId: number
                    
                };
CreateRecurringTask1: {
                    requestBody: RecurringTaskCreate
workspaceId: number
                    
                };
ReadRecurringTasks: {
                    limit?: number
skip?: number
/**
 * Filter by task status
 */
status?: RecurringTaskStatus | null
workspaceId: number
                    
                };
ReadRecurringTasks1: {
                    limit?: number
skip?: number
/**
 * Filter by task status
 */
status?: RecurringTaskStatus | null
workspaceId: number
                    
                };
CreateRecurringTask2: {
                    requestBody: RecurringTaskCreate
workspaceId: number
                    
                };
CreateRecurringTask3: {
                    requestBody: RecurringTaskCreate
workspaceId: number
                    
                };
ReadRecurringTasks2: {
                    limit?: number
skip?: number
/**
 * Filter by task status
 */
status?: RecurringTaskStatus | null
workspaceId: number
                    
                };
ReadRecurringTasks3: {
                    limit?: number
skip?: number
/**
 * Filter by task status
 */
status?: RecurringTaskStatus | null
workspaceId: number
                    
                };
ReadRecurringTask: {
                    taskId: number
workspaceId: number
                    
                };
ReadRecurringTask1: {
                    taskId: number
workspaceId: number
                    
                };
UpdateRecurringTask: {
                    requestBody: RecurringTaskUpdate
taskId: number
workspaceId: number
                    
                };
UpdateRecurringTask1: {
                    requestBody: RecurringTaskUpdate
taskId: number
workspaceId: number
                    
                };
DeleteRecurringTask: {
                    taskId: number
workspaceId: number
                    
                };
DeleteRecurringTask1: {
                    taskId: number
workspaceId: number
                    
                };
    }

export type DatasetsData = {
        CreateDataset: {
                    requestBody: DatasetCreate
workspaceId: number
                    
                };
ListDatasets: {
                    limit?: number
skip?: number
workspaceId: number
                    
                };
CreateDataset1: {
                    requestBody: DatasetCreate
workspaceId: number
                    
                };
ListDatasets1: {
                    limit?: number
skip?: number
workspaceId: number
                    
                };
GetDataset: {
                    datasetId: number
workspaceId: number
                    
                };
UpdateDataset: {
                    datasetId: number
requestBody: DatasetUpdate
workspaceId: number
                    
                };
DeleteDataset: {
                    datasetId: number
workspaceId: number
                    
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
workspaceId: number
                    
                };
ImportDataset: {
                    /**
 * How to handle conflicts
 */
conflictStrategy?: string
formData: Body_datasets_import_dataset
workspaceId: number
                    
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
/**
 * Share token for the dataset
 */
shareToken: string
workspaceId: number
                    
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

export type GeoData = {
        GeojsonEventsView: {
                    /**
 * ISO formatted end date (e.g. 2023-12-31T23:59:59+00:00)
 */
endDate?: string
eventType: string
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
                    /**
 * ISO formatted end date (e.g. 2023-12-31T23:59:59+00:00)
 */
endDate?: string
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

export type ClassificationData = {
        
    }

export type ScoresData = {
        GetEntityScoresInTimeframe: {
                    entity: string
timeframeFrom?: string
timeframeTo?: string
                    
                };
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

}

export class ItemsService {

	/**
	 * Read Items
	 * Retrieve items.
	 * @returns ItemsOut Successful Response
	 * @throws ApiError
	 */
	public static readItems(data: ItemsData['ReadItems'] = {}): CancelablePromise<ItemsOut> {
		const {
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/items/',
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Item
	 * Create new item.
	 * @returns ItemOut Successful Response
	 * @throws ApiError
	 */
	public static createItem(data: ItemsData['CreateItem']): CancelablePromise<ItemOut> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/items/',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Item
	 * Get item by ID.
	 * @returns ItemOut Successful Response
	 * @throws ApiError
	 */
	public static readItem(data: ItemsData['ReadItem']): CancelablePromise<ItemOut> {
		const {
id,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/items/{id}',
			path: {
				id
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Item
	 * Update an item.
	 * @returns ItemOut Successful Response
	 * @throws ApiError
	 */
	public static updateItem(data: ItemsData['UpdateItem']): CancelablePromise<ItemOut> {
		const {
id,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v1/items/{id}',
			path: {
				id
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Item
	 * Delete an item.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static deleteItem(data: ItemsData['DeleteItem']): CancelablePromise<Message> {
		const {
id,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/items/{id}',
			path: {
				id
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
	 * Create a new shareable link for a resource.
 * Transaction managed by SessionDep.
	 * @returns ShareableLinkRead Successful Response
	 * @throws ApiError
	 */
	public static createShareableLink(data: ShareablesData['CreateShareableLink']): CancelablePromise<ShareableLinkRead> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/shareables/shareables/',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Shareable Links
	 * Get all shareable links for the current user.
 * Can be filtered by resource_type and resource_id.
	 * @returns ShareableLinkRead Successful Response
	 * @throws ApiError
	 */
	public static getShareableLinks(data: ShareablesData['GetShareableLinks'] = {}): CancelablePromise<Array<ShareableLinkRead>> {
		const {
resourceType,
resourceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/shareables/shareables/',
			query: {
				resource_type: resourceType, resource_id: resourceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Shareable Link Stats
	 * Get statistics about shareable links for the current user.
	 * @returns ShareableLinkStats Successful Response
	 * @throws ApiError
	 */
	public static getShareableLinkStats(): CancelablePromise<ShareableLinkStats> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/shareables/shareables/stats',
		});
	}

	/**
	 * Get Shareable Link
	 * Get a specific shareable link by ID.
	 * @returns ShareableLinkRead Successful Response
	 * @throws ApiError
	 */
	public static getShareableLink(data: ShareablesData['GetShareableLink']): CancelablePromise<ShareableLinkRead> {
		const {
linkId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/shareables/shareables/{link_id}',
			path: {
				link_id: linkId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Shareable Link
	 * Update a shareable link by ID.
 * Transaction managed by SessionDep.
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
			url: '/api/v1/shareables/shareables/{link_id}',
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
	 * Delete a shareable link by ID.
 * Transaction managed by SessionDep.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static deleteShareableLink(data: ShareablesData['DeleteShareableLink']): CancelablePromise<Message> {
		const {
linkId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/shareables/shareables/{link_id}',
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
	 * Access a shared resource using its token.
 * Can be accessed with or without authentication depending on the link settings.
 * Authentication errors are suppressed to allow access to public resources.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static accessSharedResource(data: ShareablesData['AccessSharedResource']): CancelablePromise<unknown> {
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
	 * Export Resource
	 * Export a resource to a file.
 * Returns a file download.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static exportResource(data: ShareablesData['ExportResource']): CancelablePromise<unknown> {
		const {
resourceType,
resourceId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/shareables/shareables/export',
			query: {
				resource_type: resourceType, resource_id: resourceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Import Resource
	 * Import a resource from a file into a specific workspace.
 * Transaction managed by SessionDep.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static importResource(data: ShareablesData['ImportResource']): CancelablePromise<unknown> {
		const {
workspaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/shareables/shareables/import/{workspace_id}',
			path: {
				workspace_id: workspaceId
			},
			formData: formData,
			mediaType: 'multipart/form-data',
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
	 * @returns SearchHistory Successful Response
	 * @throws ApiError
	 */
	public static createSearchHistory(data: SearchHistoryData['CreateSearchHistory']): CancelablePromise<SearchHistory> {
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
			url: '/api/v1/files/files/',
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
			url: '/api/v1/files/files/',
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
	 * List all files in the storage bucket.
 * Note: This might list files for all users depending on bucket setup.
 * Consider adding user-specific prefix filtering if needed.
	 * @returns string Successful Response
	 * @throws ApiError
	 */
	public static listFiles(): CancelablePromise<Array<string>> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/files/files/list',
			errors: {
				401: `Unauthorized`,
				500: `Internal Server Error`,
			},
		});
	}

	/**
	 * Delete File
	 * Delete a file (object) from the storage provider.
 * Requires the full object name/path.
 * TODO: Add authorization check - does this user own this file?
 * (e.g., check if object_name starts with f"user_{current_user.id}/")
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deleteFile(data: FilestorageData['DeleteFile']): CancelablePromise<unknown> {
		const {
objectName,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/files/files/{object_name}',
			path: {
				object_name: objectName
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
			url: '/api/v1/files/files/',
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
			url: '/api/v1/files/files/',
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
	 * List all files in the storage bucket.
 * Note: This might list files for all users depending on bucket setup.
 * Consider adding user-specific prefix filtering if needed.
	 * @returns string Successful Response
	 * @throws ApiError
	 */
	public static listFiles(): CancelablePromise<Array<string>> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/files/files/list',
			errors: {
				401: `Unauthorized`,
				500: `Internal Server Error`,
			},
		});
	}

	/**
	 * Delete File
	 * Delete a file (object) from the storage provider.
 * Requires the full object name/path.
 * TODO: Add authorization check - does this user own this file?
 * (e.g., check if object_name starts with f"user_{current_user.id}/")
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deleteFile(data: FilesData['DeleteFile']): CancelablePromise<unknown> {
		const {
objectName,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/files/files/{object_name}',
			path: {
				object_name: objectName
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

export class WorkspacesService {

	/**
	 * Create Workspace
	 * Create a new workspace.
	 * @returns WorkspaceRead Successful Response
	 * @throws ApiError
	 */
	public static createWorkspace(data: WorkspacesData['CreateWorkspace']): CancelablePromise<WorkspaceRead> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Workspaces
	 * Retrieve all workspaces for the current user.
	 * @returns WorkspaceRead Successful Response
	 * @throws ApiError
	 */
	public static readWorkspaces(data: WorkspacesData['ReadWorkspaces'] = {}): CancelablePromise<Array<WorkspaceRead>> {
		const {
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/',
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Workspace
	 * Create a new workspace.
	 * @returns WorkspaceRead Successful Response
	 * @throws ApiError
	 */
	public static createWorkspace1(data: WorkspacesData['CreateWorkspace1']): CancelablePromise<WorkspaceRead> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Workspaces
	 * Retrieve all workspaces for the current user.
	 * @returns WorkspaceRead Successful Response
	 * @throws ApiError
	 */
	public static readWorkspaces1(data: WorkspacesData['ReadWorkspaces1'] = {}): CancelablePromise<Array<WorkspaceRead>> {
		const {
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces',
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Workspace By Id
	 * Get a specific workspace by ID.
	 * @returns WorkspaceRead Successful Response
	 * @throws ApiError
	 */
	public static readWorkspaceById(data: WorkspacesData['ReadWorkspaceById']): CancelablePromise<WorkspaceRead> {
		const {
workspaceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}',
			path: {
				workspace_id: workspaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Workspace
	 * Update an existing workspace.
	 * @returns WorkspaceRead Successful Response
	 * @throws ApiError
	 */
	public static updateWorkspace(data: WorkspacesData['UpdateWorkspace']): CancelablePromise<WorkspaceRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/workspaces/{workspace_id}',
			path: {
				workspace_id: workspaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Workspace
	 * Delete a workspace.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static deleteWorkspace(data: WorkspacesData['DeleteWorkspace']): CancelablePromise<Message> {
		const {
workspaceId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}',
			path: {
				workspace_id: workspaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Ensure Default Workspace
	 * Ensure a default workspace exists for the user.
	 * @returns WorkspaceRead Successful Response
	 * @throws ApiError
	 */
	public static ensureDefaultWorkspace(): CancelablePromise<WorkspaceRead> {
				return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/ensure-default',
		});
	}

	/**
	 * Transfer Datasources Endpoint
	 * Transfer (copy or move) DataSources between workspaces.
 * Requires ownership or appropriate permissions for both source and target workspaces.
	 * @returns DataSourceTransferResponse Successful Response
	 * @throws ApiError
	 */
	public static transferDatasourcesEndpoint(data: WorkspacesData['TransferDatasourcesEndpoint']): CancelablePromise<DataSourceTransferResponse> {
		const {
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/transfer/datasources',
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				400: `Invalid request (e.g., same workspace, no IDs)`,
				401: `Not authenticated`,
				403: `Not authorized to access workspaces`,
				404: `One or more workspaces/datasources not found`,
				422: `Validation Error`,
				500: `Internal server error during transfer`,
			},
		});
	}

}

export class ClassificationSchemesService {

	/**
	 * Create Classification Scheme
	 * Create a new classification scheme using the service.
	 * @returns ClassificationSchemeRead Successful Response
	 * @throws ApiError
	 */
	public static createClassificationScheme(data: ClassificationSchemesData['CreateClassificationScheme']): CancelablePromise<ClassificationSchemeRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes',
			path: {
				workspace_id: workspaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Classification Scheme
	 * Create a new classification scheme using the service.
	 * @returns ClassificationSchemeRead Successful Response
	 * @throws ApiError
	 */
	public static createClassificationScheme1(data: ClassificationSchemesData['CreateClassificationScheme1']): CancelablePromise<ClassificationSchemeRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes',
			path: {
				workspace_id: workspaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Classification Schemes
	 * Retrieve classification schemes for the workspace using the service.
	 * @returns ClassificationSchemeRead Successful Response
	 * @throws ApiError
	 */
	public static readClassificationSchemes(data: ClassificationSchemesData['ReadClassificationSchemes']): CancelablePromise<Array<ClassificationSchemeRead>> {
		const {
workspaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes',
			path: {
				workspace_id: workspaceId
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
	 * Read Classification Schemes
	 * Retrieve classification schemes for the workspace using the service.
	 * @returns ClassificationSchemeRead Successful Response
	 * @throws ApiError
	 */
	public static readClassificationSchemes1(data: ClassificationSchemesData['ReadClassificationSchemes1']): CancelablePromise<Array<ClassificationSchemeRead>> {
		const {
workspaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes',
			path: {
				workspace_id: workspaceId
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
	 * Delete All Classification Schemes
	 * Delete all classification schemes in a workspace using the service.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deleteAllClassificationSchemes(data: ClassificationSchemesData['DeleteAllClassificationSchemes']): CancelablePromise<unknown> {
		const {
workspaceId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes',
			path: {
				workspace_id: workspaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete All Classification Schemes
	 * Delete all classification schemes in a workspace using the service.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deleteAllClassificationSchemes1(data: ClassificationSchemesData['DeleteAllClassificationSchemes1']): CancelablePromise<unknown> {
		const {
workspaceId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes',
			path: {
				workspace_id: workspaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Classification Scheme
	 * Create a new classification scheme using the service.
	 * @returns ClassificationSchemeRead Successful Response
	 * @throws ApiError
	 */
	public static createClassificationScheme2(data: ClassificationSchemesData['CreateClassificationScheme2']): CancelablePromise<ClassificationSchemeRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes/',
			path: {
				workspace_id: workspaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Classification Scheme
	 * Create a new classification scheme using the service.
	 * @returns ClassificationSchemeRead Successful Response
	 * @throws ApiError
	 */
	public static createClassificationScheme3(data: ClassificationSchemesData['CreateClassificationScheme3']): CancelablePromise<ClassificationSchemeRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes/',
			path: {
				workspace_id: workspaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Classification Schemes
	 * Retrieve classification schemes for the workspace using the service.
	 * @returns ClassificationSchemeRead Successful Response
	 * @throws ApiError
	 */
	public static readClassificationSchemes2(data: ClassificationSchemesData['ReadClassificationSchemes2']): CancelablePromise<Array<ClassificationSchemeRead>> {
		const {
workspaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes/',
			path: {
				workspace_id: workspaceId
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
	 * Read Classification Schemes
	 * Retrieve classification schemes for the workspace using the service.
	 * @returns ClassificationSchemeRead Successful Response
	 * @throws ApiError
	 */
	public static readClassificationSchemes3(data: ClassificationSchemesData['ReadClassificationSchemes3']): CancelablePromise<Array<ClassificationSchemeRead>> {
		const {
workspaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes/',
			path: {
				workspace_id: workspaceId
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
	 * Delete All Classification Schemes
	 * Delete all classification schemes in a workspace using the service.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deleteAllClassificationSchemes2(data: ClassificationSchemesData['DeleteAllClassificationSchemes2']): CancelablePromise<unknown> {
		const {
workspaceId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes/',
			path: {
				workspace_id: workspaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete All Classification Schemes
	 * Delete all classification schemes in a workspace using the service.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deleteAllClassificationSchemes3(data: ClassificationSchemesData['DeleteAllClassificationSchemes3']): CancelablePromise<unknown> {
		const {
workspaceId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes/',
			path: {
				workspace_id: workspaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Classification Scheme
	 * Retrieve a specific classification scheme using the service.
	 * @returns ClassificationSchemeRead Successful Response
	 * @throws ApiError
	 */
	public static readClassificationScheme(data: ClassificationSchemesData['ReadClassificationScheme']): CancelablePromise<ClassificationSchemeRead> {
		const {
workspaceId,
schemeId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes/{scheme_id}',
			path: {
				workspace_id: workspaceId, scheme_id: schemeId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Classification Scheme
	 * Retrieve a specific classification scheme using the service.
	 * @returns ClassificationSchemeRead Successful Response
	 * @throws ApiError
	 */
	public static readClassificationScheme1(data: ClassificationSchemesData['ReadClassificationScheme1']): CancelablePromise<ClassificationSchemeRead> {
		const {
workspaceId,
schemeId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes/{scheme_id}',
			path: {
				workspace_id: workspaceId, scheme_id: schemeId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Classification Scheme
	 * Update a classification scheme using the service.
	 * @returns ClassificationSchemeRead Successful Response
	 * @throws ApiError
	 */
	public static updateClassificationScheme(data: ClassificationSchemesData['UpdateClassificationScheme']): CancelablePromise<ClassificationSchemeRead> {
		const {
workspaceId,
schemeId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes/{scheme_id}',
			path: {
				workspace_id: workspaceId, scheme_id: schemeId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Classification Scheme
	 * Update a classification scheme using the service.
	 * @returns ClassificationSchemeRead Successful Response
	 * @throws ApiError
	 */
	public static updateClassificationScheme1(data: ClassificationSchemesData['UpdateClassificationScheme1']): CancelablePromise<ClassificationSchemeRead> {
		const {
workspaceId,
schemeId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes/{scheme_id}',
			path: {
				workspace_id: workspaceId, scheme_id: schemeId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Classification Scheme
	 * Delete a classification scheme using the service.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteClassificationScheme(data: ClassificationSchemesData['DeleteClassificationScheme']): CancelablePromise<void> {
		const {
workspaceId,
schemeId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes/{scheme_id}',
			path: {
				workspace_id: workspaceId, scheme_id: schemeId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Classification Scheme
	 * Delete a classification scheme using the service.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteClassificationScheme1(data: ClassificationSchemesData['DeleteClassificationScheme1']): CancelablePromise<void> {
		const {
workspaceId,
schemeId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes/{scheme_id}',
			path: {
				workspace_id: workspaceId, scheme_id: schemeId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class ClassificationResultsService {

	/**
	 * Get Classification Result
	 * Retrieve an individual classification result by its ID using the service.
 * The service handles workspace/user authorization.
	 * @returns ClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static getClassificationResult(data: ClassificationResultsData['GetClassificationResult']): CancelablePromise<ClassificationResultRead> {
		const {
workspaceId,
resultId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_results/{result_id}',
			path: {
				workspace_id: workspaceId, result_id: resultId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Classification Result
	 * Retrieve an individual classification result by its ID using the service.
 * The service handles workspace/user authorization.
	 * @returns ClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static getClassificationResult1(data: ClassificationResultsData['GetClassificationResult1']): CancelablePromise<ClassificationResultRead> {
		const {
workspaceId,
resultId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_results/{result_id}',
			path: {
				workspace_id: workspaceId, result_id: resultId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Classification Results
	 * List classification results for the workspace, with optional filters, using the service.
 * The service handles workspace ownership verification and data fetching.
 * Returns enhanced results with calculated display_value.
	 * @returns EnhancedClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static listClassificationResults(data: ClassificationResultsData['ListClassificationResults']): CancelablePromise<Array<EnhancedClassificationResultRead>> {
		const {
workspaceId,
jobId,
datarecordIds,
schemeIds,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_results/',
			path: {
				workspace_id: workspaceId
			},
			query: {
				job_id: jobId, datarecord_ids: datarecordIds, scheme_ids: schemeIds, skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Classification Results
	 * List classification results for the workspace, with optional filters, using the service.
 * The service handles workspace ownership verification and data fetching.
 * Returns enhanced results with calculated display_value.
	 * @returns EnhancedClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static listClassificationResults1(data: ClassificationResultsData['ListClassificationResults1']): CancelablePromise<Array<EnhancedClassificationResultRead>> {
		const {
workspaceId,
jobId,
datarecordIds,
schemeIds,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_results/',
			path: {
				workspace_id: workspaceId
			},
			query: {
				job_id: jobId, datarecord_ids: datarecordIds, scheme_ids: schemeIds, skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Classification Results
	 * List classification results for the workspace, with optional filters, using the service.
 * The service handles workspace ownership verification and data fetching.
 * Returns enhanced results with calculated display_value.
	 * @returns EnhancedClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static listClassificationResults2(data: ClassificationResultsData['ListClassificationResults2']): CancelablePromise<Array<EnhancedClassificationResultRead>> {
		const {
workspaceId,
jobId,
datarecordIds,
schemeIds,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_results',
			path: {
				workspace_id: workspaceId
			},
			query: {
				job_id: jobId, datarecord_ids: datarecordIds, scheme_ids: schemeIds, skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Classification Results
	 * List classification results for the workspace, with optional filters, using the service.
 * The service handles workspace ownership verification and data fetching.
 * Returns enhanced results with calculated display_value.
	 * @returns EnhancedClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static listClassificationResults3(data: ClassificationResultsData['ListClassificationResults3']): CancelablePromise<Array<EnhancedClassificationResultRead>> {
		const {
workspaceId,
jobId,
datarecordIds,
schemeIds,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_results',
			path: {
				workspace_id: workspaceId
			},
			query: {
				job_id: jobId, datarecord_ids: datarecordIds, scheme_ids: schemeIds, skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Job Results
	 * Retrieve all classification results for a specific ClassificationJob using the service.
 * The service handles job ownership and workspace context verification.
 * Returns enhanced results with calculated display_value.
	 * @returns EnhancedClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static getJobResults(data: ClassificationResultsData['GetJobResults']): CancelablePromise<Array<EnhancedClassificationResultRead>> {
		const {
workspaceId,
jobId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_jobs/{job_id}/results',
			path: {
				workspace_id: workspaceId, job_id: jobId
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
	 * Get Job Results
	 * Retrieve all classification results for a specific ClassificationJob using the service.
 * The service handles job ownership and workspace context verification.
 * Returns enhanced results with calculated display_value.
	 * @returns EnhancedClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static getJobResults1(data: ClassificationResultsData['GetJobResults1']): CancelablePromise<Array<EnhancedClassificationResultRead>> {
		const {
workspaceId,
jobId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_jobs/{job_id}/results',
			path: {
				workspace_id: workspaceId, job_id: jobId
			},
			query: {
				skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class ClassificationJobsService {

	/**
	 * Create Classification Job
	 * Create a new Classification Job.
	 * @returns ClassificationJobRead Successful Response
	 * @throws ApiError
	 */
	public static createClassificationJob(data: ClassificationJobsData['CreateClassificationJob']): CancelablePromise<ClassificationJobRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/classification_jobs/',
			path: {
				workspace_id: workspaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Classification Job
	 * Create a new Classification Job.
	 * @returns ClassificationJobRead Successful Response
	 * @throws ApiError
	 */
	public static createClassificationJob1(data: ClassificationJobsData['CreateClassificationJob1']): CancelablePromise<ClassificationJobRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/classification_jobs/',
			path: {
				workspace_id: workspaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Classification Jobs
	 * Retrieve Classification Jobs for the workspace.
	 * @returns ClassificationJobsOut Successful Response
	 * @throws ApiError
	 */
	public static listClassificationJobs(data: ClassificationJobsData['ListClassificationJobs']): CancelablePromise<ClassificationJobsOut> {
		const {
workspaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_jobs/',
			path: {
				workspace_id: workspaceId
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
	 * List Classification Jobs
	 * Retrieve Classification Jobs for the workspace.
	 * @returns ClassificationJobsOut Successful Response
	 * @throws ApiError
	 */
	public static listClassificationJobs1(data: ClassificationJobsData['ListClassificationJobs1']): CancelablePromise<ClassificationJobsOut> {
		const {
workspaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_jobs/',
			path: {
				workspace_id: workspaceId
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
	 * Create Classification Job
	 * Create a new Classification Job.
	 * @returns ClassificationJobRead Successful Response
	 * @throws ApiError
	 */
	public static createClassificationJob2(data: ClassificationJobsData['CreateClassificationJob2']): CancelablePromise<ClassificationJobRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/classification_jobs',
			path: {
				workspace_id: workspaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Classification Job
	 * Create a new Classification Job.
	 * @returns ClassificationJobRead Successful Response
	 * @throws ApiError
	 */
	public static createClassificationJob3(data: ClassificationJobsData['CreateClassificationJob3']): CancelablePromise<ClassificationJobRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/classification_jobs',
			path: {
				workspace_id: workspaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Classification Jobs
	 * Retrieve Classification Jobs for the workspace.
	 * @returns ClassificationJobsOut Successful Response
	 * @throws ApiError
	 */
	public static listClassificationJobs2(data: ClassificationJobsData['ListClassificationJobs2']): CancelablePromise<ClassificationJobsOut> {
		const {
workspaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_jobs',
			path: {
				workspace_id: workspaceId
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
	 * List Classification Jobs
	 * Retrieve Classification Jobs for the workspace.
	 * @returns ClassificationJobsOut Successful Response
	 * @throws ApiError
	 */
	public static listClassificationJobs3(data: ClassificationJobsData['ListClassificationJobs3']): CancelablePromise<ClassificationJobsOut> {
		const {
workspaceId,
skip = 0,
limit = 100,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_jobs',
			path: {
				workspace_id: workspaceId
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
	 * Get Classification Job
	 * Retrieve a specific Classification Job by its ID.
	 * @returns ClassificationJobRead Successful Response
	 * @throws ApiError
	 */
	public static getClassificationJob(data: ClassificationJobsData['GetClassificationJob']): CancelablePromise<ClassificationJobRead> {
		const {
workspaceId,
jobId,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_jobs/{job_id}',
			path: {
				workspace_id: workspaceId, job_id: jobId
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
	 * Get Classification Job
	 * Retrieve a specific Classification Job by its ID.
	 * @returns ClassificationJobRead Successful Response
	 * @throws ApiError
	 */
	public static getClassificationJob1(data: ClassificationJobsData['GetClassificationJob1']): CancelablePromise<ClassificationJobRead> {
		const {
workspaceId,
jobId,
includeCounts = true,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_jobs/{job_id}',
			path: {
				workspace_id: workspaceId, job_id: jobId
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
	 * Update Classification Job
	 * Update a Classification Job.
	 * @returns ClassificationJobRead Successful Response
	 * @throws ApiError
	 */
	public static updateClassificationJob(data: ClassificationJobsData['UpdateClassificationJob']): CancelablePromise<ClassificationJobRead> {
		const {
workspaceId,
jobId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/workspaces/{workspace_id}/classification_jobs/{job_id}',
			path: {
				workspace_id: workspaceId, job_id: jobId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Classification Job
	 * Update a Classification Job.
	 * @returns ClassificationJobRead Successful Response
	 * @throws ApiError
	 */
	public static updateClassificationJob1(data: ClassificationJobsData['UpdateClassificationJob1']): CancelablePromise<ClassificationJobRead> {
		const {
workspaceId,
jobId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/workspaces/{workspace_id}/classification_jobs/{job_id}',
			path: {
				workspace_id: workspaceId, job_id: jobId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Classification Job
	 * Delete a Classification Job.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteClassificationJob(data: ClassificationJobsData['DeleteClassificationJob']): CancelablePromise<void> {
		const {
workspaceId,
jobId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/classification_jobs/{job_id}',
			path: {
				workspace_id: workspaceId, job_id: jobId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Classification Job
	 * Delete a Classification Job.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteClassificationJob1(data: ClassificationJobsData['DeleteClassificationJob1']): CancelablePromise<void> {
		const {
workspaceId,
jobId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/classification_jobs/{job_id}',
			path: {
				workspace_id: workspaceId, job_id: jobId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class DatasourcesService {

	/**
	 * Create Datasource
	 * Creates a new DataSource. Handles single/bulk PDF uploads based on file count.
	 * @returns DataSourcesOut Successful Response
	 * @throws ApiError
	 */
	public static createDatasource(data: DatasourcesData['CreateDatasource']): CancelablePromise<DataSourcesOut> {
		const {
workspaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/datasources/',
			path: {
				workspace_id: workspaceId
			},
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Datasources
	 * List DataSources in a workspace.
	 * @returns DataSourcesOut Successful Response
	 * @throws ApiError
	 */
	public static listDatasources(data: DatasourcesData['ListDatasources']): CancelablePromise<DataSourcesOut> {
		const {
workspaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/datasources/',
			path: {
				workspace_id: workspaceId
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
	 * Create Datasource
	 * Creates a new DataSource. Handles single/bulk PDF uploads based on file count.
	 * @returns DataSourcesOut Successful Response
	 * @throws ApiError
	 */
	public static createDatasource1(data: DatasourcesData['CreateDatasource1']): CancelablePromise<DataSourcesOut> {
		const {
workspaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/datasources',
			path: {
				workspace_id: workspaceId
			},
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Datasources
	 * List DataSources in a workspace.
	 * @returns DataSourcesOut Successful Response
	 * @throws ApiError
	 */
	public static listDatasources1(data: DatasourcesData['ListDatasources1']): CancelablePromise<DataSourcesOut> {
		const {
workspaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/datasources',
			path: {
				workspace_id: workspaceId
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
	 * Get Datasource
	 * Get a specific DataSource.
	 * @returns DataSourceRead Successful Response
	 * @throws ApiError
	 */
	public static getDatasource(data: DatasourcesData['GetDatasource']): CancelablePromise<DataSourceRead> {
		const {
workspaceId,
datasourceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/datasources/{datasource_id}',
			path: {
				workspace_id: workspaceId, datasource_id: datasourceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Datasource
	 * Delete a DataSource.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteDatasource(data: DatasourcesData['DeleteDatasource']): CancelablePromise<void> {
		const {
workspaceId,
datasourceId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/datasources/{datasource_id}',
			path: {
				workspace_id: workspaceId, datasource_id: datasourceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Datasource
	 * Update an existing DataSource.
	 * @returns DataSourceRead Successful Response
	 * @throws ApiError
	 */
	public static updateDatasource(data: DatasourcesData['UpdateDatasource']): CancelablePromise<DataSourceRead> {
		const {
workspaceId,
datasourceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v1/workspaces/{workspace_id}/datasources/{datasource_id}',
			path: {
				workspace_id: workspaceId, datasource_id: datasourceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Datasource Urls
	 * Get the list of URLs for a URL_LIST DataSource.
	 * @returns string Successful Response
	 * @throws ApiError
	 */
	public static getDatasourceUrls(data: DatasourcesData['GetDatasourceUrls']): CancelablePromise<Array<string>> {
		const {
workspaceId,
datasourceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/datasources/{datasource_id}/urls',
			path: {
				workspace_id: workspaceId, datasource_id: datasourceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Datasource Urls
	 * Update the list of URLs for a URL_LIST DataSource.
 * Replaces the existing list entirely. If URLs are removed,
 * their corresponding DataRecords will be deleted.
	 * @returns DataSourceRead Successful Response
	 * @throws ApiError
	 */
	public static updateDatasourceUrls(data: DatasourcesData['UpdateDatasourceUrls']): CancelablePromise<DataSourceRead> {
		const {
workspaceId,
datasourceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PUT',
			url: '/api/v1/workspaces/{workspace_id}/datasources/{datasource_id}/urls',
			path: {
				workspace_id: workspaceId, datasource_id: datasourceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Datasource Rows
	 * Get rows from a CSV DataSource.
	 * @returns CsvRowsOut Successful Response
	 * @throws ApiError
	 */
	public static readDatasourceRows(data: DatasourcesData['ReadDatasourceRows']): CancelablePromise<CsvRowsOut> {
		const {
workspaceId,
datasourceId,
skip = 0,
limit = 50,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/datasources/{datasource_id}/rows',
			path: {
				workspace_id: workspaceId, datasource_id: datasourceId
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
	 * Refetch Datasource
	 * Trigger a background re-ingestion task for a DataSource.
	 * @returns Message Successful Response
	 * @throws ApiError
	 */
	public static refetchDatasource(data: DatasourcesData['RefetchDatasource']): CancelablePromise<Message> {
		const {
workspaceId,
datasourceId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/datasources/{datasource_id}/refetch',
			path: {
				workspace_id: workspaceId, datasource_id: datasourceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Datasource Content
	 * Get the raw content of a PDF DataSource.
	 * @returns any Successful Response
	 * @throws ApiError
	 */
	public static getDatasourceContent(data: DatasourcesData['GetDatasourceContent']): CancelablePromise<any> {
		const {
workspaceId,
datasourceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/datasources/{datasource_id}/content',
			path: {
				workspace_id: workspaceId, datasource_id: datasourceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Download Datasource Pdf
	 * Download the PDF file for a DataSource.
	 * @returns any Successful Response
	 * @throws ApiError
	 */
	public static downloadDatasourcePdf(data: DatasourcesData['DownloadDatasourcePdf']): CancelablePromise<any> {
		const {
workspaceId,
datasourceId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/datasources/{datasource_id}/pdf_download',
			path: {
				workspace_id: workspaceId, datasource_id: datasourceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class DatarecordsService {

	/**
	 * Get Datarecord
	 * Get a specific DataRecord.
	 * @returns DataRecordRead Successful Response
	 * @throws ApiError
	 */
	public static getDatarecord(data: DatarecordsData['GetDatarecord']): CancelablePromise<DataRecordRead> {
		const {
workspaceId,
datarecordId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/datarecords/{datarecord_id}',
			path: {
				workspace_id: workspaceId, datarecord_id: datarecordId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Datarecords
	 * List DataRecords for a specific DataSource.
	 * @returns DataRecordRead Successful Response
	 * @throws ApiError
	 */
	public static listDatarecords(data: DatarecordsData['ListDatarecords']): CancelablePromise<Array<DataRecordRead>> {
		const {
workspaceId,
datasourceId,
skip = 0,
limit = 1000,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/datarecords/by_datasource/{datasource_id}',
			path: {
				workspace_id: workspaceId, datasource_id: datasourceId
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
	 * Get Datarecord Content
	 * Get the raw content of the file associated with a DataRecord (primarily for PDFs).
	 * @returns any Successful Response
	 * @throws ApiError
	 */
	public static getDatarecordContent(data: DatarecordsData['GetDatarecordContent']): CancelablePromise<any> {
		const {
workspaceId,
datarecordId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/datarecords/{datarecord_id}/content',
			path: {
				workspace_id: workspaceId, datarecord_id: datarecordId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Append Record
	 * Append a record to a DataSource.
	 * @returns DataRecordRead Successful Response
	 * @throws ApiError
	 */
	public static appendRecord(data: DatarecordsData['AppendRecord']): CancelablePromise<DataRecordRead> {
		const {
workspaceId,
datasourceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/datarecords/by_datasource/{datasource_id}/records',
			path: {
				workspace_id: workspaceId, datasource_id: datasourceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class RecurringTasksService {

	/**
	 * Create Recurring Task
	 * Create a new Recurring Task using the service.
	 * @returns RecurringTaskRead Successful Response
	 * @throws ApiError
	 */
	public static createRecurringTask(data: RecurringTasksData['CreateRecurringTask']): CancelablePromise<RecurringTaskRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/recurring_tasks/',
			path: {
				workspace_id: workspaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Recurring Task
	 * Create a new Recurring Task using the service.
	 * @returns RecurringTaskRead Successful Response
	 * @throws ApiError
	 */
	public static createRecurringTask1(data: RecurringTasksData['CreateRecurringTask1']): CancelablePromise<RecurringTaskRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/recurring_tasks/',
			path: {
				workspace_id: workspaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Recurring Tasks
	 * Retrieve Recurring Tasks for the workspace using the service.
	 * @returns RecurringTasksOut Successful Response
	 * @throws ApiError
	 */
	public static readRecurringTasks(data: RecurringTasksData['ReadRecurringTasks']): CancelablePromise<RecurringTasksOut> {
		const {
workspaceId,
skip = 0,
limit = 100,
status,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/recurring_tasks/',
			path: {
				workspace_id: workspaceId
			},
			query: {
				skip, limit, status
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Recurring Tasks
	 * Retrieve Recurring Tasks for the workspace using the service.
	 * @returns RecurringTasksOut Successful Response
	 * @throws ApiError
	 */
	public static readRecurringTasks1(data: RecurringTasksData['ReadRecurringTasks1']): CancelablePromise<RecurringTasksOut> {
		const {
workspaceId,
skip = 0,
limit = 100,
status,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/recurring_tasks/',
			path: {
				workspace_id: workspaceId
			},
			query: {
				skip, limit, status
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Recurring Task
	 * Create a new Recurring Task using the service.
	 * @returns RecurringTaskRead Successful Response
	 * @throws ApiError
	 */
	public static createRecurringTask2(data: RecurringTasksData['CreateRecurringTask2']): CancelablePromise<RecurringTaskRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/recurring_tasks',
			path: {
				workspace_id: workspaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Recurring Task
	 * Create a new Recurring Task using the service.
	 * @returns RecurringTaskRead Successful Response
	 * @throws ApiError
	 */
	public static createRecurringTask3(data: RecurringTasksData['CreateRecurringTask3']): CancelablePromise<RecurringTaskRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/recurring_tasks',
			path: {
				workspace_id: workspaceId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Recurring Tasks
	 * Retrieve Recurring Tasks for the workspace using the service.
	 * @returns RecurringTasksOut Successful Response
	 * @throws ApiError
	 */
	public static readRecurringTasks2(data: RecurringTasksData['ReadRecurringTasks2']): CancelablePromise<RecurringTasksOut> {
		const {
workspaceId,
skip = 0,
limit = 100,
status,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/recurring_tasks',
			path: {
				workspace_id: workspaceId
			},
			query: {
				skip, limit, status
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Recurring Tasks
	 * Retrieve Recurring Tasks for the workspace using the service.
	 * @returns RecurringTasksOut Successful Response
	 * @throws ApiError
	 */
	public static readRecurringTasks3(data: RecurringTasksData['ReadRecurringTasks3']): CancelablePromise<RecurringTasksOut> {
		const {
workspaceId,
skip = 0,
limit = 100,
status,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/recurring_tasks',
			path: {
				workspace_id: workspaceId
			},
			query: {
				skip, limit, status
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Recurring Task
	 * Retrieve a specific Recurring Task by its ID using the service.
	 * @returns RecurringTaskRead Successful Response
	 * @throws ApiError
	 */
	public static readRecurringTask(data: RecurringTasksData['ReadRecurringTask']): CancelablePromise<RecurringTaskRead> {
		const {
workspaceId,
taskId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/recurring_tasks/{task_id}',
			path: {
				workspace_id: workspaceId, task_id: taskId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Recurring Task
	 * Retrieve a specific Recurring Task by its ID using the service.
	 * @returns RecurringTaskRead Successful Response
	 * @throws ApiError
	 */
	public static readRecurringTask1(data: RecurringTasksData['ReadRecurringTask1']): CancelablePromise<RecurringTaskRead> {
		const {
workspaceId,
taskId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/recurring_tasks/{task_id}',
			path: {
				workspace_id: workspaceId, task_id: taskId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Recurring Task
	 * Update a Recurring Task using the service.
	 * @returns RecurringTaskRead Successful Response
	 * @throws ApiError
	 */
	public static updateRecurringTask(data: RecurringTasksData['UpdateRecurringTask']): CancelablePromise<RecurringTaskRead> {
		const {
workspaceId,
taskId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/workspaces/{workspace_id}/recurring_tasks/{task_id}',
			path: {
				workspace_id: workspaceId, task_id: taskId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Recurring Task
	 * Update a Recurring Task using the service.
	 * @returns RecurringTaskRead Successful Response
	 * @throws ApiError
	 */
	public static updateRecurringTask1(data: RecurringTasksData['UpdateRecurringTask1']): CancelablePromise<RecurringTaskRead> {
		const {
workspaceId,
taskId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/workspaces/{workspace_id}/recurring_tasks/{task_id}',
			path: {
				workspace_id: workspaceId, task_id: taskId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Recurring Task
	 * Delete a Recurring Task using the service.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteRecurringTask(data: RecurringTasksData['DeleteRecurringTask']): CancelablePromise<void> {
		const {
workspaceId,
taskId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/recurring_tasks/{task_id}',
			path: {
				workspace_id: workspaceId, task_id: taskId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Recurring Task
	 * Delete a Recurring Task using the service.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteRecurringTask1(data: RecurringTasksData['DeleteRecurringTask1']): CancelablePromise<void> {
		const {
workspaceId,
taskId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/recurring_tasks/{task_id}',
			path: {
				workspace_id: workspaceId, task_id: taskId
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
	 * Create a new dataset within a specific workspace.
	 * @returns DatasetRead Successful Response
	 * @throws ApiError
	 */
	public static createDataset(data: DatasetsData['CreateDataset']): CancelablePromise<DatasetRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/datasets/',
			path: {
				workspace_id: workspaceId
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
	 * Retrieve datasets within a specific workspace.
	 * @returns DatasetsOut Successful Response
	 * @throws ApiError
	 */
	public static listDatasets(data: DatasetsData['ListDatasets']): CancelablePromise<DatasetsOut> {
		const {
workspaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/datasets/',
			path: {
				workspace_id: workspaceId
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
	 * Create a new dataset within a specific workspace.
	 * @returns DatasetRead Successful Response
	 * @throws ApiError
	 */
	public static createDataset1(data: DatasetsData['CreateDataset1']): CancelablePromise<DatasetRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/datasets',
			path: {
				workspace_id: workspaceId
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
	 * Retrieve datasets within a specific workspace.
	 * @returns DatasetsOut Successful Response
	 * @throws ApiError
	 */
	public static listDatasets1(data: DatasetsData['ListDatasets1']): CancelablePromise<DatasetsOut> {
		const {
workspaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/datasets',
			path: {
				workspace_id: workspaceId
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
workspaceId,
datasetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/datasets/{dataset_id}',
			path: {
				workspace_id: workspaceId, dataset_id: datasetId
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
workspaceId,
datasetId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/workspaces/{workspace_id}/datasets/{dataset_id}',
			path: {
				workspace_id: workspaceId, dataset_id: datasetId
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
workspaceId,
datasetId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/datasets/{dataset_id}',
			path: {
				workspace_id: workspaceId, dataset_id: datasetId
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
workspaceId,
datasetId,
includeContent = false,
includeResults = false,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/datasets/{dataset_id}/export',
			path: {
				workspace_id: workspaceId, dataset_id: datasetId
			},
			query: {
				include_content: includeContent, include_results: includeResults
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
workspaceId,
formData,
conflictStrategy = 'skip',
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/datasets/import',
			path: {
				workspace_id: workspaceId
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
	 * Import a dataset into the target workspace using a share token.
 * This internally performs an export from the source and then an import.
	 * @returns DatasetRead Successful Response
	 * @throws ApiError
	 */
	public static importDatasetFromToken(data: DatasetsData['ImportDatasetFromToken']): CancelablePromise<DatasetRead> {
		const {
workspaceId,
shareToken,
includeContent = false,
includeResults = false,
conflictStrategy = 'skip',
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/datasets/import_from_token',
			path: {
				workspace_id: workspaceId
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

export class GeoService {

	/**
	 * Geojson Events View
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static geojsonEventsView(data: GeoData['GeojsonEventsView']): CancelablePromise<unknown> {
		const {
eventType,
startDate,
endDate,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/geo/geojson_events',
			query: {
				event_type: eventType, start_date: startDate, end_date: endDate, limit
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
	public static geojsonRawView(data: GeoData['GeojsonRawView'] = {}): CancelablePromise<unknown> {
		const {
startDate,
endDate,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/geo/geojson',
			query: {
				start_date: startDate, end_date: endDate, limit
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

export class ClassificationService {

	/**
	 * Get Providers
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getProviders(): CancelablePromise<unknown> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/classification/available_providers',
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
timeframeTo = '2025-04-28',
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