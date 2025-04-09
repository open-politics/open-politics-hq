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
    title: '',
    insertion_date: new Date().toISOString(),
    files: [],
    workspace_id: 0,
    user_id: 0
  } as DocumentRead;
  
  return {
    id: result.id,
    document_id: result.document_id,
    scheme_id: result.scheme_id,
    value: result.value,
    timestamp: result.timestamp,
    run_id: result.run_id || 0,
    run_name: result.run_name || '',
    run_description: result.run_description || null,
    document: document,
    scheme: {
      id: result.scheme_id,
      name: '',
      description: '',
      fields: [],
      model_instructions: '',
      validation_rules: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    } as ClassificationSchemeRead
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
    timestamp: resultRead.timestamp,
    run_id: resultRead.run_id,
    run_name: resultRead.run_name || '',
    run_description: resultRead.run_description || undefined
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