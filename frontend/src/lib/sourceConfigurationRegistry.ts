/**
 * Source Configuration Registry
 *
 * One schema per registered backend source kind. A Source's `details` IS that
 * source's read-config, verbatim — what the form edits here is exactly what the
 * backend's `read(config, …)` parses. No nesting, no provider knobs (providers
 * resolve via the infospace/owner/env chain, never per-source).
 */

import { JSONSchema7 } from 'json-schema';

export type SourceKind = 'rss' | 'web_search' | 'web' | 'crawl';

export interface SourceConfigurationSchema {
  kind: SourceKind;
  locatorSchema: JSONSchema7;
  uiSchema: UISchema;
}

export interface UISchema {
  title: string;
  description: string;
  icon: string;
  color: string;
  fields: FieldSchema[];
}

export interface FieldSchema {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'number' | 'boolean' | 'url' | 'json';
  required: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
  help?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

class SourceConfigurationRegistry {
  private schemas: Map<SourceKind, SourceConfigurationSchema> = new Map();

  constructor() {
    this.initializeSchemas();
  }

  private initializeSchemas(): void {
    // RSS — config = {feed_url, max_items?}
    this.schemas.set('rss', {
      kind: 'rss',
      locatorSchema: {
        type: 'object',
        properties: {
          feed_url: { type: 'string', format: 'uri', title: 'RSS Feed URL' },
          max_items: { type: 'number', minimum: 1, maximum: 200, default: 50 },
        },
        required: ['feed_url'],
      },
      uiSchema: {
        title: 'RSS Feed',
        description: 'Monitor an RSS feed for new articles',
        icon: 'rss',
        color: 'orange',
        fields: [
          {
            name: 'feed_url',
            label: 'RSS Feed URL',
            type: 'url',
            required: true,
            placeholder: 'https://example.com/feed.xml',
            help: 'Enter the URL of the RSS feed you want to monitor',
          },
          {
            name: 'max_items',
            label: 'Max Items per Poll',
            type: 'number',
            required: false,
            validation: { min: 1, max: 200 },
            help: 'How many feed entries to consider per poll (default 50)',
          },
        ],
      },
    });

    // Web search — config = {query, max_results?}
    this.schemas.set('web_search', {
      kind: 'web_search',
      locatorSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', title: 'Search Query' },
          max_results: { type: 'number', minimum: 1, maximum: 50, default: 20 },
        },
        required: ['query'],
      },
      uiSchema: {
        title: 'Search Query',
        description: 'Monitor search results for new content',
        icon: 'search',
        color: 'blue',
        fields: [
          {
            name: 'query',
            label: 'Search Query',
            type: 'text',
            required: true,
            placeholder: 'artificial intelligence news',
            help: 'Enter the search terms you want to monitor',
          },
          {
            name: 'max_results',
            label: 'Max Results',
            type: 'number',
            required: false,
            validation: { min: 1, max: 50 },
            help: 'Maximum number of results to fetch per poll (default 20)',
          },
        ],
      },
    });

    // Web — config = {urls}
    this.schemas.set('web', {
      kind: 'web',
      locatorSchema: {
        type: 'object',
        properties: {
          urls: { type: 'array', items: { type: 'string', format: 'uri' }, title: 'URL List' },
        },
        required: ['urls'],
      },
      uiSchema: {
        title: 'URL List',
        description: 'Monitor a list of URLs for changes',
        icon: 'link',
        color: 'green',
        fields: [
          {
            name: 'urls',
            label: 'URLs',
            type: 'textarea',
            required: true,
            placeholder: 'https://example1.com\nhttps://example2.com',
            help: 'Enter one URL per line',
          },
        ],
      },
    });

    // Crawl — config = {base_url, max_depth?, max_urls?}
    this.schemas.set('crawl', {
      kind: 'crawl',
      locatorSchema: {
        type: 'object',
        properties: {
          base_url: { type: 'string', format: 'uri', title: 'Base URL' },
          max_depth: { type: 'number', minimum: 0, maximum: 3, default: 1 },
          max_urls: { type: 'number', minimum: 1, maximum: 200, default: 50 },
        },
        required: ['base_url'],
      },
      uiSchema: {
        title: 'Site Crawl',
        description: 'Discover and monitor pages of a website (same-origin, bounded)',
        icon: 'globe',
        color: 'purple',
        fields: [
          {
            name: 'base_url',
            label: 'Base URL',
            type: 'url',
            required: true,
            placeholder: 'https://example.com',
            help: 'The page to start crawling from',
          },
          {
            name: 'max_depth',
            label: 'Max Depth',
            type: 'number',
            required: false,
            validation: { min: 0, max: 3 },
            help: 'How many link-hops to follow from the base page (default 1)',
          },
          {
            name: 'max_urls',
            label: 'Max Pages',
            type: 'number',
            required: false,
            validation: { min: 1, max: 200 },
            help: 'Cap on discovered pages per poll (default 50)',
          },
        ],
      },
    });
  }

  getSchema(kind: SourceKind): SourceConfigurationSchema | undefined {
    return this.schemas.get(kind);
  }

  getSupportedKinds(): SourceKind[] {
    return Array.from(this.schemas.keys());
  }

  validateConfiguration(kind: SourceKind, config: any): ValidationResult {
    const schema = this.getSchema(kind);
    if (!schema) {
      return {
        valid: false,
        errors: [`Unsupported source kind: ${kind}`],
      };
    }

    const errors: string[] = [];
    if (schema.locatorSchema.required) {
      for (const field of schema.locatorSchema.required) {
        if (!config[field] || (Array.isArray(config[field]) && config[field].length === 0)) {
          errors.push(`Missing required field: ${field}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  getFieldValue(config: any, fieldName: string): any {
    return config?.[fieldName];
  }

  setFieldValue(config: any, fieldName: string, value: any): any {
    return { ...config, [fieldName]: value };
  }
}

// Export singleton instance
export const sourceConfigurationRegistry = new SourceConfigurationRegistry();
