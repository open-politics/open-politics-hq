# 🌐 Open Politics HQ

> "Open Source Political Intelligence" - What is that and why do we need it?  
> 🎬 [Watch Presentation](https://media.ccc.de/v/dg-111)

## About & how we are aiming to help with

![Exactly](.github/assets/images/exactly.png)

We're building a comprehensive open-source platform where civic research meets data science. We're democratising political analysis capabilities through accessible tools that help citizens navigate an increasingly complex information landscape.

Our integrated stack of data science tools gather, analyse, and visualise political data with clarity and depth. We combine the natural language capabilities of modern AI with structured analytical methods to make sense of the vast political information landscape.

## Our Approach

We're building tools that support:

**Analytical depth** - Working with news and political information through entity extraction, geospatial analysis, and relationship mapping

**Community transparency** - Developing in the open so everyone can contribute, inspect, and improve our methods

**Universal accessibility** - Creating multiple ways to interact with political data, from interactive visualisations to text-based interfaces

**Methodical research** - Combining technical innovation with structured analytical approaches to political information

**Collaborative analysis** - Sharing resources with team members and the public through flexible permission levels and shareable links

Whether you're analysing news coverage, tracking political advocacy efforts, generating visual reports, exploring geospatial data, or mapping structured arguments from coalition talks, we build tools that help make sense of today's information environment.

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
