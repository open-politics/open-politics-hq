/**
 * Source Configuration Registry
 * 
 * Manages source type schemas and provides a unified interface for source configuration.
 * Follows the same schema-driven pattern as AnnotationSchema for consistency.
 */

import { JSONSchema7 } from 'json-schema';

export type SourceKind = 'rss' | 'search' | 'url_list' | 'site_discovery' | 'upload';

export interface SourceConfigurationSchema {
  kind: SourceKind;
  locatorSchema: JSONSchema7;
  providerSchema: JSONSchema7;
  processingSchema: JSONSchema7;
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
    // RSS Source Schema
    this.schemas.set('rss', {
      kind: 'rss',
      locatorSchema: {
        type: 'object',
        properties: {
          feed_url: {
            type: 'string',
            format: 'uri',
            title: 'RSS Feed URL'
          }
        },
        required: ['feed_url']
      },
      providerSchema: {
        type: 'object',
        properties: {
          scraping_provider: {
            type: 'string',
            enum: ['newspaper4k', 'opol'],
            default: 'newspaper4k'
          }
        }
      },
      processingSchema: {
        type: 'object',
        properties: {
          max_items: { type: 'number', minimum: 1, maximum: 100, default: 50 },
          scrape_full_content: { type: 'boolean', default: true },
          create_image_assets: { type: 'boolean', default: true }
        }
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
            help: 'Enter the URL of the RSS feed you want to monitor'
          }
        ]
      }
    });

    // Search Source Schema
    this.schemas.set('search', {
      kind: 'search',
      locatorSchema: {
        type: 'object',
        properties: {
          search_config: {
            type: 'object',
            properties: {
              query: { type: 'string', title: 'Search Query' },
              provider: { type: 'string', enum: ['tavily', 'searxng', 'exa'], default: 'tavily' },
              max_results: { type: 'number', minimum: 1, maximum: 50, default: 10 },
              search_depth: { type: 'string', enum: ['basic', 'advanced'], default: 'basic' },
              include_domains: { type: 'array', items: { type: 'string' } },
              exclude_domains: { type: 'array', items: { type: 'string' } },
              date_range: { type: 'string' },
              topic: { type: 'string', enum: ['general', 'news', 'finance', 'tech'], default: 'general' },
              chunks_per_source: { type: 'number', minimum: 1, maximum: 10, default: 3 },
              include_images: { type: 'boolean', default: false },
              include_answer: { type: 'boolean', default: true },
              days: { type: 'number', minimum: 1, maximum: 365, default: 7 }
            },
            required: ['query']
          }
        },
        required: ['search_config']
      },
      providerSchema: {
        type: 'object',
        properties: {
          search_provider: {
            type: 'string',
            enum: ['tavily', 'searxng', 'exa'],
            default: 'tavily'
          }
        }
      },
      processingSchema: {
        type: 'object',
        properties: {
          scrape_content: { type: 'boolean', default: true },
          deduplication: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean', default: true },
              lookback_days: { type: 'number', minimum: 1, maximum: 30, default: 7 }
            }
          }
        }
      },
      uiSchema: {
        title: 'Search Query',
        description: 'Monitor search results for new content',
        icon: 'search',
        color: 'blue',
        fields: [
          {
            name: 'search_config.query',
            label: 'Search Query',
            type: 'text',
            required: true,
            placeholder: 'artificial intelligence news',
            help: 'Enter the search terms you want to monitor'
          },
          {
            name: 'search_config.provider',
            label: 'Search Provider',
            type: 'select',
            required: true,
            options: [
              { label: 'Tavily', value: 'tavily' },
              { label: 'SearXNG', value: 'searxng' },
              { label: 'Exa', value: 'exa' }
            ],
            help: 'Choose which search provider to use'
          },
          {
            name: 'search_config.max_results',
            label: 'Max Results',
            type: 'number',
            required: false,
            validation: { min: 1, max: 50 },
            help: 'Maximum number of results to fetch per search'
          },
          {
            name: 'search_config.include_domains',
            label: 'Include Domains',
            type: 'multiselect',
            required: false,
            placeholder: 'techcrunch.com, arstechnica.com',
            help: 'Only include results from these domains (optional)'
          },
          {
            name: 'search_config.exclude_domains',
            label: 'Exclude Domains',
            type: 'multiselect',
            required: false,
            placeholder: 'spam.com, ads.com',
            help: 'Exclude results from these domains (optional)'
          },
          {
            name: 'search_config.topic',
            label: 'Topic',
            type: 'select',
            required: false,
            options: [
              { label: 'General', value: 'general' },
              { label: 'News', value: 'news' },
              { label: 'Finance', value: 'finance' },
              { label: 'Technology', value: 'tech' }
            ],
            help: 'Search topic for better results'
          },
          {
            name: 'search_config.search_depth',
            label: 'Search Depth',
            type: 'select',
            required: false,
            options: [
              { label: 'Basic', value: 'basic' },
              { label: 'Advanced', value: 'advanced' }
            ],
            help: 'Search depth for more comprehensive results'
          },
          {
            name: 'search_config.include_images',
            label: 'Include Images',
            type: 'boolean',
            required: false,
            help: 'Include images in search results'
          },
          {
            name: 'search_config.include_answer',
            label: 'Include AI Answer',
            type: 'boolean',
            required: false,
            help: 'Include AI-generated answer summary'
          }
        ]
      }
    });

    // URL List Source Schema
    this.schemas.set('url_list', {
      kind: 'url_list',
      locatorSchema: {
        type: 'object',
        properties: {
          urls: {
            type: 'array',
            items: { type: 'string', format: 'uri' },
            title: 'URL List'
          }
        },
        required: ['urls']
      },
      providerSchema: {
        type: 'object',
        properties: {
          scraping_provider: {
            type: 'string',
            enum: ['newspaper4k', 'opol'],
            default: 'newspaper4k'
          }
        }
      },
      processingSchema: {
        type: 'object',
        properties: {
          scrape_immediately: { type: 'boolean', default: true },
          use_bulk_scraping: { type: 'boolean', default: true },
          max_threads: { type: 'number', minimum: 1, maximum: 10, default: 4 }
        }
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
            placeholder: 'https://example1.com\nhttps://example2.com\nhttps://example3.com',
            help: 'Enter one URL per line'
          }
        ]
      }
    });

    // Site Discovery Source Schema
    this.schemas.set('site_discovery', {
      kind: 'site_discovery',
      locatorSchema: {
        type: 'object',
        properties: {
          base_url: {
            type: 'string',
            format: 'uri',
            title: 'Base URL'
          }
        },
        required: ['base_url']
      },
      providerSchema: {
        type: 'object',
        properties: {
          scraping_provider: {
            type: 'string',
            enum: ['newspaper4k', 'opol'],
            default: 'newspaper4k'
          }
        }
      },
      processingSchema: {
        type: 'object',
        properties: {
          max_depth: { type: 'number', minimum: 1, maximum: 5, default: 2 },
          max_urls: { type: 'number', minimum: 1, maximum: 100, default: 20 },
          use_source_analysis: { type: 'boolean', default: true },
          process_rss_feeds: { type: 'boolean', default: true }
        }
      },
      uiSchema: {
        title: 'Site Discovery',
        description: 'Discover and monitor content from a website',
        icon: 'globe',
        color: 'purple',
        fields: [
          {
            name: 'base_url',
            label: 'Base URL',
            type: 'url',
            required: true,
            placeholder: 'https://example.com',
            help: 'Enter the base URL of the website to discover'
          }
        ]
      }
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
        errors: [`Unsupported source kind: ${kind}`]
      };
    }

    // Simple validation - in a real implementation, you'd use a JSON Schema validator
    const errors: string[] = [];
    
    // Validate locator schema
    if (schema.locatorSchema.required) {
      for (const field of schema.locatorSchema.required) {
        if (!config[field]) {
          errors.push(`Missing required field: ${field}`);
        }
      }
    }

    // Validate search_config specifically
    if (kind === 'search' && config.search_config) {
      if (!config.search_config.query) {
        errors.push('Search query is required');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  getFieldValue(config: any, fieldName: string): any {
    if (fieldName.includes('.')) {
      const parts = fieldName.split('.');
      let value = config;
      for (const part of parts) {
        value = value?.[part];
      }
      return value;
    }
    return config[fieldName];
  }

  setFieldValue(config: any, fieldName: string, value: any): any {
    const newConfig = { ...config };
    if (fieldName.includes('.')) {
      const parts = fieldName.split('.');
      let current = newConfig;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) {
          current[parts[i]] = {};
        }
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
    } else {
      newConfig[fieldName] = value;
    }
    return newConfig;
  }
}

// Export singleton instance
export const sourceConfigurationRegistry = new SourceConfigurationRegistry();




