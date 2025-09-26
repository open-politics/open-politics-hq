---
title: "Intelligence Chat & Tool Calling"
description: "Interact with your data through AI-powered chat that can search, analyze, and synthesize information using advanced tool calling capabilities."
---

## Overview

The chat system lets you interact with your data through AI assistants. Instead of just answering questions, these AI models can search your documents, run analysis, and generate reports through tool calls.

<CardGroup cols={2}>
  <Card title="Interactive Research" icon="messages">
    Ask questions and get AI-powered analysis of your data in real-time
  </Card>
  <Card title="Tool Orchestration" icon="wrench">
    AI models can search, analyze, and manipulate data through function calls
  </Card>
  <Card title="Local & Cloud Models" icon="server">
    Full support for local Ollama models and cloud providers
  </Card>
  <Card title="Knowledge Curation" icon="database">
    Promote insights to permanent, searchable knowledge fragments
  </Card>
</CardGroup>

---

## How Intelligence Chat Works

### Tool-Enabled Conversations

Unlike traditional chatbots, Open Politics HQ's AI assistants have access to powerful tools that let them actively work with your data:

<Tabs>
<Tab title="Search & Discovery">
  **Find relevant content across your workspace**
  
  The AI can search through your assets using:
  - **Text Search**: Keyword-based search across all content
  - **Semantic Search**: AI-powered similarity search using embeddings
  - **Hybrid Search**: Combines both methods for best results
  - **Filtered Search**: Search within specific asset types, bundles, or time periods
  
  *[Screenshot: AI performing search tool call]*
</Tab>

<Tab title="Analysis & Annotation">
  **Run analysis workflows on discovered content**
  
  The AI can:
  - **Apply Existing Schemas**: Use your pre-defined analysis templates
  - **Create New Analysis**: Design custom analysis tasks for specific questions
  - **Multi-Modal Processing**: Analyze text, images, and media together
  - **Batch Processing**: Analyze large sets of documents efficiently
  
  *[Screenshot: AI creating and running analysis]*
</Tab>

<Tab title="Synthesis & Reporting">
  **Generate insights and reports from findings**
  
  The AI can:
  - **Aggregate Results**: Combine findings from multiple analysis runs
  - **Generate Reports**: Create comprehensive intelligence summaries
  - **Cross-Reference**: Connect findings across different data sources
  - **Timeline Construction**: Build chronological narratives from events
  
  *[Screenshot: AI generating report from analysis]*
</Tab>

<Tab title="Knowledge Curation">
  **Promote key insights to permanent knowledge**
  
  The AI can:
  - **Fragment Promotion**: Save important findings as searchable facts
  - **Relationship Mapping**: Connect entities and concepts across documents
  - **Fact Verification**: Cross-check claims against multiple sources
  - **Knowledge Building**: Build cumulative understanding over time
  
  *[Screenshot: AI curating knowledge fragments]*
</Tab>
</Tabs>

### Conversation Examples

<Tabs>
<Tab title="Research Question">
  **User**: "What are the main climate policy positions mentioned in recent government documents?"
  
  **AI Workflow**:
  1. Search for government documents containing climate policy information
  2. Apply entity extraction and policy analysis schemas
  3. Aggregate findings across all relevant documents
  4. Present summary with supporting evidence
  
  *[Screenshot: Research question conversation flow]*
</Tab>

<Tab title="Comparative Analysis">
  **User**: "Compare how different news sources are covering the infrastructure bill"
  
  **AI Workflow**:
  1. Search for infrastructure bill coverage across different sources
  2. Apply sentiment and bias analysis schemas
  3. Group results by news source
  4. Generate comparative analysis report
  5. Create visualizations showing differences
  
  *[Screenshot: Comparative analysis conversation]*
</Tab>

<Tab title="Event Investigation">
  **User**: "Find all documents related to the climate summit and create a timeline of key events"
  
  **AI Workflow**:
  1. Search for climate summit-related content
  2. Extract timeline information and key events
  3. Cross-reference dates and participants
  4. Generate chronological narrative
  5. Curate key findings as permanent knowledge
  
  *[Screenshot: Event investigation conversation]*
</Tab>
</Tabs>

---

## Available AI Models

Open Politics HQ supports both local and cloud-based AI models, giving you flexibility in terms of privacy, cost, and performance.

### Local Models (Ollama)

<Info>
**Privacy & Control**: Local models run entirely on your infrastructure, ensuring complete data privacy and unlimited usage without API costs.
</Info>

<Tabs>
<Tab title="Recommended Local Models">
  **Llama 3.1:8b**
  - **Best for**: General analysis, entity extraction, classification
  - **Performance**: Fast processing, good accuracy
  - **Requirements**: 8GB+ RAM, supports tool calling
  
  **Qwen 2.5:14b**
  - **Best for**: Complex reasoning, multi-step analysis
  - **Performance**: Slower but higher quality
  - **Requirements**: 16GB+ RAM, excellent tool calling
  
  **Nomic Embed Text**
  - **Best for**: Semantic search and embeddings
  - **Performance**: Optimized for retrieval tasks
  - **Requirements**: 4GB+ RAM, embedding generation
</Tab>

<Tab title="Setting Up Ollama">
  **Installation**:
  1. Install Ollama on your system
  2. Pull the models you want to use
  3. Configure Open Politics HQ to connect to your Ollama instance
  4. Test model availability through the chat interface
  
  **Benefits**:
  - Complete data privacy
  - No API rate limits
  - Unlimited usage
  - Offline capabilities
  
  *[Screenshot: Ollama model configuration]*
</Tab>
</Tabs>

### Cloud Models

<Tabs>
<Tab title="Gemini (Recommended)">
  **Gemini 2.5 Flash**
  - **Best for**: Multi-modal analysis, complex reasoning
  - **Features**: Thinking mode, structured output, image analysis
  - **Performance**: Fast and accurate, good cost/performance ratio
  
  **Configuration**: Add your Gemini API key to access Google's latest models with advanced capabilities.
</Tab>

<Tab title="OpenAI">
  **GPT-4o**
  - **Best for**: Complex analysis, high-quality reasoning
  - **Features**: Excellent tool calling, structured output
  - **Performance**: High quality but higher cost
  
  **GPT-4o Mini**
  - **Best for**: Simple analysis, cost-effective processing
  - **Features**: Fast processing, good for bulk operations
</Tab>
</Tabs>

---

## Tool Capabilities

The AI chat system has access to a comprehensive set of tools that enable sophisticated intelligence workflows:

### Data Discovery Tools

<CardGroup cols={2}>
  <Card title="Asset Search" icon="search">
    **search_assets**
    
    Find relevant documents using text, semantic, or hybrid search methods across your entire workspace.
  </Card>
  
  <Card title="Asset Details" icon="file-text">
    **get_asset_details**
    
    Retrieve detailed information about specific assets including content, metadata, and processing status.
  </Card>
  
  <Card title="Bundle Exploration" icon="folder">
    **list_bundles**
    
    Explore available bundles and their contents to understand data organization.
  </Card>
  
  <Card title="Schema Discovery" icon="schema">
    **list_schemas**
    
    View available analysis schemas to understand what types of analysis can be performed.
  </Card>
</CardGroup>

### Analysis Tools

<CardGroup cols={2}>
  <Card title="Run Analysis" icon="play">
    **analyze_assets**
    
    Create and execute annotation runs to analyze documents using existing or custom schemas.
  </Card>
  
  <Card title="Get Results" icon="clipboard-list">
    **get_annotations**
    
    Retrieve analysis results from completed runs for aggregation and synthesis.
  </Card>
  
  <Card title="Create Schemas" icon="plus">
    **create_schema**
    
    Design new analysis schemas when existing ones don't meet specific needs.
  </Card>
  
  <Card title="Custom Analysis" icon="settings">
    **execute_adapter**
    
    Run specialized analysis adapters for advanced processing workflows.
  </Card>
</CardGroup>

### Intelligence Generation Tools

<CardGroup cols={2}>
  <Card title="Report Creation" icon="document-text">
    **create_report**
    
    Generate comprehensive intelligence reports from analysis findings with full provenance tracking.
  </Card>
  
  <Card title="Knowledge Curation" icon="star">
    **curate_asset_fragment**
    
    Promote key findings to permanent, searchable knowledge fragments on assets.
  </Card>
  
  <Card title="Content Creation" icon="pencil">
    **compose_article**
    
    Create new articles with embedded assets and cross-references for knowledge synthesis.
  </Card>
  
  <Card title="Data Export" icon="download">
    **export_results**
    
    Export analysis results and datasets in various formats for external use.
  </Card>
</CardGroup>

---

## Example Workflows

### Basic Research Assistant

<Steps>
<Step title="Ask Research Questions">
  Start conversations with specific research questions:
  
  **Examples:**
  - "What are the main themes in recent climate policy documents?"
  - "Find mentions of renewable energy in government reports from this year"
  - "Compare how different sources report on the infrastructure bill"
  
  *[Screenshot: Research question interface]*
</Step>

<Step title="AI Searches and Analyzes">
  The AI automatically:
  - Searches for relevant documents
  - Applies appropriate analysis schemas
  - Processes results and identifies patterns
  - Presents findings with supporting evidence
  
  *[Screenshot: AI analysis workflow in progress]*
</Step>

<Step title="Refine and Explore">
  Continue the conversation to dive deeper:
  - Ask follow-up questions
  - Request analysis of specific aspects
  - Have the AI create custom analysis schemas
  - Generate reports from findings
  
  *[Screenshot: Follow-up analysis conversation]*
</Step>
</Steps>

### Advanced Intelligence Analysis

<Steps>
<Step title="Multi-Source Investigation">
  **Example**: "Investigate how media coverage of the climate summit changed over time"
  
  The AI will:
  - Search for climate summit coverage across multiple sources
  - Apply temporal and sentiment analysis
  - Track changes in coverage tone and focus
  - Generate timeline of coverage evolution
</Step>

<Step title="Cross-Modal Analysis">
  **Example**: "Analyze these protest photos along with news articles to understand the event"
  
  The AI will:
  - Process both images and text content
  - Identify people, locations, and activities
  - Cross-reference visual and textual information
  - Create comprehensive event analysis
</Step>

<Step title="Knowledge Building">
  **Example**: "Build a knowledge base of key policy positions from this document collection"
  
  The AI will:
  - Analyze documents for policy positions
  - Extract and structure key findings
  - Promote important insights to permanent fragments
  - Create searchable knowledge repository
</Step>
</Steps>

---

## Working with Different Model Types

### Local Ollama Models

<Tabs>
<Tab title="Privacy-Focused Analysis">
  **When to Use Local Models:**
  - Sensitive or confidential documents
  - Unlimited processing without API costs
  - Offline or air-gapped environments
  - Custom model fine-tuning
  
  **Setup Requirements:**
  - Sufficient RAM (8GB+ recommended)
  - GPU acceleration (optional but recommended)
  - Local Ollama installation
  
  *[Screenshot: Local model configuration]*
</Tab>

<Tab title="Model Selection">
  **Choose based on your needs:**
  
  - **Llama 3.1:8b**: Best balance of speed and quality
  - **Qwen 2.5:14b**: Higher quality for complex analysis
  - **Codellama**: Specialized for code and structured data
  - **Mistral**: Fast processing for simple extraction tasks
  
  *[Screenshot: Local model selection interface]*
</Tab>
</Tabs>

### Cloud Models

<Tabs>
<Tab title="High-Performance Analysis">
  **When to Use Cloud Models:**
  - Complex multi-modal analysis
  - Large-scale processing projects
  - Advanced reasoning requirements
  - Multi-language support
  
  **Model Recommendations:**
  - **Gemini 2.5 Flash**: Best overall performance and features
  - **GPT-4o**: Highest quality for complex reasoning
  - **Claude**: Excellent for long-form analysis
</Tab>

<Tab title="Cost Management">
  **Optimize cloud model usage:**
  
  - Use local models for bulk processing
  - Reserve cloud models for complex analysis
  - Monitor usage through the dashboard
  - Set up usage alerts and limits
  
  *[Screenshot: Model usage monitoring dashboard]*
</Tab>
</Tabs>

---

## Advanced Chat Features

### Context-Aware Conversations

The AI maintains context about your workspace and can reference:

- **Available Assets**: Knows what documents you have
- **Existing Analysis**: Can reference previous annotation runs
- **Bundle Organization**: Understands your data structure
- **Schema Capabilities**: Knows what analysis types are possible

*[Screenshot: Context-aware conversation showing workspace knowledge]*

### Multi-Turn Analysis

<Steps>
<Step title="Iterative Investigation">
  Build complex analysis through conversation:
  
  **Turn 1**: "Find documents about renewable energy policy"
  **Turn 2**: "Now analyze those documents for specific policy recommendations"  
  **Turn 3**: "Create a summary report of the top 5 recommendations"
  **Turn 4**: "Promote the most important recommendation as a key finding"
</Step>

<Step title="Hypothesis Testing">
  Use chat to test research hypotheses:
  
  **Turn 1**: "I think coverage of climate issues increased after the summit"
  **Turn 2**: "Search for climate coverage before and after the summit dates"
  **Turn 3**: "Analyze the volume and sentiment changes"
  **Turn 4**: "Generate a report confirming or refuting my hypothesis"
</Step>
</Steps>

### Collaborative Intelligence

<Info>
**Shared Context**: Chat conversations can reference shared bundles, schemas, and analysis results, making it easy for teams to collaborate on intelligence projects.
</Info>

<Tabs>
<Tab title="Team Research">
  **Scenario**: Multiple researchers working on the same project
  
  - AI maintains context across team members
  - References shared bundles and analysis results
  - Builds on previous team conversations
  - Tracks collaborative findings
  
  *[Screenshot: Team collaboration interface]*
</Tab>

<Tab title="Knowledge Handoffs">
  **Scenario**: Passing research between shifts or team members
  
  - AI can summarize previous work
  - Highlight key findings and next steps
  - Reference specific analysis runs and results
  - Maintain research continuity
  
  *[Screenshot: Knowledge handoff conversation]*
</Tab>
</Tabs>

---

## Best Practices

### Effective Chat Interactions

<Steps>
<Step title="Be Specific in Your Questions">
  **Good**: "Find government documents from 2024 that mention carbon pricing and analyze them for specific policy proposals"
  
  **Less Effective**: "Tell me about climate policy"
  
  The more specific you are, the better the AI can use its tools to find and analyze relevant information.
</Step>

<Step title="Build on Previous Analysis">
  Reference existing work in your questions:
  
  **Example**: "Based on the policy analysis we just completed, which organizations are mentioned most frequently as stakeholders?"
  
  This helps the AI understand context and build on previous findings.
</Step>

<Step title="Guide the Analysis Process">
  Help the AI understand your research goals:
  
  **Example**: "I'm researching coalition formation. Search for documents about environmental groups working together, then analyze them for collaboration patterns."
</Step>
</Steps>

### Optimizing Model Performance

<Tabs>
<Tab title="Model Selection">
  **Choose the right model for your task:**
  
  - **Simple Questions**: Use fast local models like Llama 3.1:8b
  - **Complex Analysis**: Use cloud models like Gemini 2.5 Flash
  - **Multi-Modal Tasks**: Use models that support image/media analysis
  - **Privacy-Sensitive**: Always use local Ollama models
</Tab>

<Tab title="Conversation Management">
  **Keep conversations focused:**
  
  - Start new conversations for different research topics
  - Use clear, specific language in your questions
  - Break complex requests into multiple steps
  - Reference specific assets or bundles when possible
</Tab>
</Tabs>

### Quality Assurance

<Warning>
**Verify AI Findings**: Always review AI-generated analysis and reports. The AI provides supporting evidence and tool call traces so you can validate its work.
</Warning>

<Steps>
<Step title="Review Tool Calls">
  Check what tools the AI used and with what parameters to understand how it arrived at its conclusions.
  
  *[Screenshot: Tool call history and parameters]*
</Step>

<Step title="Validate Evidence">
  Review the supporting evidence the AI provides for its findings, including text spans and source references.
  
  *[Screenshot: Evidence validation interface]*
</Step>

<Step title="Cross-Check Results">
  Use the AI to cross-check important findings against multiple sources or analysis methods.
</Step>
</Steps>

---

## Advanced Features

### Custom Tool Development

<Info>
**Extensible Architecture**: The tool calling system is built on MCP (Model Context Protocol), making it easy to add new capabilities as your research needs evolve.
</Info>

### Integration with External Systems

<Tabs>
<Tab title="API Integration">
  Connect external data sources and services through custom tools and adapters.
</Tab>

<Tab title="Workflow Automation">
  Use chat interactions to trigger complex, multi-step analysis workflows that run in the background.
</Tab>

<Tab title="Export & Sharing">
  Generate reports and datasets that can be shared with external collaborators or published publicly.
</Tab>
</Tabs>

### Performance Monitoring

<Steps>
<Step title="Track Model Usage">
  Monitor which models are being used and their performance characteristics.
  
  *[Screenshot: Model usage analytics]*
</Step>

<Step title="Optimize Costs">
  Balance between local and cloud models based on usage patterns and requirements.
</Step>

<Step title="Quality Metrics">
  Track the quality and usefulness of AI-generated analysis and reports.
</Step>
</Steps>

---

## Troubleshooting

### Common Issues

<Tabs>
<Tab title="Model Not Responding">
  **Symptoms**: Chat requests timeout or fail
  
  **Solutions**:
  - Check model availability and status
  - Verify API key configuration for cloud models
  - Restart Ollama service for local models
  - Check system resource usage
  
  *[Screenshot: Model status diagnostics]*
</Tab>

<Tab title="Tool Calls Failing">
  **Symptoms**: AI reports tool execution errors
  
  **Solutions**:
  - Verify workspace permissions
  - Check asset and bundle accessibility
  - Review tool call parameters
  - Check system logs for detailed errors
  
  *[Screenshot: Tool call error diagnostics]*
</Tab>

<Tab title="Poor Analysis Quality">
  **Symptoms**: AI provides irrelevant or low-quality analysis
  
  **Solutions**:
  - Use more specific questions and instructions
  - Try different models for comparison
  - Adjust analysis schema instructions
  - Provide more context about your research goals
</Tab>
</Tabs>

### Performance Optimization

<Tip>
**Model Switching**: Start conversations with fast local models for exploration, then switch to more powerful cloud models for detailed analysis when needed.
</Tip>

<Steps>
<Step title="Optimize Query Patterns">
  Structure your questions to make efficient use of available tools and data.
</Step>

<Step title="Manage Context Length">
  Keep conversations focused to avoid hitting model context limits with large datasets.
</Step>

<Step title="Use Appropriate Models">
  Match model capabilities to your specific analysis requirements.
</Step>
</Steps>

---

The Intelligence Chat system transforms Open Politics HQ into a powerful research assistant that can actively work with your data. By combining natural language interaction with structured tool calling, you can conduct sophisticated intelligence analysis through simple conversation.

Next, explore [Analysis Dashboards](/dashboards) to visualize your chat-generated insights or learn about [Automated Monitoring](/monitors) to keep your analysis up-to-date.
