// Define the structure of the original data returned by the scraping library
export type OriginalScrapeArticleData = {
	url?: string;
	title?: string;
	text_content?: string;
	text?: string;
	summary?: string;
	meta_summary?: string;
	source?: string;
	publication_date?: string;
	top_image?: string;
	images?: Array<string>;
	last_updated?: string;
};

// Modern scraping response structure
export type ScrapeArticleData = {
	url: string;
	final_url?: string;
	title: string;
	text_content: string;
	publication_date?: string;
	authors: Array<string>;
	top_image?: string;
	images: Array<string>;
	summary: string;
	keywords: Array<string>;
	meta_description: string;
	meta_keywords: string;
	meta_lang: string;
	canonical_link: string;
	
	// Technical metadata
	scraped_at: string;
	scraping_method: string;
	content_length: number;
	image_count: number;
	author_count: number;
	keyword_count: number;
	
	// Raw data for debugging/advanced use
	raw_scraped_data?: {
		html_length: number;
		article_html_length: number;
		download_state?: any;
		is_parsed: boolean;
	};
	
	// Error handling
	scraping_error?: string;
};

// Define the structure of the response from the /scrape_article endpoint
export type ScrapeArticleResponse = {
    title: string;
    text_content: string;
    original_data: OriginalScrapeArticleData;
};

// Source analysis response structure
export type SourceAnalysisResponse = {
	base_url: string;
	brand: string;
	description: string;
	size: number;
	domain: string;
	favicon: string;
	logo_url: string;
	
	// RSS feeds
	rss_feeds: Array<{url: string; title: string}>;
	feed_urls: Array<string>;
	
	// Categories
	categories: Array<{url: string; title: string}>;
	category_urls: Array<string>;
	
	// Recent articles
	recent_articles: Array<{url: string; title: string}>;
	
	// Analysis metadata
	analyzed_at: string;
	analysis_method: string;
	error?: string;
};

// RSS feed browsing response structure
export type RssFeedBrowseResponse = {
	feed: {
		feed_url: string;
		title: string;
		description: string;
		language: string;
		updated: string;
		generator: string;
		total_entries: number;
	};
	items: Array<{
		title: string;
		link: string;
		summary: string;
		published: string;
		author: string;
		id: string;
		tags: Array<string>;
	}>;
	browsed_at: string;
};

