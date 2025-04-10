import { 
  ClassificationResultsService, 
  ClassificationSchemesService, 
  DocumentsService,
  ClassificationService as ClientClassificationService,
  ClassificationRunsService
} from '@/client/services';
import { 
  ClassificationResultRead, 
  ClassificationSchemeRead,
  DocumentRead,
  Body_documents_create_document,
  ClassificationResultCreate,
  ClassificationSchemeCreate,
  ClassificationRunCreate,
  ClassificationRunRead,
  ClassificationRunUpdate
} from '@/client/models';
import { 
  ClassifiableContent, 
  ClassifiableDocument,
  ClassificationParams,
  ClassificationResult,
  ClassificationScheme,
  FormattedClassificationResult,
  SchemeField,
  SchemeFormData,
  DictKeyDefinition,
  ClassificationRun
} from './types';

// Helper to convert API DictKeyDefinition to our type
const convertDictKeyDefinition = (apiDictKey: any): DictKeyDefinition => ({
  name: apiDictKey.name,
  type: apiDictKey.type as "str" | "int" | "float" | "bool"
});

// Helper to convert null to undefined for string fields
export const nullToUndefined = <T>(value: T | null): T | undefined => 
  value === null ? undefined : value;

// Helper function to transform form data to API format
export const transformFormDataToApi = (formData: SchemeFormData): ClassificationSchemeCreate => ({
  name: formData.name,
  description: formData.description,
  fields: formData.fields.map(field => ({
    name: field.name,
    type: field.type,
    description: field.description,
    scale_min: field.config.scale_min ?? null,
    scale_max: field.config.scale_max ?? null,
    is_set_of_labels: field.config.is_set_of_labels ?? null,
    labels: field.config.labels ?? null,
    dict_keys: field.config.dict_keys ?? null
  })),
  model_instructions: formData.model_instructions ?? undefined,
  validation_rules: formData.validation_rules ?? undefined
});

// Helper function to transform API data to form format
export const transformApiToFormData = (apiData: ClassificationSchemeRead): SchemeFormData => ({
  name: apiData.name,
  description: apiData.description,
  fields: apiData.fields.map(field => ({
    name: field.name,
    type: field.type,
    description: field.description,
    config: {
      scale_min: field.scale_min ?? undefined,
      scale_max: field.scale_max ?? undefined,
      is_set_of_labels: field.is_set_of_labels ?? undefined,
      labels: field.labels ?? undefined,
      dict_keys: field.dict_keys ? field.dict_keys.map(convertDictKeyDefinition) : undefined
    }
  })),
  model_instructions: apiData.model_instructions ?? undefined,
  validation_rules: apiData.validation_rules ?? undefined
});

/**
 * Unified service for working with classifications
 * Handles documents, schemes, and classification results
 */
export class ClassificationService {
  // Cache for classification results
  private static resultsCache = new Map<string, {
    timestamp: number;
    results: ClassificationResultRead[];
  }>();
  
  // Cache expiration time (5 minutes)
  private static CACHE_EXPIRATION = 5 * 60 * 1000;
  
  // Clear all caches
  static clearCache(): void {
    this.resultsCache.clear();
  }
  
  // Generate a cache key for results
  static getResultsCacheKey(contentId: number, runId?: number, workspaceId?: number): string {
    return `${contentId}-${runId || 'default'}-${workspaceId || 'default'}`;
  }
  
  // Clear cache for a specific content
  static clearResultsCache(contentId: number, runId?: number, workspaceId?: number): void {
    const cacheKey = this.getResultsCacheKey(contentId, runId, workspaceId);
    this.resultsCache.delete(cacheKey);
  }

  /**
   * Get all classification schemes for a workspace
   */
  static async getSchemes(workspaceId: number): Promise<ClassificationScheme[]> {
    try {
      const schemes = await ClassificationSchemesService.readClassificationSchemes({
        workspaceId,
        skip: 0,
        limit: 100
      });
      
      // Convert API schemes to our unified format
      return schemes.map(scheme => ({
        id: scheme.id,
        name: scheme.name,
        description: scheme.description,
        fields: scheme.fields.map(field => ({
          name: field.name,
          type: field.type,
          description: field.description,
          config: {
            scale_min: field.scale_min ?? undefined,
            scale_max: field.scale_max ?? undefined,
            is_set_of_labels: field.is_set_of_labels ?? undefined,
            labels: field.labels ?? undefined,
            dict_keys: field.dict_keys ? field.dict_keys.map(convertDictKeyDefinition) : undefined
          }
        })),
        model_instructions: scheme.model_instructions ?? undefined,
        validation_rules: scheme.validation_rules ?? undefined,
        created_at: scheme.created_at,
        updated_at: scheme.updated_at,
        classification_count: scheme.classification_count ?? 0,
        document_count: scheme.document_count ?? 0
      }));
    } catch (error) {
      console.error('Error fetching classification schemes:', error);
      throw error;
    }
  }

  /**
   * Get a specific classification scheme by ID
   */
  static async getScheme(workspaceId: number, schemeId: number): Promise<ClassificationScheme> {
    try {
      const scheme = await ClassificationSchemesService.readClassificationScheme({
        workspaceId,
        schemeId
      });
      
      return {
        id: scheme.id,
        name: scheme.name,
        description: scheme.description,
        fields: scheme.fields.map(field => ({
          name: field.name,
          type: field.type,
          description: field.description,
          config: {
            scale_min: field.scale_min ?? undefined,
            scale_max: field.scale_max ?? undefined,
            is_set_of_labels: field.is_set_of_labels ?? undefined,
            labels: field.labels ?? undefined,
            dict_keys: field.dict_keys ? field.dict_keys.map(convertDictKeyDefinition) : undefined
          }
        })),
        model_instructions: scheme.model_instructions ?? undefined,
        validation_rules: scheme.validation_rules ?? undefined,
        created_at: scheme.created_at,
        updated_at: scheme.updated_at
      };
    } catch (error) {
      console.error(`Error fetching classification scheme ${schemeId}:`, error);
      throw error;
    }
  }

  /**
   * Create a new classification scheme
   */
  static async createScheme(workspaceId: number, schemeData: SchemeFormData): Promise<ClassificationScheme> {
    try {
      // Convert to API format
      const apiScheme = transformFormDataToApi(schemeData);
      
      // Create the scheme
      const createdScheme = await ClassificationSchemesService.createClassificationScheme({
        workspaceId,
        requestBody: apiScheme
      });
      
      // Return the created scheme in our unified format
      return {
        id: createdScheme.id,
        name: createdScheme.name,
        description: createdScheme.description,
        fields: createdScheme.fields.map(field => ({
          name: field.name,
          type: field.type,
          description: field.description,
          config: {
            scale_min: field.scale_min ?? undefined,
            scale_max: field.scale_max ?? undefined,
            is_set_of_labels: field.is_set_of_labels ?? undefined,
            labels: field.labels ?? undefined,
            dict_keys: field.dict_keys ? field.dict_keys.map(convertDictKeyDefinition) : undefined
          }
        })),
        model_instructions: createdScheme.model_instructions ?? undefined,
        validation_rules: createdScheme.validation_rules ?? undefined,
        created_at: createdScheme.created_at,
        updated_at: createdScheme.updated_at
      };
    } catch (error) {
      console.error('Error creating classification scheme:', error);
      throw error;
    }
  }

  /**
   * Update an existing classification scheme
   */
  static async updateScheme(workspaceId: number, schemeId: number, schemeData: SchemeFormData): Promise<ClassificationScheme> {
    try {
      // Convert to API format
      const apiScheme = transformFormDataToApi(schemeData);
      
      // Update the scheme
      const updatedScheme = await ClassificationSchemesService.updateClassificationScheme({
        workspaceId,
        schemeId,
        requestBody: apiScheme
      });
      
      // Return the updated scheme in our unified format
      return {
        id: updatedScheme.id,
        name: updatedScheme.name,
        description: updatedScheme.description,
        fields: updatedScheme.fields.map(field => ({
          name: field.name,
          type: field.type,
          description: field.description,
          config: {
            scale_min: field.scale_min ?? undefined,
            scale_max: field.scale_max ?? undefined,
            is_set_of_labels: field.is_set_of_labels ?? undefined,
            labels: field.labels ?? undefined,
            dict_keys: field.dict_keys ? field.dict_keys.map(convertDictKeyDefinition) : undefined
          }
        })),
        model_instructions: updatedScheme.model_instructions ?? undefined,
        validation_rules: updatedScheme.validation_rules ?? undefined,
        created_at: updatedScheme.created_at,
        updated_at: updatedScheme.updated_at
      };
    } catch (error) {
      console.error(`Error updating classification scheme ${schemeId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a classification scheme
   */
  static async deleteScheme(workspaceId: number, schemeId: number): Promise<void> {
    try {
      await ClassificationSchemesService.deleteClassificationScheme({
        workspaceId,
        schemeId
      });
    } catch (error) {
      console.error(`Error deleting classification scheme ${schemeId}:`, error);
      throw error;
    }
  }

  /**
   * Get documents from the workspace
   */
  static async getDocuments(workspaceId: number): Promise<ClassifiableDocument[]> {
    try {
      const documents = await DocumentsService.readDocuments({
        workspaceId,
        skip: 0,
        limit: 100
      });
      
      return documents.map(doc => ({
        id: doc.id,
        title: doc.title,
        text_content: nullToUndefined(doc.text_content),
        url: nullToUndefined(doc.url),
        source: nullToUndefined(doc.source),
        content_type: nullToUndefined(doc.content_type),
        insertion_date: doc.insertion_date,
        summary: nullToUndefined(doc.summary),
        top_image: nullToUndefined(doc.top_image),
        files: doc.files
      }));
    } catch (error) {
      console.error('Error fetching documents:', error);
      throw error;
    }
  }

  /**
   * Get a specific document by ID
   */
  static async getDocument(workspaceId: number, documentId: number): Promise<ClassifiableDocument> {
    try {
      const document = await DocumentsService.readDocument({
        workspaceId,
        documentId
      });
      
      return {
        id: document.id,
        title: document.title,
        text_content: nullToUndefined(document.text_content),
        url: nullToUndefined(document.url),
        source: nullToUndefined(document.source),
        content_type: nullToUndefined(document.content_type),
        insertion_date: document.insertion_date,
        summary: nullToUndefined(document.summary),
        top_image: nullToUndefined(document.top_image),
        files: document.files
      };
    } catch (error) {
      console.error(`Error fetching document ${documentId}:`, error);
      throw error;
    }
  }

  /**
   * Create a new document
   */
  static async createDocument(workspaceId: number, documentData: Partial<ClassifiableDocument>): Promise<ClassifiableDocument> {
    try {
      const createdDocument = await DocumentsService.createDocument1({
        workspaceId,
        formData: {
          title: documentData.title || 'Untitled Document',
          text_content: documentData.text_content || '',
          url: documentData.url || '',
          content_type: documentData.content_type || 'article',
          source: documentData.source || '',
          summary: documentData.summary || documentData.text_content?.substring(0, 200) || '',
          top_image: documentData.top_image || null
        } as Body_documents_create_document
      });
      
      return {
        id: createdDocument.id,
        title: createdDocument.title,
        text_content: nullToUndefined(createdDocument.text_content),
        url: nullToUndefined(createdDocument.url),
        source: nullToUndefined(createdDocument.source),
        content_type: nullToUndefined(createdDocument.content_type),
        insertion_date: createdDocument.insertion_date,
        summary: nullToUndefined(createdDocument.summary),
        top_image: nullToUndefined(createdDocument.top_image),
        files: createdDocument.files
      };
    } catch (error) {
      console.error('Error creating document:', error);
      throw error;
    }
  }

  /**
   * Check if content exists as a document, and create it if it doesn't
   * @returns The document ID to use for classification
   */
  static async ensureDocumentExists(
    content: ClassifiableContent,
    workspaceId: number
  ): Promise<number> {
    // If the content already has a valid document ID, use it
    if (content.id && content.id > 0) {
      try {
        // Try to fetch the document to verify it exists
        await DocumentsService.readDocument({
          workspaceId,
          documentId: content.id
        });
        
        // If we get here, the document exists
        return content.id;
      } catch (error) {
        // Document doesn't exist or there was an error, continue to create a new one
        console.log(`Document with ID ${content.id} not found, creating a new one`);
      }
    }
    
    // Prepare document data
    const documentData = {
      title: content.title || 'Untitled Content',
      text_content: content.text_content || content.content || '',
      url: content.url || '',
      content_type: content.content_type || 'article',
      source: content.source || '',
      summary: (content.text_content || content.content || '').substring(0, Math.min(200, (content.text_content || content.content || '').length)),
      top_image: content.top_image || null
    };
    
    // Create the document
    const createdDocument = await this.createDocument(workspaceId, documentData);
    return createdDocument.id;
  }

  /**
   * Get classification results for a document
   */
  static async getResults(
    workspaceId: number, 
    options: { 
      documentId?: number, 
      schemeId?: number, 
      runId?: number,
      runName?: string,
      limit?: number,
      useCache?: boolean
    } = {}
  ): Promise<ClassificationResultRead[]> {
    const { documentId, schemeId, runId, runName, limit, useCache = true } = options;
    
    // Check cache if enabled and we have a document ID
    if (useCache && documentId) {
      const cacheKey = this.getResultsCacheKey(documentId, runId, workspaceId);
      const cachedData = this.resultsCache.get(cacheKey);
      
      if (cachedData && (Date.now() - cachedData.timestamp < this.CACHE_EXPIRATION)) {
        console.log('Using cached results for:', cacheKey);
        return cachedData.results;
      }
    }
    
    try {
      // Build query parameters
      const queryParams: any = {
        workspaceId,
        skip: 0,
        limit: limit || 100
      };
      
      if (documentId) {
        queryParams.documentIds = [documentId];
      }
      
      if (schemeId) {
        queryParams.schemeIds = [schemeId];
      }
      
      if (runName) {
        queryParams.runName = runName;
      }
      
      // Otherwise use the general endpoint
      const results = await ClassificationResultsService.listClassificationResults(queryParams);
      
      // Cache results if we have a document ID
      if (useCache && documentId) {
        const cacheKey = this.getResultsCacheKey(documentId, runId, workspaceId);
        this.resultsCache.set(cacheKey, {
          timestamp: Date.now(),
          results: results
        });
      }
      
      return results;
    } catch (error: any) {
      console.error('Error fetching classification results:', error);
      throw new Error(`Failed to fetch classification results: ${error.message}`);
    }
  }

  /**
   * Get classification results specifically for a given run ID.
   */
  static async getResultsByRunAPI(
    workspaceId: number,
    runId: number,
    limit: number = 1000
  ): Promise<ClassificationResultRead[]> {
    try {
      const results = await ClassificationResultsService.getResultsByRun({
        workspaceId,
        runId,
      });
      return results;
    } catch (error: any) {
      console.error(`Error fetching results for run ${runId}:`, error);
      throw new Error(`Failed to fetch results for run ${runId}: ${error.message}`);
    }
  }

  /**
   * Format a classification result with its display value
   */
  static formatResult(
    result: ClassificationResult, 
    scheme: ClassificationScheme
  ): FormattedClassificationResult {
    // Check if this is a complex type like List[Dict[str, any]]
    const isComplexType = scheme.fields?.[0]?.type === 'List[Dict[str, any]]';
    
    let displayValue;
    
    if (isComplexType) {
      // For complex types, create a more descriptive display value
      if (typeof result.value === 'object' && result.value !== null && 'default_field' in result.value) {
        // If we have a default_field (summary), use that
        displayValue = result.value.default_field;
      } else if (Array.isArray(result.value) && result.value.length > 0) {
        // If we have structured data with entities, show a summary
        if (typeof result.value[0] === 'object' && '' in result.value[0]) {
          const entities = result.value.map(item => item.entity).filter(Boolean);
          displayValue = entities.length > 0 
            ? `${entities.length} entities: ${entities.slice(0, 3).join(', ')}${entities.length > 3 ? '...' : ''}`
            : 'Entity statements';
        } else {
          // Generic array summary
          displayValue = `${result.value.length} items`;
        }
      } else {
        // Fallback to standard formatting
        displayValue = this.getFormattedValue(result, scheme);
      }
    } else {
      // For simple types, use the standard approach
      displayValue = this.getFormattedValue(result, scheme);
    }
    
    return {
      ...result,
      displayValue
    };
  }

  /**
   * Extract and format a value from a classification result
   * --- MODIFIED: Takes run details for context ---
   */
  static getFormattedValue(
    result: ClassificationResult, // Internal type, might already have run details
    scheme: ClassificationScheme,
    runDetails?: ClassificationRun // Optional run details for context
  ): string | number | string[] {
    if (!result.value) return '';
    
    // Get the first field of the scheme
    const field = scheme.fields[0];
    if (!field) return '';
    
    // Extract the value for this field
    let fieldValue: any;
    
    // If the value is a simple type, use it directly
    if (typeof result.value !== 'object' || result.value === null) {
      fieldValue = result.value;
    } 
    // If the value is an object, try to extract the field value
    else if (!Array.isArray(result.value)) {
      // Try field name first
      if (result.value[field.name] !== undefined) {
        fieldValue = result.value[field.name];
      }
      // Try scheme name
      else if (result.value[scheme.name] !== undefined) {
        fieldValue = result.value[scheme.name];
      }
      // If it has a value property, use that
      else if ('value' in result.value) {
        fieldValue = result.value.value;
      }
      // If it has only one property, use that
      else if (Object.keys(result.value).length === 1) {
        fieldValue = Object.values(result.value)[0];
      }
      // Otherwise use the whole object
      else {
        fieldValue = result.value;
      }
    }
    // If the value is an array, use it directly
    else {
      fieldValue = result.value;
    }
    
    // Format the value based on the field type
    switch (field.type) {
      case 'int':
        const num = Number(fieldValue);
        if (!isNaN(num)) {
          if ((field.config.scale_min === 0) && (field.config.scale_max === 1)) {
            return num > 0.5 ? 'True' : 'False';
          }
          return typeof num === 'number' ? Number(num.toFixed(2)) : num;
        }
        return String(fieldValue);
        
      case 'List[str]':
        if (Array.isArray(fieldValue)) {
          const isSetOfLabels = field.config.is_set_of_labels;
          const labels = field.config.labels;
          
          if (isSetOfLabels && labels) {
            return fieldValue.filter(v => labels.includes(v)).join(', ');
          }
          return fieldValue.join(', ');
        }
        return String(fieldValue);
        
      case 'str':
        return String(fieldValue);
        
      case 'List[Dict[str, any]]':
        // Special handling for List[Dict[str, any]] type
        if (Array.isArray(fieldValue)) {
            return fieldValue.map(item => {
                if (typeof item === 'object' && item !== null) {
                    // Intelligently format object entries based on content
                    // Look for key pairs that might represent a relationship (like entity-statement)
                    const keys = Object.keys(item);
                    
                    // If we have a simple object with just 2-3 key properties, format it more readably
                    if (keys.length >= 2 && keys.length <= 3) {
                      // Check if one key looks like a subject and another like content
                      const subjectKeys = ['entity', 'subject', 'name', 'key', 'id', 'type'];
                      const contentKeys = ['statement', 'content', 'text', 'description', 'value', 'message'];
                      
                      const subjectKey = keys.find(k => subjectKeys.includes(k.toLowerCase()));
                      const contentKey = keys.find(k => contentKeys.includes(k.toLowerCase()));
                      
                      if (subjectKey && contentKey && item[subjectKey] && item[contentKey]) {
                        // Format as "subject: content" without the colon prefix
                        return `${item[subjectKey]}: ${item[contentKey]}`;
                      }
                    }
                    
                    // For other objects, format them without the leading colon
                    return Object.entries(item)
                      .map(([key, val]) => `${key}: ${val}`)
                      .join(', ');
                }
                return String(item);
            }).join('\n\n');
        } 
        // Handle case where we have a default_field instead of structured data
        else if (typeof fieldValue === 'object' && fieldValue !== null && 'default_field' in fieldValue) {
          return fieldValue.default_field;
        }
        // Handle case where we have a string summary instead of structured data
        else if (typeof fieldValue === 'string') {
          return fieldValue;
        }
        // Fallback to JSON stringify
        else if (typeof fieldValue === 'object' && fieldValue !== null) {
          if (Object.keys(fieldValue).length === 0) {
            return 'N/A';
          }
          return Object.entries(fieldValue)
            .map(([key, val]) => `${key}: ${val}`)
            .join(', ');
        }
        return JSON.stringify(fieldValue);
        
      default:
        if (typeof fieldValue === 'object') {
          if (Object.keys(fieldValue).length === 0) {
            return 'N/A';
          }
          return JSON.stringify(fieldValue);
        }
        return String(fieldValue);
    }
  }

  /**
   * Format entity statements for display
   * This is a utility function to standardize how entity statements are displayed
   * across different components
   */
  static formatEntityStatements(value: any, options: {
    compact?: boolean;
    maxItems?: number;
    showLabels?: boolean;
  } = {}): React.ReactNode {
    const { compact = false, maxItems = 5, showLabels = true } = options;
    
    // Handle null or undefined
    if (value === null || value === undefined) {
      return 'N/A';
    }
    
    // Handle default_field case (common for complex types)
    if (typeof value === 'object' && value !== null && 'default_field' in value) {
      return value.default_field;
    }
    
    // Handle array of entity statements
    if (Array.isArray(value)) {
      // If empty array
      if (value.length === 0) {
        return 'No data';
      }
      
      // Check if this is an array of entity-statement pairs
      const hasEntityStatements = value.some(item => 
        typeof item === 'object' && 
        item !== null && 
        ('entity' in item || 'statement' in item)
      );
      
      if (hasEntityStatements) {
        // Format as entity-statement pairs
        const formattedItems = value.slice(0, maxItems).map(item => {
          if (typeof item !== 'object' || item === null) {
            return String(item);
          }
          
          const entity = 'entity' in item ? item.entity : null;
          const statement = 'statement' in item ? item.statement : null;
          
          if (entity && statement) {
            return compact 
              ? `${entity}: ${statement}`
              : { entity, statement };
          } else if (entity) {
            return compact ? entity : { entity, statement: null };
          } else if (statement) {
            return compact ? statement : { entity: null, statement };
          } else {
            // If neither entity nor statement, stringify the object
            return compact 
              ? this.safeStringify(item) 
              : { raw: this.safeStringify(item) };
          }
        });
        
        // Add a count of remaining items if needed
        if (value.length > maxItems) {
          const remaining = value.length - maxItems;
          formattedItems.push(compact 
            ? `... and ${remaining} more` 
            : { summary: `... and ${remaining} more` }
          );
        }
        
        return formattedItems;
      } else {
        // Regular array, just return the length
        return `${value.length} items`;
      }
    }
    
    // If it's an object but not an array
    if (typeof value === 'object' && value !== null) {
      return this.safeStringify(value);
    }
    
    // For simple values
    return String(value);
  }
  
  /**
   * Safely stringify any value
   */
  static safeStringify(value: any): string {
    if (value === null || value === undefined) {
      return 'N/A';
    }
    
    if (typeof value === 'string') {
      return value;
    }
    
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    
    try {
      return JSON.stringify(value, null, 2);
    } catch (e) {
      return 'Complex Data';
    }
  }

  /**
   * Classify content with a specific scheme using the V2 endpoint.
   * This method handles the direct call to the classification API.
   * --- MODIFIED: Returns ClassificationResultRead, accepts ClassificationParams ---
   */
  static async classify(
    workspaceId: number, // Although not used by V2 endpoint, keep for consistency?
    params: ClassificationParams
  ): Promise<ClassificationResultRead> {
    try {
      // Ensure we have a valid document ID
      const documentId = params.documentId;
      if (!documentId) {
        throw new Error("Document ID is required for classification.");
      }

      // V2 endpoint expects provider/model in body, API key in header, run info in query
      const requestBody = {
          provider: params.provider,
          model: params.model,
      };

      // Call the V2 endpoint
      console.log(`Calling V2 classify: doc=${documentId}, scheme=${params.schemeId}, run=${params.runId}`);
      const result = await ClientClassificationService.classifyDocument({
          documentId: documentId,
          schemeId: params.schemeId,
          // Query parameters for run info
          runId: params.runId,
          runName: params.runName,
          runDescription: params.runDescription,
          // API key in header
          xApiKey: params.apiKey,
          // Provider/Model in body (if backend V2 expects it)
          // requestBody: requestBody - Check if needed
      });

      // The V2 endpoint returns ClassificationResultRead, which we return directly
      return result;

    } catch (error: any) {
      console.error('Error classifying content via V2 endpoint:', error);
      // Rethrow with more specific context if possible
      if (error.status === 401) {
          throw new Error(`Unauthorized: Invalid API Key for provider ${params.provider}`);
      }
      throw new Error(`Classification failed for doc ${params.documentId}, scheme ${params.schemeId}: ${error.message}`);
    }
  }

  /**
   * Classify arbitrary content with a specific scheme
   * This will create a document if needed
   * --- MODIFIED: Returns ClassificationResultRead ---
   */
  static async classifyContent(
    content: ClassifiableContent,
    schemeId: number,
    workspaceId: number,
    options: {
      runId?: number,
      runName?: string,
      runDescription?: string,
      provider?: string,
      model?: string,
      apiKey?: string,
      onProgress?: (status: string) => void
    } = {}
  ): Promise<ClassificationResultRead> {
    const { runId, runName, runDescription, provider, model, apiKey, onProgress } = options;
    
    // Validate content
    if (!content.text_content && !content.content) {
      throw new Error('Content must have text_content or content field');
    }
    
    // Normalize content
    const validatedContent: ClassifiableContent = {
      ...content,
      id: content.id || 0,
      title: content.title || 'Untitled Content',
      text_content: content.text_content || content.content || '',
      url: content.url || '',
      source: content.source || '',
      content_type: content.content_type || 'article'
    };
    
    try {
      onProgress?.('Ensuring document exists...');
      
      // Ensure document exists
      const documentId = await this.ensureDocumentExists(validatedContent, workspaceId);
      
      onProgress?.('Classifying content...');
      
      // Prepare classification parameters
      const params: ClassificationParams = {
        documentId,
        schemeId,
        runId,
        runName,
        runDescription,
        provider,
        model,
        apiKey
      };
      
      // Perform classification
      const result = await this.classify(workspaceId, params);
      
      // Clear cache for this document
      this.clearResultsCache(documentId, runId, workspaceId);
      
      onProgress?.('Classification complete');
      
      return result;
    } catch (error: any) {
      console.error('Error in classifyContent:', error);
      throw new Error(`Classification failed: ${error.message}`);
    }
  }

  /**
   * Batch classify multiple content items
   * --- MODIFIED: Returns ClassificationResultRead[] ---
   */
  static async batchClassify(
    contents: ClassifiableContent[],
    schemeId: number,
    workspaceId: number,
    options: {
      runId?: number,
      runName?: string,
      runDescription?: string,
      provider?: string,
      model?: string,
      apiKey?: string,
      onProgress?: (status: string, current: number, total: number) => void
    } = {}
  ): Promise<ClassificationResultRead[]> {
    try {
      // Generate a single run ID for all classifications in this batch if not provided
      const runId = options.runId; // Use provided runId directly
      const runName = options.runName;
      const runDescription = options.runDescription;

      const results: ClassificationResultRead[] = [];
      
      // Process each content item
      for (let i = 0; i < contents.length; i++) {
        const content = contents[i];
        try {
          // Create an adapter for the onProgress callback
          const progressAdapter = options.onProgress 
            ? (status: string) => options.onProgress!(status, i + 1, contents.length)
            : undefined;
            
          const result = await this.classifyContent(
            content,
            schemeId,
            workspaceId,
            {
              ...options,
              runId,
              runName,
              onProgress: progressAdapter
            }
          );
          
          results.push(result);
        } catch (error) {
          console.error(`Error classifying content item:`, error);
        }
      }
      
      return results;
    } catch (error) {
      console.error('Error during batch classification:', error);
      throw error;
    }
  }

  /**
   * Get a unique run ID for classifications
   * Uses a smaller integer than Date.now() to avoid PostgreSQL integer overflow
   */
  static generateRunId(): number {
    // Use a smaller format to avoid PostgreSQL integer overflow
    // Format: YYMMDD + random 4-digit number (to ensure uniqueness)
    const now = new Date();
    const year = now.getFullYear() % 100; // Last two digits of year
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    // Create a base number like 250227 (for February 27, 2025)
    const baseId = parseInt(`${year}${month}${day}`);
    
    // Add a random 4-digit number to ensure uniqueness
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    
    // Combine to get a number like 2502271234
    const runId = baseId * 10000 + randomPart;
    
    // Double-check that it's within PostgreSQL's integer range
    return Math.min(runId, 2147483647);
  }

  // --- ADDED: Method to fetch runs from API --- 
  static async getRunsAPI(workspaceId: number): Promise<ClassificationRunRead[]> {
      try {
          const response = await ClassificationRunsService.readClassificationRuns({
              workspaceId: workspaceId,
              limit: 500 // Fetch a reasonable number of recent runs
          });
          return response.data;
      } catch (error: any) {
          console.error('Error fetching runs from API:', error);
          throw new Error(`Failed to fetch classification runs: ${error.message}`);
      }
  }
  
  // --- ADDED: Method to fetch a single run from API ---
  static async getRunAPI(workspaceId: number, runId: number): Promise<ClassificationRunRead> {
      try {
          const run = await ClassificationRunsService.readClassificationRun({
              runId: runId
          });
          return run;
      } catch (error: any) {
          console.error(`Error fetching run ${runId} from API:`, error);
          throw new Error(`Failed to fetch run ${runId}: ${error.message}`);
      }
  }

  // --- ADDED: Method to create a run via API ---
  static async createRunAPI(workspaceId: number, runData: Partial<ClassificationRunCreate>): Promise<ClassificationRunRead> {
    try {
      const requestBody: ClassificationRunCreate = {
        workspace_id: workspaceId,
        name: runData.name ?? null, // Use null if undefined
        description: runData.description ?? null,
        status: runData.status ?? 'pending' // Default status
        // document_count and scheme_count are usually calculated or not set on create
      };
      const createdRun = await ClassificationRunsService.createClassificationRun({
        workspaceId: workspaceId,
        requestBody: requestBody
      });
      return createdRun;
    } catch (error: any) {
      console.error('Error creating run via API:', error);
      throw new Error(`Failed to create classification run: ${error.message}`);
    }
  }

  // --- ADDED: Method to update a run via API ---
  static async updateRunAPI(workspaceId: number, runId: number, runData: ClassificationRunUpdate): Promise<ClassificationRunRead> {
    try {
      const updatedRun = await ClassificationRunsService.updateClassificationRun({
        runId: runId,
        requestBody: runData
      });
      return updatedRun;
    } catch (error: any) {
      console.error(`Error updating run ${runId} via API:`, error);
      throw new Error(`Failed to update run ${runId}: ${error.message}`);
    }
  }

  // --- ADDED: Method to delete a run via API ---
  static async deleteRunAPI(workspaceId: number, runId: number): Promise<void> {
    try {
      await ClassificationRunsService.deleteClassificationRun({
        runId: runId
      });
    } catch (error: any) {
      console.error(`Error deleting run ${runId} via API:`, error);
      throw new Error(`Failed to delete run ${runId}: ${error.message}`);
    }
  }
} 