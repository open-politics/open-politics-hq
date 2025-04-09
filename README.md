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

### Clone the repository
```bash
git clone https://github.com/open-politics/open-politics.git
```

### Change .env.example to .env
```bash
cd open-politics
mv .env.example .env
```

### Run the docker compose file
```bash
docker compose up
```

### Go to the app
#### Log in
With the .env account set as superuser:
```bash 
http://localhost:3000/accounts/login
```
```bash 
FIRST_SUPERUSER=example@example.com
FIRST_SUPERUSER_PASSWORD=example
```

#### Home
Click on "Desk" in the header or go to:
```bash
http://localhost:3000/desks/home
```

#### Globe
If you run this in combination with a [local opol stack](https://github.com/open-politics/opol/blob/main/opol/stack/README.md) and your opol installation has had a few minutes to boot up, you can visit the globe interface at:
```bash 
http://localhost:3000/desks/home/globe
```


## Contact


## License
*Coming soon*
