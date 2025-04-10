import type { CancelablePromise } from './core/CancelablePromise';
import { OpenAPI } from './core/OpenAPI';
import { request as __request } from './core/request';

import type { Request,app__api__v1__search__routes__SearchType,MostRelevantEntitiesRequest,app__api__v1__entities__routes__SearchType,Body_login_login_access_token,Message,NewPassword,Token,UserOut,UpdatePassword,UserCreate,UserCreateOpen,UsersOut,UserUpdate,UserUpdateMe,Body_utils_extract_pdf_metadata,Body_utils_extract_pdf_text,ItemCreate,ItemOut,ItemsOut,ItemUpdate,SearchHistoriesOut,SearchHistory,SearchHistoryCreate,WorkspaceCreate,WorkspaceRead,WorkspaceUpdate,Body_documents_bulk_upload_documents,Body_documents_create_document,Body_documents_extract_document_metadata_from_pdf,DocumentRead,DocumentUpdate,FileRead,Body_filestorage_file_upload,FileUploadResponse,ClassificationResultRead,ClassificationSchemeCreate,ClassificationSchemeRead,ClassificationSchemeUpdate,SavedResultSetCreate,SavedResultSetRead,ClassificationResultCreate,EnhancedClassificationResultRead,ClassificationRunCreate,ClassificationRunRead,ClassificationRunsOut,ClassificationRunUpdate,ArticleResponse } from './models';

export type AppData = {
        
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

export type SearchHistoryData = {
        CreateSearchHistory: {
                    requestBody: SearchHistoryCreate
                    
                };
ReadSearchHistories: {
                    limit?: number
skip?: number
                    
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
    }

export type DocumentsData = {
        CreateDocument: {
                    formData: Body_documents_create_document
workspaceId: number
                    
                };
ReadDocuments: {
                    limit?: number
skip?: number
workspaceId: number
                    
                };
DeleteAllDocuments: {
                    workspaceId: number
                    
                };
CreateDocument1: {
                    formData: Body_documents_create_document
workspaceId: number
                    
                };
ReadDocuments1: {
                    limit?: number
skip?: number
workspaceId: number
                    
                };
DeleteAllDocuments1: {
                    workspaceId: number
                    
                };
ReadDocument: {
                    documentId: number
workspaceId: number
                    
                };
UpdateDocument: {
                    documentId: number
requestBody: DocumentUpdate
workspaceId: number
                    
                };
DeleteDocument: {
                    documentId: number
workspaceId: number
                    
                };
GetDocumentFiles: {
                    documentId: number
                    
                };
DeleteDocumentFile: {
                    documentId: number
fileId: number
                    
                };
DownloadFile: {
                    fileId: number
                    
                };
TransferDocuments: {
                    copy?: boolean
requestBody: Array<number>
targetWorkspaceId: number
workspaceId: number
                    
                };
ExtractPdfContent: {
                    documentId: number
fileId: number
workspaceId: number
                    
                };
BulkUploadDocuments: {
                    formData: Body_documents_bulk_upload_documents
workspaceId: number
                    
                };
ExtractDocumentMetadataFromPdf: {
                    formData: Body_documents_extract_document_metadata_from_pdf
                    
                };
    }

export type FilestorageData = {
        FileUpload: {
                    formData: Body_filestorage_file_upload
                    
                };
FileDownload: {
                    filePath: string
storageId: string
                    
                };
DeleteFile: {
                    filename: string
                    
                };
    }

export type FilesData = {
        FileUpload: {
                    formData: Body_filestorage_file_upload
                    
                };
FileDownload: {
                    filePath: string
storageId: string
                    
                };
DeleteFile: {
                    filename: string
                    
                };
    }

export type ClassificationSchemesData = {
        CreateSavedResultSet: {
                    requestBody: SavedResultSetCreate
workspaceId: number
                    
                };
ReadSavedResultSets: {
                    limit?: number
skip?: number
workspaceId: number
                    
                };
CreateClassificationScheme: {
                    requestBody: ClassificationSchemeCreate
workspaceId: number
                    
                };
ReadClassificationSchemes: {
                    limit?: number
skip?: number
workspaceId: number
                    
                };
DeleteAllClassificationSchemes: {
                    workspaceId: number
                    
                };
CreateClassificationScheme1: {
                    requestBody: ClassificationSchemeCreate
workspaceId: number
                    
                };
ReadClassificationSchemes1: {
                    limit?: number
skip?: number
workspaceId: number
                    
                };
DeleteAllClassificationSchemes1: {
                    workspaceId: number
                    
                };
ReadClassificationScheme: {
                    schemeId: number
workspaceId: number
                    
                };
UpdateClassificationScheme: {
                    requestBody: ClassificationSchemeUpdate
schemeId: number
workspaceId: number
                    
                };
DeleteClassificationScheme: {
                    schemeId: number
workspaceId: number
                    
                };
ClassifyDocument: {
                    documentId: number
schemeId: number
workspaceId: number
                    
                };
GetSavedResultSet: {
                    resultSetId: number
workspaceId: number
                    
                };
    }

export type ClassificationResultsData = {
        CreateClassificationResult: {
                    requestBody: ClassificationResultCreate
workspaceId: number
                    
                };
CreateClassificationResult1: {
                    requestBody: ClassificationResultCreate
workspaceId: number
                    
                };
ListClassificationResults: {
                    documentIds?: Array<number>
limit?: number
runName?: string | null
schemeIds?: Array<number>
skip?: number
workspaceId: number
                    
                };
ListClassificationResults1: {
                    documentIds?: Array<number>
limit?: number
runName?: string | null
schemeIds?: Array<number>
skip?: number
workspaceId: number
                    
                };
GetClassificationResult: {
                    resultId: number
workspaceId: number
                    
                };
GetClassificationResult1: {
                    resultId: number
workspaceId: number
                    
                };
ListClassificationResults2: {
                    documentIds?: Array<number>
limit?: number
runName?: string | null
schemeIds?: Array<number>
skip?: number
workspaceId: number
                    
                };
ListClassificationResults3: {
                    documentIds?: Array<number>
limit?: number
runName?: string | null
schemeIds?: Array<number>
skip?: number
workspaceId: number
                    
                };
GetResultsByRun: {
                    runId: number
workspaceId: number
                    
                };
GetResultsByRun1: {
                    runId: number
workspaceId: number
                    
                };
    }

export type ClassificationRunsData = {
        CreateClassificationRun: {
                    requestBody: ClassificationRunCreate
workspaceId: number
                    
                };
CreateClassificationRun1: {
                    requestBody: ClassificationRunCreate
workspaceId: number
                    
                };
CreateClassificationRun2: {
                    requestBody: ClassificationRunCreate
workspaceId: number
                    
                };
CreateClassificationRun3: {
                    requestBody: ClassificationRunCreate
workspaceId: number
                    
                };
ReadClassificationRuns: {
                    limit?: number
skip?: number
workspaceId: number
                    
                };
ReadClassificationRuns1: {
                    limit?: number
skip?: number
workspaceId: number
                    
                };
ReadClassificationRun: {
                    runId: number
                    
                };
ReadClassificationRun1: {
                    runId: number
                    
                };
UpdateClassificationRun: {
                    requestBody: ClassificationRunUpdate
runId: number
                    
                };
UpdateClassificationRun1: {
                    requestBody: ClassificationRunUpdate
runId: number
                    
                };
DeleteClassificationRun: {
                    runId: number
                    
                };
DeleteClassificationRun1: {
                    runId: number
                    
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
        GetLocationFromQuery: {
                    query: string
                    
                };
ClassifyDocument: {
                    documentId: number
model?: string | null
provider?: string | null
runDescription?: string | null
runId?: number | null
runName?: string | null
schemeId: number
xApiKey?: string | null
                    
                };
Classify: {
                    schemeId: number
text: string
xApiKey?: string | null
                    
                };
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
	public static getEntityDetails(data: EntitiesData['GetEntityDetails']): CancelablePromise<unknown> {
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
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deleteWorkspace(data: WorkspacesData['DeleteWorkspace']): CancelablePromise<unknown> {
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

}

export class DocumentsService {

	/**
	 * Create Document
	 * @returns DocumentRead Successful Response
	 * @throws ApiError
	 */
	public static createDocument(data: DocumentsData['CreateDocument']): CancelablePromise<DocumentRead> {
		const {
workspaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/documents/',
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
	 * Read Documents
	 * @returns DocumentRead Successful Response
	 * @throws ApiError
	 */
	public static readDocuments(data: DocumentsData['ReadDocuments']): CancelablePromise<Array<DocumentRead>> {
		const {
workspaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/documents/',
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
	 * Delete All Documents
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deleteAllDocuments(data: DocumentsData['DeleteAllDocuments']): CancelablePromise<unknown> {
		const {
workspaceId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/documents/',
			path: {
				workspace_id: workspaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Create Document
	 * @returns DocumentRead Successful Response
	 * @throws ApiError
	 */
	public static createDocument1(data: DocumentsData['CreateDocument1']): CancelablePromise<DocumentRead> {
		const {
workspaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/documents',
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
	 * Read Documents
	 * @returns DocumentRead Successful Response
	 * @throws ApiError
	 */
	public static readDocuments1(data: DocumentsData['ReadDocuments1']): CancelablePromise<Array<DocumentRead>> {
		const {
workspaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/documents',
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
	 * Delete All Documents
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deleteAllDocuments1(data: DocumentsData['DeleteAllDocuments1']): CancelablePromise<unknown> {
		const {
workspaceId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/documents',
			path: {
				workspace_id: workspaceId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Document
	 * @returns DocumentRead Successful Response
	 * @throws ApiError
	 */
	public static readDocument(data: DocumentsData['ReadDocument']): CancelablePromise<DocumentRead> {
		const {
workspaceId,
documentId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/documents/{document_id}',
			path: {
				workspace_id: workspaceId, document_id: documentId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Document
	 * @returns DocumentRead Successful Response
	 * @throws ApiError
	 */
	public static updateDocument(data: DocumentsData['UpdateDocument']): CancelablePromise<DocumentRead> {
		const {
workspaceId,
documentId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/workspaces/{workspace_id}/documents/{document_id}',
			path: {
				workspace_id: workspaceId, document_id: documentId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Document
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deleteDocument(data: DocumentsData['DeleteDocument']): CancelablePromise<unknown> {
		const {
workspaceId,
documentId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/documents/{document_id}',
			path: {
				workspace_id: workspaceId, document_id: documentId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Document Files
	 * @returns FileRead Successful Response
	 * @throws ApiError
	 */
	public static getDocumentFiles(data: DocumentsData['GetDocumentFiles']): CancelablePromise<Array<FileRead>> {
		const {
documentId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/documents/{document_id}/files',
			path: {
				document_id: documentId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Document File
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deleteDocumentFile(data: DocumentsData['DeleteDocumentFile']): CancelablePromise<unknown> {
		const {
documentId,
fileId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/documents/{document_id}/files/{file_id}',
			path: {
				document_id: documentId, file_id: fileId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Download File
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static downloadFile(data: DocumentsData['DownloadFile']): CancelablePromise<unknown> {
		const {
fileId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/documents/files/{file_id}/download',
			path: {
				file_id: fileId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Transfer Documents
	 * Transfer or copy documents to another workspace
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static transferDocuments(data: DocumentsData['TransferDocuments']): CancelablePromise<unknown> {
		const {
workspaceId,
targetWorkspaceId,
requestBody,
copy = false,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/documents/transfer',
			path: {
				workspace_id: workspaceId
			},
			query: {
				target_workspace_id: targetWorkspaceId, copy
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Extract Pdf Content
	 * Extract text content from a PDF file and update the document using PyMuPDF
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static extractPdfContent(data: DocumentsData['ExtractPdfContent']): CancelablePromise<unknown> {
		const {
workspaceId,
documentId,
fileId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/documents/{document_id}/extract_pdf_content',
			path: {
				workspace_id: workspaceId, document_id: documentId
			},
			query: {
				file_id: fileId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Bulk Upload Documents
	 * Bulk upload multiple PDF documents with optional metadata autofill.
 * 
 * If autofill is True, the system will attempt to extract metadata from each PDF.
	 * @returns DocumentRead Successful Response
	 * @throws ApiError
	 */
	public static bulkUploadDocuments(data: DocumentsData['BulkUploadDocuments']): CancelablePromise<Array<DocumentRead>> {
		const {
workspaceId,
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/documents/bulk-upload',
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
	 * Extract Document Metadata From Pdf
	 * Extract metadata from a PDF file to pre-fill document creation form.
 * Returns title, text content, summary, etc. extracted from the PDF.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static extractDocumentMetadataFromPdf(data: DocumentsData['ExtractDocumentMetadataFromPdf']): CancelablePromise<Record<string, unknown>> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/documents/extract-pdf-metadata',
			formData: formData,
			mediaType: 'multipart/form-data',
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class FilestorageService {

	/**
	 * File Upload
	 * Upload a file to Minio.
 * Expects form-data with a file.
	 * @returns FileUploadResponse Successful Response
	 * @throws ApiError
	 */
	public static fileUpload(data: FilestorageData['FileUpload']): CancelablePromise<FileUploadResponse> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/files/',
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
	 * Download a file from Minio.
 * Expects query parameters for storage_id and file_path.
 * The file is saved temporarily and a background task deletes the temp file.
	 * @returns any Successful Response
	 * @throws ApiError
	 */
	public static fileDownload(data: FilestorageData['FileDownload']): CancelablePromise<any> {
		const {
storageId,
filePath,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/files/',
			query: {
				storage_id: storageId, file_path: filePath
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
	 * @returns string Successful Response
	 * @throws ApiError
	 */
	public static listFiles(): CancelablePromise<Array<string>> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/files/list',
			errors: {
				401: `Unauthorized`,
				500: `Internal Server Error`,
			},
		});
	}

	/**
	 * Delete File
	 * Delete a file from the storage bucket.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deleteFile(data: FilestorageData['DeleteFile']): CancelablePromise<unknown> {
		const {
filename,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/files/{filename}',
			path: {
				filename
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
	 * Upload a file to Minio.
 * Expects form-data with a file.
	 * @returns FileUploadResponse Successful Response
	 * @throws ApiError
	 */
	public static fileUpload(data: FilesData['FileUpload']): CancelablePromise<FileUploadResponse> {
		const {
formData,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/files/',
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
	 * Download a file from Minio.
 * Expects query parameters for storage_id and file_path.
 * The file is saved temporarily and a background task deletes the temp file.
	 * @returns any Successful Response
	 * @throws ApiError
	 */
	public static fileDownload(data: FilesData['FileDownload']): CancelablePromise<any> {
		const {
storageId,
filePath,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/files/',
			query: {
				storage_id: storageId, file_path: filePath
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
	 * @returns string Successful Response
	 * @throws ApiError
	 */
	public static listFiles(): CancelablePromise<Array<string>> {
				return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/files/list',
			errors: {
				401: `Unauthorized`,
				500: `Internal Server Error`,
			},
		});
	}

	/**
	 * Delete File
	 * Delete a file from the storage bucket.
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deleteFile(data: FilesData['DeleteFile']): CancelablePromise<unknown> {
		const {
filename,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/files/{filename}',
			path: {
				filename
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

export class ClassificationSchemesService {

	/**
	 * Create Saved Result Set
	 * @returns SavedResultSetRead Successful Response
	 * @throws ApiError
	 */
	public static createSavedResultSet(data: ClassificationSchemesData['CreateSavedResultSet']): CancelablePromise<SavedResultSetRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes/saved_results',
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
	 * Read Saved Result Sets
	 * @returns SavedResultSetRead Successful Response
	 * @throws ApiError
	 */
	public static readSavedResultSets(data: ClassificationSchemesData['ReadSavedResultSets']): CancelablePromise<Array<SavedResultSetRead>> {
		const {
workspaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes/saved_results',
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
	 * Create Classification Scheme
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
	 * Read Classification Schemes
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
	 * Delete All Classification Schemes
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
	 * Create Classification Scheme
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
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deleteAllClassificationSchemes1(data: ClassificationSchemesData['DeleteAllClassificationSchemes1']): CancelablePromise<unknown> {
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
	 * Update Classification Scheme
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
	 * Delete Classification Scheme
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static deleteClassificationScheme(data: ClassificationSchemesData['DeleteClassificationScheme']): CancelablePromise<unknown> {
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
	 * Classify Document
	 * @returns ClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static classifyDocument(data: ClassificationSchemesData['ClassifyDocument']): CancelablePromise<ClassificationResultRead> {
		const {
workspaceId,
schemeId,
documentId,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes/{scheme_id}/classify/{document_id}',
			path: {
				workspace_id: workspaceId, scheme_id: schemeId, document_id: documentId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Saved Result Set
	 * @returns SavedResultSetRead Successful Response
	 * @throws ApiError
	 */
	public static getSavedResultSet(data: ClassificationSchemesData['GetSavedResultSet']): CancelablePromise<SavedResultSetRead> {
		const {
workspaceId,
resultSetId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_schemes/saved_results/{result_set_id}',
			path: {
				workspace_id: workspaceId, result_set_id: resultSetId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class ClassificationResultsService {

	/**
	 * Create Classification Result
	 * Create (store) an individual classification result.
 * Verifies that the workspace exists and that the referenced document and scheme belong to that workspace.
	 * @returns ClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static createClassificationResult(data: ClassificationResultsData['CreateClassificationResult']): CancelablePromise<ClassificationResultRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/classification_results',
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
	 * Create Classification Result
	 * Create (store) an individual classification result.
 * Verifies that the workspace exists and that the referenced document and scheme belong to that workspace.
	 * @returns ClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static createClassificationResult1(data: ClassificationResultsData['CreateClassificationResult1']): CancelablePromise<ClassificationResultRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/classification_results',
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
	 * List Classification Results
	 * List all classification results for the given workspace.
	 * @returns EnhancedClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static listClassificationResults(data: ClassificationResultsData['ListClassificationResults']): CancelablePromise<Array<EnhancedClassificationResultRead>> {
		const {
workspaceId,
documentIds,
schemeIds,
runName,
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
				document_ids: documentIds, scheme_ids: schemeIds, run_name: runName, skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Classification Results
	 * List all classification results for the given workspace.
	 * @returns EnhancedClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static listClassificationResults1(data: ClassificationResultsData['ListClassificationResults1']): CancelablePromise<Array<EnhancedClassificationResultRead>> {
		const {
workspaceId,
documentIds,
schemeIds,
runName,
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
				document_ids: documentIds, scheme_ids: schemeIds, run_name: runName, skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Classification Result
	 * Load (retrieve) an individual classification result by its ID.
 * Verifies that this result's document and scheme belong to the workspace.
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
	 * Load (retrieve) an individual classification result by its ID.
 * Verifies that this result's document and scheme belong to the workspace.
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
	 * List all classification results for the given workspace.
	 * @returns EnhancedClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static listClassificationResults2(data: ClassificationResultsData['ListClassificationResults2']): CancelablePromise<Array<EnhancedClassificationResultRead>> {
		const {
workspaceId,
documentIds,
schemeIds,
runName,
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
				document_ids: documentIds, scheme_ids: schemeIds, run_name: runName, skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * List Classification Results
	 * List all classification results for the given workspace.
	 * @returns EnhancedClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static listClassificationResults3(data: ClassificationResultsData['ListClassificationResults3']): CancelablePromise<Array<EnhancedClassificationResultRead>> {
		const {
workspaceId,
documentIds,
schemeIds,
runName,
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
				document_ids: documentIds, scheme_ids: schemeIds, run_name: runName, skip, limit
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Results By Run
	 * Retrieve all classification results for a specific run ID.
	 * @returns ClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static getResultsByRun(data: ClassificationResultsData['GetResultsByRun']): CancelablePromise<Array<ClassificationResultRead>> {
		const {
workspaceId,
runId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_results/by_run/{run_id}',
			path: {
				workspace_id: workspaceId, run_id: runId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Get Results By Run
	 * Retrieve all classification results for a specific run ID.
	 * @returns ClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static getResultsByRun1(data: ClassificationResultsData['GetResultsByRun1']): CancelablePromise<Array<ClassificationResultRead>> {
		const {
workspaceId,
runId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_results/by_run/{run_id}',
			path: {
				workspace_id: workspaceId, run_id: runId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

}

export class ClassificationRunsService {

	/**
	 * Create Classification Run
	 * Create a new classification run.
 * Workspace must exist and belong to the current user.
	 * @returns ClassificationRunRead Successful Response
	 * @throws ApiError
	 */
	public static createClassificationRun(data: ClassificationRunsData['CreateClassificationRun']): CancelablePromise<ClassificationRunRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/classification_runs/',
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
	 * Create Classification Run
	 * Create a new classification run.
 * Workspace must exist and belong to the current user.
	 * @returns ClassificationRunRead Successful Response
	 * @throws ApiError
	 */
	public static createClassificationRun1(data: ClassificationRunsData['CreateClassificationRun1']): CancelablePromise<ClassificationRunRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/classification_runs/',
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
	 * Create Classification Run
	 * Create a new classification run.
 * Workspace must exist and belong to the current user.
	 * @returns ClassificationRunRead Successful Response
	 * @throws ApiError
	 */
	public static createClassificationRun2(data: ClassificationRunsData['CreateClassificationRun2']): CancelablePromise<ClassificationRunRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/classification_runs',
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
	 * Create Classification Run
	 * Create a new classification run.
 * Workspace must exist and belong to the current user.
	 * @returns ClassificationRunRead Successful Response
	 * @throws ApiError
	 */
	public static createClassificationRun3(data: ClassificationRunsData['CreateClassificationRun3']): CancelablePromise<ClassificationRunRead> {
		const {
workspaceId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v1/workspaces/{workspace_id}/classification_runs',
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
	 * Read Classification Runs
	 * Retrieve classification runs for a specific workspace
	 * @returns ClassificationRunsOut Successful Response
	 * @throws ApiError
	 */
	public static readClassificationRuns(data: ClassificationRunsData['ReadClassificationRuns']): CancelablePromise<ClassificationRunsOut> {
		const {
workspaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_runs',
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
	 * Read Classification Runs
	 * Retrieve classification runs for a specific workspace
	 * @returns ClassificationRunsOut Successful Response
	 * @throws ApiError
	 */
	public static readClassificationRuns1(data: ClassificationRunsData['ReadClassificationRuns1']): CancelablePromise<ClassificationRunsOut> {
		const {
workspaceId,
skip = 0,
limit = 100,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_runs',
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
	 * Read Classification Run
	 * Get a specific classification run by ID.
 * Only returns runs belonging to the user.
	 * @returns ClassificationRunRead Successful Response
	 * @throws ApiError
	 */
	public static readClassificationRun(data: ClassificationRunsData['ReadClassificationRun']): CancelablePromise<ClassificationRunRead> {
		const {
runId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_runs/{run_id}',
			path: {
				run_id: runId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Read Classification Run
	 * Get a specific classification run by ID.
 * Only returns runs belonging to the user.
	 * @returns ClassificationRunRead Successful Response
	 * @throws ApiError
	 */
	public static readClassificationRun1(data: ClassificationRunsData['ReadClassificationRun1']): CancelablePromise<ClassificationRunRead> {
		const {
runId,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v1/workspaces/{workspace_id}/classification_runs/{run_id}',
			path: {
				run_id: runId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Classification Run
	 * Update a specific classification run by ID.
 * Only allows updates to runs belonging to the user.
	 * @returns ClassificationRunRead Successful Response
	 * @throws ApiError
	 */
	public static updateClassificationRun(data: ClassificationRunsData['UpdateClassificationRun']): CancelablePromise<ClassificationRunRead> {
		const {
runId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/workspaces/{workspace_id}/classification_runs/{run_id}',
			path: {
				run_id: runId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Update Classification Run
	 * Update a specific classification run by ID.
 * Only allows updates to runs belonging to the user.
	 * @returns ClassificationRunRead Successful Response
	 * @throws ApiError
	 */
	public static updateClassificationRun1(data: ClassificationRunsData['UpdateClassificationRun1']): CancelablePromise<ClassificationRunRead> {
		const {
runId,
requestBody,
} = data;
		return __request(OpenAPI, {
			method: 'PATCH',
			url: '/api/v1/workspaces/{workspace_id}/classification_runs/{run_id}',
			path: {
				run_id: runId
			},
			body: requestBody,
			mediaType: 'application/json',
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Classification Run
	 * Delete a specific classification run by ID.
 * Only allows deletion of runs belonging to the user.
 * Note: This will cascade delete associated ClassificationResults if the DB constraint is active.
 * If not, results might be orphaned. Consider handling orphans separately if needed.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteClassificationRun(data: ClassificationRunsData['DeleteClassificationRun']): CancelablePromise<void> {
		const {
runId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/classification_runs/{run_id}',
			path: {
				run_id: runId
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Delete Classification Run
	 * Delete a specific classification run by ID.
 * Only allows deletion of runs belonging to the user.
 * Note: This will cascade delete associated ClassificationResults if the DB constraint is active.
 * If not, results might be orphaned. Consider handling orphans separately if needed.
	 * @returns void Successful Response
	 * @throws ApiError
	 */
	public static deleteClassificationRun1(data: ClassificationRunsData['DeleteClassificationRun1']): CancelablePromise<void> {
		const {
runId,
} = data;
		return __request(OpenAPI, {
			method: 'DELETE',
			url: '/api/v1/workspaces/{workspace_id}/classification_runs/{run_id}',
			path: {
				run_id: runId
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

	/**
	 * Get Location From Query
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static getLocationFromQuery(data: ClassificationData['GetLocationFromQuery']): CancelablePromise<unknown> {
		const {
query,
} = data;
		return __request(OpenAPI, {
			method: 'GET',
			url: '/api/v2/classification/location_from_query',
			query: {
				query
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Classify Document
	 * @returns ClassificationResultRead Successful Response
	 * @throws ApiError
	 */
	public static classifyDocument(data: ClassificationData['ClassifyDocument']): CancelablePromise<ClassificationResultRead> {
		const {
schemeId,
documentId,
provider,
model,
runId,
runName,
runDescription,
xApiKey,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/classification/{scheme_id}/classify/{document_id}',
			path: {
				scheme_id: schemeId, document_id: documentId
			},
			headers: {
				'X-API-Key': xApiKey
			},
			query: {
				provider, model, run_id: runId, run_name: runName, run_description: runDescription
			},
			errors: {
				422: `Validation Error`,
			},
		});
	}

	/**
	 * Classify
	 * @returns unknown Successful Response
	 * @throws ApiError
	 */
	public static classify(data: ClassificationData['Classify']): CancelablePromise<unknown> {
		const {
text,
schemeId,
xApiKey,
} = data;
		return __request(OpenAPI, {
			method: 'POST',
			url: '/api/v2/classification/classify',
			headers: {
				'X-API-Key': xApiKey
			},
			query: {
				text, scheme_id: schemeId
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
timeframeTo = '2025-04-10',
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