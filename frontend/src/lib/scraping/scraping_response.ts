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

// Define the structure of the response from the /scrape_article endpoint
export type ScrapeArticleResponse = {
    title: string;
    text_content: string;
    original_data: OriginalScrapeArticleData;
};

