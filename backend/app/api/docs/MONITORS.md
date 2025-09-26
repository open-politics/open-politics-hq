---
title: "Automated Monitors"
description: "Set up intelligent monitoring systems that automatically analyze new content as it arrives in your bundles, ensuring continuous intelligence gathering without manual intervention."
---

## Overview

Monitors automatically analyze new content as it arrives in your bundles. Set them up once and they'll continuously process new documents, articles, or data using your analysis schemas.

<CardGroup cols={2}>
  <Card title="Continuous Monitoring" icon="eye">
    Automatically process new content as it arrives in your bundles
  </Card>
  <Card title="Smart Analysis" icon="brain">
    Apply your analysis schemas to new content without manual intervention
  </Card>
  <Card title="Flexible Scheduling" icon="clock">
    Configure monitoring frequency based on your data sources and needs
  </Card>
  <Card title="Quality Control" icon="shield-check">
    Built-in error handling and retry mechanisms for reliable processing
  </Card>
</CardGroup>

<Note>
**Beta Feature**: Monitors are currently in beta. Core functionality is stable, with advanced features and UI improvements coming soon.
</Note>

---

## How Monitors Work

### The Monitoring Process

<Steps>
<Step title="Content Detection">
  Monitors continuously watch specified bundles for new assets:
  
  - **RSS Feed Updates**: New articles from monitored feeds
  - **Manual Uploads**: Documents added by team members
  - **Search Results**: New content from automated searches
  - **Bulk Imports**: Large datasets added to bundles
  
  *[Screenshot: Monitor detecting new content]*
</Step>

<Step title="Automatic Analysis">
  When new content is detected, monitors automatically:
  
  - Apply your pre-configured analysis schemas
  - Process content using your preferred AI models  
  - Generate structured annotations and insights
  - Handle errors and retry failed analysis
  
  *[Screenshot: Automatic analysis in progress]*
</Step>

<Step title="Result Integration">
  Analysis results are seamlessly integrated:
  
  - Added to your existing annotation runs
  - Made available in analysis dashboards
  - Searchable through the chat interface
  - Included in automated reports
  
  *[Screenshot: Results integration dashboard]*
</Step>

<Step title="Notification & Review">
  Stay informed about monitor activity:
  
  - Real-time notifications for new analysis
  - Summary reports of monitoring activity
  - Quality alerts for failed or low-confidence analysis
  - Performance metrics and usage statistics
  
  *[Screenshot: Monitor activity notifications]*
</Step>
</Steps>

### Monitor Types

<Tabs>
<Tab title="Bundle Monitors">
  **Watch specific bundles for new content**
  
  - Monitor news collections for breaking stories
  - Track document repositories for new releases
  - Watch research databases for fresh data
  - Monitor social media collections for trending topics
  
  **Configuration**:
  - Target bundles to monitor
  - Analysis schemas to apply
  - Processing frequency
  - Quality thresholds
</Tab>

<Tab title="Source Monitors">
  **Monitor external data sources directly**
  
  - RSS feeds for news and blog updates
  - Government databases for new publications
  - Social media APIs for relevant posts
  - Web scraping for site changes
  
  **Configuration**:
  - Source URLs and credentials
  - Content filtering rules
  - Update frequency
  - Processing options
</Tab>

<Tab title="Search Monitors">
  **Continuously search for new relevant content**
  
  - Monitor web search results for specific queries
  - Track academic databases for new publications
  - Watch news aggregators for topic coverage
  - Monitor social platforms for keyword mentions
  
  **Configuration**:
  - Search queries and parameters
  - Source preferences
  - Relevance thresholds
  - Analysis workflows
</Tab>
</Tabs>

---

## Setting Up Monitors

### Basic Monitor Configuration

<Steps>
<Step title="Choose Your Target">
  Select what you want to monitor:
  
  - **Existing Bundle**: Monitor a bundle you've already created
  - **New Collection**: Create a bundle specifically for monitoring
  - **Multiple Bundles**: Monitor several related collections
  
  *[Screenshot: Monitor target selection]*
</Step>

<Step title="Select Analysis Schemas">
  Choose which analysis to run automatically:
  
  - **Entity Extraction**: Automatically identify people, organizations, locations
  - **Sentiment Analysis**: Track sentiment changes over time
  - **Topic Classification**: Categorize new content automatically
  - **Custom Schemas**: Apply your specialized analysis workflows
  
  *[Screenshot: Schema selection for monitors]*
</Step>

<Step title="Configure Processing">
  Set up processing parameters:
  
  - **Model Selection**: Choose between local and cloud models
  - **Processing Frequency**: How often to check for new content
  - **Quality Thresholds**: Minimum confidence levels for results
  - **Error Handling**: Retry settings and failure notifications
  
  *[Screenshot: Monitor processing configuration]*
</Step>

<Step title="Set Schedule & Limits">
  Configure monitoring behavior:
  
  - **Check Frequency**: Every hour, daily, weekly, or custom schedule
  - **Processing Limits**: Maximum assets to process per run
  - **Resource Constraints**: CPU and memory limits for processing
  - **Cost Controls**: Limits for cloud model usage
  
  *[Screenshot: Monitor scheduling interface]*
</Step>
</Steps>

### Advanced Monitor Features

<Tabs>
<Tab title="Conditional Processing">
  **Smart filtering for relevant content**
  
  Set up conditions that determine when analysis should run:
  - Content length thresholds
  - Keyword presence requirements
  - Source reliability filters
  - Date and time constraints
  
  *[Screenshot: Conditional processing rules]*
</Tab>

<Tab title="Multi-Stage Analysis">
  **Chain multiple analysis steps**
  
  Create workflows that:
  - First extract entities from new content
  - Then analyze sentiment if entities are relevant
  - Finally promote key findings to knowledge fragments
  - Generate alerts for high-priority results
  
  *[Screenshot: Multi-stage monitor workflow]*
</Tab>

<Tab title="Quality Control">
  **Ensure analysis reliability**
  
  Configure quality controls:
  - Confidence thresholds for accepting results
  - Human review triggers for uncertain analysis
  - Automatic retry with different models
  - Escalation rules for persistent failures
  
  *[Screenshot: Quality control configuration]*
</Tab>
</Tabs>

---

## Monitor Management

### Monitoring Performance

<Tabs>
<Tab title="Activity Dashboard">
  **Track monitor performance and results**
  
  View comprehensive metrics:
  - Content processing volume and speed
  - Analysis success rates and error patterns
  - Resource usage and cost tracking
  - Result quality and confidence scores
  
  *[Screenshot: Monitor performance dashboard]*
</Tab>

<Tab title="Result Quality">
  **Ensure high-quality automated analysis**
  
  Monitor quality indicators:
  - Confidence score distributions
  - Error rates by content type
  - Processing time trends
  - Model performance comparisons
  
  *[Screenshot: Quality metrics dashboard]*
</Tab>

<Tab title="Resource Usage">
  **Optimize processing efficiency**
  
  Track resource consumption:
  - CPU and memory usage patterns
  - API call volumes and costs
  - Storage utilization for results
  - Processing queue depths
  
  *[Screenshot: Resource usage monitoring]*
</Tab>
</Tabs>

### Monitor Maintenance

<Steps>
<Step title="Regular Review">
  Periodically review monitor performance:
  
  - Check analysis quality and relevance
  - Adjust schemas based on new requirements
  - Update source configurations for changing feeds
  - Optimize processing settings for efficiency
</Step>

<Step title="Error Management">
  Handle processing errors proactively:
  
  - Review failed analysis attempts
  - Adjust processing parameters
  - Update source access credentials
  - Refine content filtering rules
</Step>

<Step title="Scaling Considerations">
  Plan for growing data volumes:
  
  - Monitor processing queue lengths
  - Scale background worker capacity
  - Optimize schema complexity
  - Consider model selection for efficiency
</Step>
</Steps>

---

## Use Cases & Examples

### News Monitoring

<Tabs>
<Tab title="Breaking News Analysis">
  **Scenario**: Monitor breaking news for policy implications
  
  **Setup**:
  - RSS feeds from major news sources
  - Entity extraction and policy analysis schemas
  - Hourly monitoring frequency
  - Alerts for high-impact stories
  
  **Outcome**: Automatic analysis of breaking news with policy relevance scoring and key entity tracking.
</Tab>

<Tab title="Source Comparison">
  **Scenario**: Track how different sources cover the same events
  
  **Setup**:
  - Multiple news source feeds in separate bundles
  - Sentiment and bias analysis schemas
  - Daily monitoring with cross-source comparison
  - Automated bias detection and reporting
  
  **Outcome**: Continuous tracking of media bias and coverage differences across sources.
</Tab>
</Tabs>

### Government Monitoring

<Tabs>
<Tab title="Policy Document Tracking">
  **Scenario**: Monitor government sites for new policy documents
  
  **Setup**:
  - Web scraping monitors for government sites
  - Policy analysis and stakeholder extraction schemas
  - Weekly monitoring with change detection
  - Automatic categorization and priority scoring
  
  **Outcome**: Comprehensive tracking of government policy developments with automatic analysis.
</Tab>

<Tab title="Legislative Monitoring">
  **Scenario**: Track legislative proceedings and voting patterns
  
  **Setup**:
  - Monitors for legislative databases and proceedings
  - Voting analysis and position tracking schemas
  - Daily monitoring during active sessions
  - Automatic coalition and opposition mapping
  
  **Outcome**: Real-time analysis of legislative activity with relationship mapping.
</Tab>
</Tabs>

### Research Project Automation

<Tabs>
<Tab title="Academic Literature Monitoring">
  **Scenario**: Track new research publications in your field
  
  **Setup**:
  - Academic database RSS feeds
  - Research synthesis and methodology analysis schemas
  - Weekly monitoring with relevance filtering
  - Automatic literature review updates
  
  **Outcome**: Continuous literature review with automatic synthesis of new findings.
</Tab>

<Tab title="Social Media Monitoring">
  **Scenario**: Track social media discussions about your research topics
  
  **Setup**:
  - Social media API integrations
  - Sentiment and trend analysis schemas
  - Real-time monitoring with volume alerts
  - Automatic influencer and topic identification
  
  **Outcome**: Real-time social media intelligence with trend detection and sentiment tracking.
</Tab>
</Tabs>

---

## Best Practices

### Monitor Design

<Steps>
<Step title="Start Simple">
  Begin with basic monitoring setups:
  
  - Monitor one bundle with one schema
  - Use reliable, stable data sources
  - Set conservative processing limits
  - Monitor performance before scaling up
</Step>

<Step title="Design for Reliability">
  Build robust monitoring systems:
  
  - Use multiple data sources for redundancy
  - Configure appropriate retry settings
  - Set up error notifications and alerts
  - Plan for source failures and downtime
</Step>

<Step title="Optimize for Efficiency">
  Balance thoroughness with resource usage:
  
  - Use local models for high-volume processing
  - Reserve cloud models for complex analysis
  - Implement smart filtering to reduce noise
  - Monitor and adjust processing frequency
</Step>
</Steps>

### Quality Assurance

<Warning>
**Regular Review**: Automated analysis should be reviewed regularly to ensure quality and relevance. Set up periodic manual review processes for critical monitoring workflows.
</Warning>

<Steps>
<Step title="Establish Quality Baselines">
  Create benchmarks for monitor performance:
  
  - Expected analysis accuracy rates
  - Acceptable processing delays
  - Quality score thresholds
  - Error rate tolerances
</Step>

<Step title="Implement Review Processes">
  Set up regular review workflows:
  
  - Weekly quality spot checks
  - Monthly performance reviews
  - Quarterly schema optimization
  - Annual monitor strategy review
</Step>

<Step title="Continuous Improvement">
  Evolve your monitoring based on results:
  
  - Refine schemas based on analysis quality
  - Adjust source selections based on relevance
  - Optimize processing settings for efficiency
  - Update monitoring strategies based on research needs
</Step>
</Steps>

---

Automated Monitors enable continuous intelligence gathering that scales with your research needs. By setting up smart monitoring workflows, you can ensure that important developments in your areas of interest are automatically captured, analyzed, and integrated into your research.

Next, learn how to visualize your monitor results with [Analysis Dashboards](/dashboards) or explore the full system through [Intelligence Chat](/chat-tools).
