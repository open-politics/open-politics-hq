import { 
  AnnotationsService, 
  AnnotationSchemasService, 
} from '@/client';
import { 
  AnnotationRead, 
  AnnotationSchemaRead,
  AnnotationSchemaCreate,
} from '@/client';
import { 
  AnnotationResult,
  AnnotationSchema,
  FormattedAnnotation,
  SchemeField,
  AnnotationSchemaFormData,
  DictKeyDefinition,
} from './types';
import { adaptSchemasToSchemaReads, adaptSchemaReadToSchema, adaptSchemaFormDataToSchemaCreate } from './adapters';

// Helper to convert null to undefined for string fields
export const nullToUndefined = <T>(value: T | null): T | undefined => 
  value === null ? undefined : value;

// Helper function to transform API data to form format
export const transformApiToFormData = (apiData: AnnotationSchemaRead): AnnotationSchemaFormData => ({
  name: apiData.name,
  description: apiData.description || "",
  // This is a complex conversion that requires parsing the `output_contract`
  // For now, we return an empty array.
  fields: [],
  instructions: apiData.instructions || undefined,
  // validation_rules is not a backend field
  validation_rules: undefined,
});

/**
 * Unified service for working with annotations
 */
export class AnnotationService {
  private static resultsCache = new Map<string, {
    timestamp: number;
    results: AnnotationRead[];
  }>();
  
  private static CACHE_EXPIRATION = 5 * 60 * 1000;
  
  static clearCache(): void {
    this.resultsCache.clear();
  }
  
  static getAssetResultsCacheKey(assetId: number, runId?: number, infospaceId?: number): string {
    return `asset-${assetId}-run-${runId || 'all'}-is-${infospaceId || 'default'}`;
  }
  
  static clearAssetResultsCache(assetId: number, runId?: number, infospaceId?: number): void {
    const cacheKey = this.getAssetResultsCacheKey(assetId, runId, infospaceId);
    this.resultsCache.delete(cacheKey);
  }

  static async getSchemas(infospaceId: number): Promise<AnnotationSchemaRead[]> {
    try {
      const response = await AnnotationSchemasService.listAnnotationSchemas({
        infospaceId,
        skip: 0,
        limit: 100,
        includeCounts: true,
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching annotation schemas:', error);
      throw error;
    }
  }

  static async getSchema(infospaceId: number, schemaId: number): Promise<AnnotationSchemaRead> {
    try {
      const schema = await AnnotationSchemasService.getAnnotationSchema({
        infospaceId,
        schemaId
      });
      return schema;
    } catch (error) {
      console.error(`Error fetching annotation schema ${schemaId}:`, error);
      throw error;
    }
  }

  static async createSchema(infospaceId: number, schemaData: AnnotationSchemaFormData): Promise<AnnotationSchemaRead> {
    try {
      const apiSchema = adaptSchemaFormDataToSchemaCreate(schemaData);
      const createdSchema = await AnnotationSchemasService.createAnnotationSchema({
        infospaceId,
        requestBody: apiSchema
      });
      return createdSchema;
    } catch (error) {
      console.error('Error creating annotation schema:', error);
      throw error;
    }
  }

  static async updateSchema(infospaceId: number, schemaId: number, schemaData: AnnotationSchemaFormData): Promise<AnnotationSchemaRead> {
    try {
      const apiSchema = adaptSchemaFormDataToSchemaCreate(schemaData);
      const updatedSchema = await AnnotationSchemasService.updateAnnotationSchema({
        infospaceId,
        schemaId,
        requestBody: apiSchema as any
      });
      return updatedSchema;
    } catch (error) {
      console.error(`Error updating annotation schema ${schemaId}:`, error);
      throw error;
    }
  }

  static async deleteSchema(infospaceId: number, schemaId: number): Promise<void> {
    try {
      await AnnotationSchemasService.deleteAnnotationSchema({
        infospaceId,
        schemaId
      });
    } catch (error) {
      console.error(`Error deleting annotation schema ${schemaId}:`, error);
      throw error;
    }
  }

  static async getResults(
    infospaceId: number, 
    options: { 
      assetId?: number,
      schemaId?: number, 
      runId?: number,
      limit?: number,
      useCache?: boolean
    } = {}
  ): Promise<AnnotationRead[]> {
    try {
      const response = await AnnotationsService.listAnnotations({
        infospaceId,
        limit: options.limit || 100,
        sourceId: options.assetId,
        schemaId: options.schemaId
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching annotation results:', error);
      return [];
    }
  }

  static formatEntityStatements(value: any, options: {
    compact?: boolean;
    maxItems?: number;
    showLabels?: boolean;
  } = {}): React.ReactNode {
    const { compact = false, maxItems = 5, showLabels = true } = options;
    if (value === null || value === undefined) return 'N/A';
    if (typeof value === 'object' && value !== null && 'default_field' in value) return value.default_field;
    if (Array.isArray(value)) {
      if (value.length === 0) return 'No data';
      const hasEntityStatements = value.some(item => typeof item === 'object' && item !== null && ('entity' in item || 'statement' in item));
      if (hasEntityStatements) {
        const formattedItems = value.slice(0, maxItems).map(item => {
          if (typeof item !== 'object' || item === null) return String(item);
          const entity = 'entity' in item ? item.entity : null;
          const statement = 'statement' in item ? item.statement : null;
          if (entity && statement) return compact ? `${entity}: ${statement}` : { entity, statement };
          else if (entity) return compact ? entity : { entity, statement: null };
          else if (statement) return compact ? statement : { entity: null, statement };
          else return compact ? this.safeStringify(item) : { raw: this.safeStringify(item) };
        });
        if (value.length > maxItems) {
          const remaining = value.length - maxItems;
          formattedItems.push(compact ? `... and ${remaining} more` : { summary: `... and ${remaining} more` });
        }
        return formattedItems;
      } else {
        return `${value.length} items`;
      }
    }
    if (typeof value === 'object' && value !== null) return this.safeStringify(value);
    return String(value);
  }

  static safeStringify(value: any): string {
    if (value === null || value === undefined) return 'N/A';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value, null, 2);
    } catch (e) {
      return 'Complex Data';
    }
  }
} 