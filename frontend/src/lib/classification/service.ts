import { 
  ClassificationResultsService, 
  ClassificationSchemesService, 
} from '@/client/services';
import { 
  ClassificationResultRead, 
  ClassificationSchemeRead,
  ClassificationSchemeCreate,
  EnhancedClassificationResultRead,
} from '@/client/models';
import { 
  ClassificationResult,
  ClassificationScheme,
  FormattedClassificationResult,
  SchemeField,
  SchemeFormData,
  DictKeyDefinition,
} from './types';
import { adaptSchemeReadToScheme } from './adapters';

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
 * Handles schemes and classification results (Documents/Runs removed)
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
  
  // Generate a cache key for results based on datarecord and job
  static getDataRecordResultsCacheKey(datarecordId: number, jobId?: number, workspaceId?: number): string {
    return `datarecord-${datarecordId}-job-${jobId || 'all'}-ws-${workspaceId || 'default'}`;
  }
  
  // Clear cache for a specific datarecord/job
  static clearDataRecordResultsCache(datarecordId: number, jobId?: number, workspaceId?: number): void {
    const cacheKey = this.getDataRecordResultsCacheKey(datarecordId, jobId, workspaceId);
    this.resultsCache.delete(cacheKey);
  }

  /**
   * Get all classification schemes for a workspace
   * Returns the client model directly.
   */
  static async getSchemes(workspaceId: number): Promise<ClassificationSchemeRead[]> {
    try {
      const schemes = await ClassificationSchemesService.readClassificationSchemes({
        workspaceId,
        skip: 0,
        limit: 100
      });
      
      // Return client model directly
      return schemes;
    } catch (error) {
      console.error('Error fetching classification schemes:', error);
      throw error;
    }
  }

  /**
   * Get a specific classification scheme by ID
   * Returns the client model directly.
   */
  static async getScheme(workspaceId: number, schemeId: number): Promise<ClassificationSchemeRead> {
    try {
      const scheme = await ClassificationSchemesService.readClassificationScheme({
        workspaceId,
        schemeId
      });
      
      // Return client model directly
      return scheme;
    } catch (error) {
      console.error(`Error fetching classification scheme ${schemeId}:`, error);
      throw error;
    }
  }

  /**
   * Create a new classification scheme
   * Returns the client model directly.
   */
  static async createScheme(workspaceId: number, schemeData: SchemeFormData): Promise<ClassificationSchemeRead> {
    try {
      // Convert to API format
      const apiScheme = transformFormDataToApi(schemeData);
      
      // Create the scheme
      const createdScheme = await ClassificationSchemesService.createClassificationScheme({
        workspaceId,
        requestBody: apiScheme
      });
      
      // Return client model directly
      return createdScheme;
    } catch (error) {
      console.error('Error creating classification scheme:', error);
      throw error;
    }
  }

  /**
   * Update an existing classification scheme
   * Returns the client model directly.
   */
  static async updateScheme(workspaceId: number, schemeId: number, schemeData: SchemeFormData): Promise<ClassificationSchemeRead> {
    try {
      // Convert to API format
      const apiScheme = transformFormDataToApi(schemeData);
      
      // Update the scheme
      const updatedScheme = await ClassificationSchemesService.updateClassificationScheme({
        workspaceId,
        schemeId,
        requestBody: apiScheme
      });
      
      // Return client model directly
      return updatedScheme;
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
   * Get classification results, optionally filtered.
   * Returns Enhanced results which include display_value.
   */
  static async getResults(
    workspaceId: number, 
    options: { 
      datarecordId?: number,
      schemeId?: number, 
      jobId?: number,
      limit?: number,
      useCache?: boolean
    } = {}
  ): Promise<ClassificationResultRead[]> {
    const { datarecordId, schemeId, jobId, limit, useCache = true } = options;
    
    // Check cache if enabled and we have a datarecord ID
    if (useCache && datarecordId) {
      const cacheKey = this.getDataRecordResultsCacheKey(datarecordId, jobId, workspaceId);
      const cachedData = this.resultsCache.get(cacheKey);
      
      if (cachedData && (Date.now() - cachedData.timestamp < this.CACHE_EXPIRATION)) {
        console.log('Using cached results for:', cacheKey);
        // Ensure cached type matches return type
        return cachedData.results as ClassificationResultRead[];
      }
    }
    
    try {
      // Build query parameters
      const queryParams: any = {
        workspaceId,
        skip: 0,
        limit: limit || 500 // Fetch more?
      };
      
      if (datarecordId) {
        queryParams.datarecordIds = [datarecordId];
      }
      
      if (schemeId) {
        queryParams.schemeIds = [schemeId];
      }
      
      if (jobId) {
        queryParams.jobId = jobId;
      }
      
      // Use the general endpoint which returns Enhanced results
      const results = await ClassificationResultsService.listClassificationResults(queryParams);
      
      // Cache results if we have a datarecord ID
      if (useCache && datarecordId) {
        const cacheKey = this.getDataRecordResultsCacheKey(datarecordId, jobId, workspaceId);
        this.resultsCache.set(cacheKey, {
          timestamp: Date.now(),
          results: results // Store enhanced results in cache
        });
      }
      
      return results;
    } catch (error: any) {
      console.error('Error fetching classification results:', error);
      // Ensure error message is useful
      const detail = error.body?.detail || error.message;
      throw new Error(`Failed to fetch classification results: ${detail}`);
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
} 