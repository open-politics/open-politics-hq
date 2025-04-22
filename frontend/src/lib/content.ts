// frontend/src/lib/content.ts
// Define the RelevanceMetrics interface
interface RelevanceMetrics {
  entity_count: number;
  location_mentions: number;
  total_frequency: number;
  relevance_score: number;
}

export type CoreContentModel = {
    id?: string; // Can be UUID string from API or numeric string DataRecord ID
    title?: string | null;
    text_content?: string | null;
    url?: string;
    source?: string | null;
    insertion_date?: string; // ISO string
    content_type?: string;
    content_language?: string | null;
    author?: string | null;
    publication_date?: string | null; // ISO string
    summary?: string | null;
    meta_summary?: string | null;
    embeddings?: number[] | null;
    top_image?: string | null;
    // Using Array<any> for entities for flexibility until structure is finalized
    entities?: Array<any>; 
    tags?: Array<{ // Structure seems consistent with API example
        id: string;
        name: string;
    }>;
    evaluation?: {
        // Combined fields from API response and original model
        content_id?: string; // Use optional as it might be same as top-level id
        rhetoric?: string;
        sociocultural_interest?: number | null;
        global_political_impact?: number | null;
        regional_political_impact?: number | null;
        global_economic_impact?: number | null;
        regional_economic_impact?: number | null;
        event_type?: string | null;
        event_subtype?: string | null;
        keywords?: string[] | null;
        categories?: string[] | null;
    } | null;
    // Add relevance metrics from API response
    relevance_metrics?: RelevanceMetrics | null; 
}
