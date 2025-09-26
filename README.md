# 🌐 Open Politics HQ

> Open source intelligence platform for political research  
> 🎬 [Watch Presentation](https://media.ccc.de/v/dg-111)

## What is Open Politics HQ?

![Exactly](.github/assets/images/exactly.png)

Open Politics HQ is an intelligence analysis platform that helps researchers process political information at scale. It combines AI language models with data analysis tools to extract insights from documents, news articles, and other content.

**Core capabilities:**
- Upload and process PDFs, web articles, CSVs, images, and media files
- Define analysis tasks in natural language to extract structured data
- Chat with AI assistants that can search and analyze your data
- Create dashboards with charts, maps, and visualizations
- Set up automated monitoring for new content

**Built for:**
- Political researchers and journalists
- Policy analysts and advocacy groups  
- Academic researchers studying political processes
- Citizens tracking government activity and policy changes

#### Status
- 📝 **Development**: In late Beta
- 🛜 **Hosted Platform**: Coming soon at [https://open-politics.org](https://open-politics.org)

### Resources
- **This Repository**: The "UX side of things" - making information accessible via visual interfaces
- [**Data Engine "opol"**](https://github.com/open-politics/opol): Handles the "data side of things" including:
  - Data ingestion
  - Geo-tooling
  - AI capabilities

- **[User Documentation](https://docs.open-politics.org)** for user guides & tutorials
- **Technical Docs**: 
  - Documentation for this TypeScript NextJS (/open-politics-hq) repository will be updated soon
  - Technical documentation for opol is in the [opol repository](https://github.com/open-politics/opol)

## Table of Contents
- [About](#about)
- [Our Approach](#our-approach)
- [Key Features](#key-features)
- [Why Open Politics Exists](#why-open-politics-exists)
- [Usage/Installation](#usageinstallation)
- [Contributing](#contributing)
- [Contact](#contact)
- [License](#license)

Here's a glimpse of what we're building:

![Open Politics Vision](.github/assets/images/opol-data-on-globe.png)

[Opol](https://github.com/open-politics/opol) serves the data for the interactive globe visualisation of this webapp, displaying news articles processed through LLM classification, entity extraction, and geocoding for spatial representation.

![HQ Classification Runner](.github/assets/gifs/HQ-Recording-Runner-Github-001.gif)

The classification runner of HQ lets you classify, extract and work with structured data to analyse and visualise data according to your needs. The possibilities are endless!

## Key Features

### Core Functionality
- Multi-tenant workspace system
- Flexible data ingestion (CSV, PDF, URLs)
- AI-powered text classification
- Search and analysis tools
- Geospatial data handling

### Universal Data Transfer (New)
- Export/import functionality for seamless data sharing
- Self-contained dataset packages
- Relationship preservation across transfers
- Support for various data types (text, files, metadata)
- Configurable content inclusion

### Classification & Analysis
Run powerful classification tasks to extract structured data from unstructured text using LLMs.

### Data Sources Management
Manage various data sources including URL lists, text documents, and more in a unified interface.

### Workspaces
Organize your work in collaborative workspaces with customizable settings.

### Shareable Links
Share your resources with others through secure, customizable links:
- Share data sources, classification schemes, workspaces, and analysis results
- Set granular permission levels (read-only, edit, full access)
- Control access with expiration dates and usage limits
- Make resources public or private
- Track usage statistics

### Export & Import
Export your data in standardized formats and import them in other workspaces or share with colleagues.

## Why Open Politics Exists

Politics, news, conflicts, and legislative procedures are increasingly difficult to track and understand. Few have the time to read through the mountains of documents and news articles necessary to form a comprehensive understanding of political situations.

Technology offers tremendous possibilities to make political information more accessible. The advent of Large Language Models has expanded our capabilities for textual analysis and understanding. The ability to formulate research tasks in natural language opens new possibilities for analysing text data, potentially revolutionising how qualitative and quantitative research methods can be combined.

This project aims to bring together natural language LLM interfaces with classical data science methods to build tools that provide a comprehensive overview of political topics, including:
- Summaries of news articles
- Information about political actors
- Relationship networks
- Geographical contexts
- Historical patterns

If you're passionate about making politics more accessible and understandable for everyone, we'd love to hear from you! Please reach out or show your support by giving us a star on GitHub.

## Usage/Installation

### Prerequisites
- Python 3.8+
- Node.js 16+
- PostgreSQL 13+
- MinIO (for file storage)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/open-politics-hq.git
cd open-politics-hq
```

2. Install backend dependencies:
```bash
cd backend
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows
pip install -r requirements.txt
```

3. Install frontend dependencies:
```bash
cd frontend
npm install
```

4. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your settings
```

5. Initialize the database:
```bash
cd backend
alembic upgrade head
```

### Running the Application

1. Start the backend:
```bash
cd backend
uvicorn app.main:app --reload
```

2. Start the frontend:
```bash
cd frontend
npm run dev
```

## Architecture

The application follows a clean architecture pattern with clear separation of concerns:

- **Frontend**: React/Next.js with Zustand for state management
- **Backend**: FastAPI with SQLModel for data modeling
- **Storage**: MinIO for file storage
- **Background Tasks**: Celery for async processing

See `README-ARCHITECTURE.md` for detailed architecture documentation.

## Key Components

### Data Management
- Workspaces for multi-tenant isolation
- Flexible data source handling
- Classification schemes and jobs
- Dataset organization and sharing

### Universal Data Transfer
- Package-based export/import system
- Cross-instance entity tracking
- Relationship preservation
- File content handling
- Configurable transfer options

### Classification System
- Flexible scheme definition
- Multi-field classification
- Background job processing
- Result aggregation

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to your branch
5. Create a Pull Request

## Contact


## License
*Coming soon*
