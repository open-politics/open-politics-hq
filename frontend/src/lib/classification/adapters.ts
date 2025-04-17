import { 
  ClassificationResult, 
  ClassificationScheme, 
  FormattedClassificationResult,
  ClassifiableDocument,
  SchemeFormData
} from './types';
import { 
  ClassificationResultRead, 
  ClassificationSchemeRead,
  DocumentRead,
  FileRead,
  ClassificationSchemeCreate
} from '@/client/models';

/**
 * Adapters to convert between our new types and the old API types
 * These are temporary and will be removed once the migration is complete
 */

/**
 * Convert a ClassificationScheme to a ClassificationSchemeRead
 */
export function schemeToSchemeRead(scheme: ClassificationScheme): ClassificationSchemeRead {
  return {
    id: scheme.id,
    name: scheme.name,
    description: scheme.description || '',
    fields: scheme.fields.map(field => ({
      name: field.name,
      type: field.type,
      description: field.description || '',
      scale_min: field.config.scale_min || null,
      scale_max: field.config.scale_max || null,
      is_set_of_labels: field.config.is_set_of_labels || null,
      labels: field.config.labels || null,
      dict_keys: field.config.dict_keys || null
    })),
    model_instructions: scheme.model_instructions || '',
    validation_rules: scheme.validation_rules || {},
    created_at: scheme.created_at || new Date().toISOString(),
    updated_at: scheme.updated_at || new Date().toISOString(),
    classification_count: scheme.classification_count || 0,
    document_count: scheme.document_count || 0
  } as ClassificationSchemeRead;
}

/**
 * Convert an array of ClassificationScheme to ClassificationSchemeRead[]
 */
export function schemesToSchemeReads(schemes: ClassificationScheme[]): ClassificationSchemeRead[] {
  return schemes.map(schemeToSchemeRead);
}

/**
 * Convert a ClassificationResult to a ClassificationResultRead
 */
export function resultToResultRead(result: ClassificationResult | FormattedClassificationResult): ClassificationResultRead {
  // Create a minimal document if needed
  const document: DocumentRead = {
    id: result.document_id,
    title: result.document?.title || '',
    insertion_date: result.document?.insertion_date || new Date().toISOString(),
    files: result.document?.files?.map(f => ({ ...f, document_id: result.document_id })) || [],
    workspace_id: 0,
    user_id: 0
  } as DocumentRead;
  
  // Create a placeholder scheme object
  const schemePlaceholder: ClassificationSchemeRead = {
    id: result.scheme_id,
    name: result.scheme?.name || '',
    description: result.scheme?.description || '',
    fields: result.scheme?.fields?.map(field => ({
      name: field.name,
      type: field.type,
      description: field.description || '',
      scale_min: field.config.scale_min ?? null,
      scale_max: field.config.scale_max ?? null,
      is_set_of_labels: field.config.is_set_of_labels ?? null,
      labels: field.config.labels ?? null,
      dict_keys: field.config.dict_keys ?? null
    })) || [],
    model_instructions: result.scheme?.model_instructions || null,
    validation_rules: result.scheme?.validation_rules || null,
    created_at: result.scheme?.created_at || new Date().toISOString(),
    updated_at: result.scheme?.updated_at || new Date().toISOString(),
    workspace_id: 0,
    user_id: 0,
    classification_count: result.scheme?.classification_count ?? null,
    document_count: result.scheme?.document_count ?? null
  };

  return {
    id: result.id,
    document_id: result.document_id,
    scheme_id: result.scheme_id,
    value: result.value,
    timestamp: result.timestamp,
    run_id: result.run_id || null,
    document: document,
    scheme: schemePlaceholder
  } as ClassificationResultRead;
}

/**
 * Convert an array of ClassificationResult to ClassificationResultRead[]
 */
export function resultsToResultReads(results: (ClassificationResult | FormattedClassificationResult)[]): ClassificationResultRead[] {
  return results.map(resultToResultRead);
}

/**
 * Convert a ClassificationResultRead to a ClassificationResult
 */
export function resultReadToResult(resultRead: ClassificationResultRead): ClassificationResult {
  return {
    id: resultRead.id,
    document_id: resultRead.document_id,
    scheme_id: resultRead.scheme_id,
    value: resultRead.value,
    timestamp: resultRead.timestamp || new Date().toISOString(),
    run_id: resultRead.run_id ?? 0,
    run_name: `Run ${resultRead.run_id ?? 'Unknown'}`,
    run_description: undefined,
    document: resultRead.document ? {
        id: resultRead.document.id,
        title: resultRead.document.title,
    } as ClassifiableDocument : undefined,
    scheme: resultRead.scheme ? schemeReadToScheme(resultRead.scheme) : undefined
  };
}

/**
 * Convert a ClassifiableDocument to a DocumentRead
 */
export function documentToDocumentRead(doc: ClassifiableDocument): DocumentRead {
  // Convert files to FileRead[]
  const files: FileRead[] = (doc.files || []).map(file => ({
    ...file,
    document_id: doc.id,
    workspace_id: 0
  } as FileRead));
  
  return {
    id: doc.id,
    title: doc.title,
    text_content: doc.text_content || null,
    url: doc.url || null,
    source: doc.source || null,
    content_type: doc.content_type || null,
    insertion_date: doc.insertion_date,
    summary: doc.summary || null,
    top_image: doc.top_image || null,
    files: files,
    workspace_id: 0,
    user_id: 0
  } as DocumentRead;
}

/**
 * Convert an array of ClassifiableDocument to DocumentRead[]
 */
export function documentsToDocumentReads(docs: ClassifiableDocument[]): DocumentRead[] {
  return docs.map(documentToDocumentRead);
}

// Helper function to convert ClassificationSchemeRead back to ClassificationScheme (if needed)
export function schemeReadToScheme(schemeRead: ClassificationSchemeRead): ClassificationScheme {
    return {
        id: schemeRead.id,
        name: schemeRead.name,
        description: schemeRead.description,
        fields: schemeRead.fields.map(field => ({
            name: field.name,
            type: field.type,
            description: field.description,
            config: {
                scale_min: field.scale_min ?? undefined,
                scale_max: field.scale_max ?? undefined,
                is_set_of_labels: field.is_set_of_labels ?? undefined,
                labels: field.labels ?? undefined,
                dict_keys: field.dict_keys ? field.dict_keys.map(dk => ({ name: dk.name, type: dk.type as "str" | "int" | "float" | "bool" })) : undefined
            }
        })),
        model_instructions: schemeRead.model_instructions ?? undefined,
        validation_rules: schemeRead.validation_rules ?? undefined,
        created_at: schemeRead.created_at,
        updated_at: schemeRead.updated_at,
        classification_count: schemeRead.classification_count ?? 0,
        document_count: schemeRead.document_count ?? 0,
    };
} 