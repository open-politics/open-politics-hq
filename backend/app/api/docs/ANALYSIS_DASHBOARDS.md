---
title: "Analysis Dashboards"
description: "Create interactive, multi-panel dashboards to visualize and explore your analysis results through time series charts, geographic maps, distribution plots, and knowledge graphs."
---

## Overview

Analysis Dashboards visualize your annotation results through interactive charts, maps, and tables. Create multi-panel dashboards that combine different visualization types to explore your analysis findings.

Dashboard configurations are saved with annotation runs, making them shareable with your team.

<CardGroup cols={2}>
  <Card title="Multi-Panel Layouts" icon="layout-dashboard">
    Combine different visualization types in customizable grid layouts
  </Card>
  <Card title="Interactive Filtering" icon="filter">
    Each panel can have independent filters and display settings
  </Card>
  <Card title="Shareable Configurations" icon="share">
    Save and share complete dashboard configurations with your team
  </Card>
  <Card title="Real-Time Updates" icon="refresh">
    Dashboards automatically update as new analysis results arrive
  </Card>
</CardGroup>

---

## Visualization Types

Open Politics HQ provides five core visualization types, each optimized for different types of analysis insights:

### Data Tables

<Tabs>
<Tab title="Detailed Results View">
  **Perfect for**: Reviewing individual analysis results and detailed data exploration
  
  **Features**:
  - **Advanced Filtering**: Filter by any field, value, or combination
  - **Sorting & Grouping**: Organize results by multiple criteria
  - **Column Customization**: Show/hide fields based on your analysis focus
  - **Export Options**: Download filtered results in multiple formats
  
  **Use Cases**:
  - Reviewing entity extraction results
  - Validating analysis quality and accuracy
  - Finding specific documents or data points
  - Preparing data for external analysis
  
  *[Screenshot: Interactive data table with filtering]*
</Tab>

<Tab title="Field-Specific Views">
  **Drill down into specific analysis fields**
  
  - **Entity Tables**: Browse extracted people, organizations, locations
  - **Policy Position Tables**: Review stance analysis and proposals
  - **Event Tables**: Explore timeline data and relationships
  - **Sentiment Tables**: Analyze emotional tone and opinion data
  
  *[Screenshot: Field-specific table views]*
</Tab>
</Tabs>

### Time Series Charts

<Tabs>
<Tab title="Trend Analysis">
  **Perfect for**: Understanding how things change over time
  
  **Chart Types**:
  - **Line Charts**: Track continuous trends and patterns
  - **Bar Charts**: Compare volumes and counts across time periods
  - **Area Charts**: Show cumulative effects and proportions
  - **Multi-Series**: Compare multiple trends simultaneously
  
  **Use Cases**:
  - Tracking news coverage volume over time
  - Monitoring sentiment changes during events
  - Analyzing policy position evolution
  - Comparing source activity patterns
  
  *[Screenshot: Time series chart showing trend analysis]*
</Tab>

<Tab title="Event Correlation">
  **Overlay events with trend data**
  
  - **Event Markers**: Highlight specific dates and occurrences
  - **Annotation Overlays**: Show analysis results at specific points
  - **Correlation Analysis**: Identify relationships between events and trends
  - **Causation Tracking**: Explore potential cause-and-effect relationships
  
  *[Screenshot: Time series with event correlation]*
</Tab>
</Tabs>

### Geographic Maps

<Tabs>
<Tab title="Spatial Intelligence">
  **Perfect for**: Understanding geographic patterns and relationships
  
  **Map Features**:
  - **Point Mapping**: Show locations mentioned in documents
  - **Choropleth Maps**: Color regions by data intensity
  - **Cluster Analysis**: Group nearby events and activities
  - **Route Visualization**: Show movement and connection patterns
  
  **Use Cases**:
  - Mapping conflict zones and political events
  - Visualizing policy impact by region
  - Tracking movement of political figures
  - Analyzing geographic bias in news coverage
  
  *[Screenshot: Geographic map with political event data]*
</Tab>

<Tab title="Multi-Layer Analysis">
  **Combine different geographic data types**
  
  - **Event Layers**: Show different types of events simultaneously
  - **Temporal Animation**: Animate changes over time
  - **Density Mapping**: Show concentration patterns
  - **Network Overlays**: Display relationships between locations
  
  *[Screenshot: Multi-layer geographic analysis]*
</Tab>
</Tabs>

### Distribution Charts

<Tabs>
<Tab title="Pie Charts">
  **Perfect for**: Understanding proportions and distributions
  
  **Applications**:
  - **Source Distribution**: How much content comes from each source
  - **Topic Breakdown**: Proportion of different topics in your data
  - **Sentiment Distribution**: Balance of positive, negative, neutral content
  - **Entity Frequency**: Most mentioned people, organizations, locations
  
  *[Screenshot: Pie chart showing topic distribution]*
</Tab>

<Tab title="Histogram Analysis">
  **Understand data distributions and patterns**
  
  - **Confidence Distributions**: How certain is your analysis
  - **Content Length Patterns**: Distribution of document sizes
  - **Temporal Clustering**: When events typically occur
  - **Quality Metrics**: Distribution of analysis quality scores
  
  *[Screenshot: Histogram showing confidence distributions]*
</Tab>
</Tabs>

### Knowledge Graphs (Beta)

<Tabs>
<Tab title="Relationship Networks">
  **Perfect for**: Exploring connections between entities and concepts
  
  **Graph Types**:
  - **Entity Networks**: People, organizations, and their relationships
  - **Topic Maps**: How concepts and themes connect
  - **Citation Networks**: How documents reference each other
  - **Influence Maps**: Power and influence relationships
  
  **Use Cases**:
  - Mapping political coalitions and opposition groups
  - Understanding organizational relationships
  - Tracking information flow between sources
  - Identifying key influencers and decision makers
  
  *[Screenshot: Knowledge graph showing political relationships]*
</Tab>

<Tab title="Interactive Exploration">
  **Explore networks dynamically**
  
  - **Node Filtering**: Focus on specific entity types or relationships
  - **Path Finding**: Discover connections between distant entities
  - **Clustering**: Identify communities and groups
  - **Temporal Evolution**: Watch networks change over time
  
  *[Screenshot: Interactive knowledge graph exploration]*
</Tab>
</Tabs>

---

## Dashboard Configuration

### Creating Multi-Panel Dashboards

<Steps>
<Step title="Start with Default Layout">
  New annotation runs automatically get a default dashboard with:
  - Data table showing all results
  - Time series chart of analysis activity
  - Distribution chart of schema results
  
  *[Screenshot: Default dashboard layout]*
</Step>

<Step title="Add Custom Panels">
  Customize your dashboard by adding panels:
  
  - **Geographic Panel**: Add a map for location-based analysis
  - **Knowledge Graph Panel**: Show relationship networks
  - **Custom Chart Panel**: Focus on specific metrics or trends
  - **Filtered Table Panel**: Show subset of results with specific criteria
  
  *[Screenshot: Adding custom panels to dashboard]*
</Step>

<Step title="Configure Panel Settings">
  Each panel can be independently configured:
  
  - **Filters**: Show only relevant data in each panel
  - **Display Options**: Customize colors, labels, and formatting
  - **Interaction Settings**: Enable click-through and drill-down features
  - **Update Frequency**: Control how often panels refresh
  
  *[Screenshot: Panel configuration interface]*
</Step>

<Step title="Save and Share">
  Dashboard configurations are automatically saved:
  
  - **Persistent Settings**: Your layout and filters are preserved
  - **Team Sharing**: Share exact dashboard configurations
  - **Export Options**: Generate static reports from dashboards
  - **Version Control**: Track dashboard changes over time
  
  *[Screenshot: Dashboard sharing and export options]*
</Step>
</Steps>

### Panel-Specific Configuration

<Tabs>
<Tab title="Map Configuration">
  **Set up geographic visualizations**
  
  **Data Mapping**:
  - Choose which field contains location information
  - Configure geocoding and coordinate systems
  - Set up clustering and aggregation rules
  - Define color schemes and point sizes
  
  **Display Options**:
  - Base map selection (satellite, street, terrain)
  - Zoom levels and default view areas
  - Label display and popup content
  - Animation and interaction settings
  
  *[Screenshot: Map panel configuration]*
</Tab>

<Tab title="Chart Configuration">
  **Customize time series and bar charts**
  
  **Data Selection**:
  - Choose time field for x-axis
  - Select metrics for y-axis
  - Configure grouping and aggregation
  - Set up multi-series comparisons
  
  **Visual Settings**:
  - Chart type (line, bar, area)
  - Color schemes and themes
  - Axis labels and formatting
  - Legend and annotation options
  
  *[Screenshot: Chart panel configuration]*
</Tab>

<Tab title="Graph Configuration">
  **Set up knowledge graph visualizations**
  
  **Network Data**:
  - Define node types and properties
  - Configure edge types and weights
  - Set up filtering and clustering rules
  - Choose layout algorithms
  
  **Visual Settings**:
  - Node size and color mapping
  - Edge styling and labels
  - Layout and positioning options
  - Interaction and navigation controls
  
  *[Screenshot: Knowledge graph configuration]*
</Tab>
</Tabs>

---

## Advanced Dashboard Features

### Interactive Analysis

<Tabs>
<Tab title="Cross-Panel Filtering">
  **Coordinate analysis across multiple panels**
  
  - **Linked Selections**: Select data in one panel to filter others
  - **Coordinated Brushing**: Highlight related data across visualizations
  - **Drill-Down Navigation**: Click through from summary to detail views
  - **Context Preservation**: Maintain analysis context across panel interactions
  
  *[Screenshot: Cross-panel interaction demonstration]*
</Tab>

<Tab title="Dynamic Updates">
  **Real-time dashboard updates**
  
  - **Live Data**: Dashboards update as new analysis results arrive
  - **Progressive Loading**: Large datasets load incrementally
  - **Smart Refresh**: Only update changed data to maintain performance
  - **Background Processing**: Updates happen without disrupting analysis
  
  *[Screenshot: Real-time dashboard updates]*
</Tab>
</Tabs>

### Dashboard Templates

<Info>
**Reusable Configurations**: Save successful dashboard configurations as templates that can be applied to new analysis runs with similar data structures.
</Info>

<Tabs>
<Tab title="Research Templates">
  **Pre-configured dashboards for common research patterns**
  
  - **News Analysis Template**: Time series, sentiment, source comparison
  - **Policy Research Template**: Entity networks, position tracking, geographic impact
  - **Event Investigation Template**: Timeline, location mapping, stakeholder analysis
  - **Social Media Template**: Trend analysis, influence mapping, sentiment tracking
</Tab>

<Tab title="Custom Templates">
  **Create your own dashboard templates**
  
  - Save successful dashboard configurations
  - Apply templates to new analysis runs
  - Share templates with team members
  - Version control for template evolution
  
  *[Screenshot: Dashboard template management]*
</Tab>
</Tabs>

---

## Best Practices

### Dashboard Design

<Steps>
<Step title="Design for Your Audience">
  Consider who will use your dashboards:
  
  - **Executive Summaries**: High-level overviews with key metrics
  - **Analyst Workspaces**: Detailed views with drill-down capabilities
  - **Public Reports**: Clean, focused visualizations for public consumption
  - **Team Collaboration**: Interactive dashboards for group analysis
</Step>

<Step title="Tell a Story">
  Structure your dashboard to guide viewers through your analysis:
  
  - **Overview Panel**: Start with summary statistics and key findings
  - **Detail Panels**: Provide supporting evidence and detailed breakdowns
  - **Context Panels**: Show temporal or geographic context
  - **Action Panels**: Highlight actionable insights and recommendations
</Step>

<Step title="Optimize Performance">
  Design dashboards that load quickly and respond smoothly:
  
  - **Limit Data Volume**: Use filters to focus on relevant subsets
  - **Optimize Queries**: Choose efficient field combinations
  - **Progressive Loading**: Load summary data first, details on demand
  - **Cache Strategy**: Cache expensive computations when possible
</Step>
</Steps>

### Visual Design Guidelines

<Tip>
**Color Strategy**: Use consistent color schemes across panels to help viewers understand relationships between different visualizations.
</Tip>

<Steps>
<Step title="Choose Appropriate Visualizations">
  Match visualization types to your data:
  
  - **Temporal Data**: Use time series charts
  - **Geographic Data**: Use maps with appropriate projections
  - **Categorical Data**: Use pie charts or bar charts
  - **Network Data**: Use knowledge graphs
  - **Detailed Data**: Use tables with good filtering
</Step>

<Step title="Maintain Visual Consistency">
  Create cohesive dashboard experiences:
  
  - **Consistent Color Schemes**: Use the same colors for the same entities across panels
  - **Unified Filtering**: Coordinate filters across related panels
  - **Clear Labels**: Use descriptive titles and axis labels
  - **Logical Layout**: Arrange panels in a logical reading order
</Step>
</Steps>

---

## Troubleshooting

### Common Issues

<Tabs>
<Tab title="Slow Dashboard Loading">
  **Symptoms**: Dashboards take a long time to load or become unresponsive
  
  **Solutions**:
  - Reduce the amount of data being visualized
  - Add filters to focus on relevant subsets
  - Optimize panel configurations
  - Check system resource usage
  
  *[Screenshot: Performance optimization settings]*
</Tab>

<Tab title="Missing Data in Visualizations">
  **Symptoms**: Expected data doesn't appear in charts or maps
  
  **Solutions**:
  - Check panel filter settings
  - Verify data field mappings
  - Review analysis run completion status
  - Validate data format compatibility
  
  *[Screenshot: Data validation interface]*
</Tab>

<Tab title="Visualization Errors">
  **Symptoms**: Charts or maps display incorrectly or show errors
  
  **Solutions**:
  - Verify data types match visualization requirements
  - Check for null or invalid data values
  - Review field mapping configurations
  - Test with smaller data subsets
</Tab>
</Tabs>

### Performance Optimization

<Warning>
**Large Datasets**: Dashboards with thousands of data points may perform slowly. Use filtering and aggregation to focus on the most relevant information.
</Warning>

<Steps>
<Step title="Optimize Data Loading">
  Improve dashboard performance:
  
  - Use date range filters to limit temporal data
  - Apply relevance filters to focus on important results
  - Aggregate data when appropriate
  - Load panels progressively
</Step>

<Step title="Efficient Panel Design">
  Design panels for optimal performance:
  
  - Choose appropriate aggregation levels
  - Limit the number of data series in charts
  - Use sampling for very large datasets
  - Cache expensive computations
</Step>
</Steps>

---

## Integration with Analysis Workflows

### Dashboard-Driven Analysis

<Steps>
<Step title="Exploratory Analysis">
  Use dashboards to guide your research:
  
  - Start with overview visualizations to identify patterns
  - Use interactive filtering to focus on interesting subsets
  - Drill down into specific data points for detailed investigation
  - Generate new analysis runs based on dashboard insights
</Step>

<Step title="Hypothesis Testing">
  Test research hypotheses through visual exploration:
  
  - Create visualizations that would support or refute your hypothesis
  - Use filtering and comparison to test specific predictions
  - Look for unexpected patterns that challenge assumptions
  - Document findings through dashboard annotations
</Step>

<Step title="Report Generation">
  Use dashboards as the foundation for reports:
  
  - Export visualizations for inclusion in reports
  - Use dashboard insights to structure written analysis
  - Share interactive dashboards alongside static reports
  - Create presentation-ready visualizations
</Step>
</Steps>

### Collaborative Analysis

<Info>
**Team Dashboards**: Dashboard configurations are shared with annotation runs, making it easy for teams to collaborate on analysis and share insights.
</Info>

<Tabs>
<Tab title="Shared Workspaces">
  **Collaborate on analysis through shared dashboards**
  
  - Team members see the same visualizations and filters
  - Changes to dashboard configuration are tracked
  - Comments and annotations can be added to panels
  - Analysis insights are preserved for future reference
  
  *[Screenshot: Team collaboration on shared dashboard]*
</Tab>

<Tab title="Review Workflows">
  **Use dashboards for analysis review and validation**
  
  - **Quality Review**: Check analysis results for accuracy and completeness
  - **Peer Review**: Have colleagues validate findings and interpretations
  - **Stakeholder Presentation**: Share findings with external stakeholders
  - **Publication Preparation**: Create publication-ready visualizations
  
  *[Screenshot: Dashboard review and validation workflow]*
</Tab>
</Tabs>

---

## Advanced Features

### Custom Visualizations

<Tabs>
<Tab title="Specialized Charts">
  **Domain-specific visualization types**
  
  - **Political Network Maps**: Specialized layouts for political relationships
  - **Timeline Visualizations**: Enhanced temporal analysis with event correlation
  - **Influence Diagrams**: Show power and influence relationships
  - **Coalition Maps**: Visualize political alliances and opposition
  
  *[Screenshot: Specialized political visualization]*
</Tab>

<Tab title="Interactive Features">
  **Enhanced user interaction capabilities**
  
  - **Brushing and Linking**: Select data in one panel to highlight in others
  - **Zoom and Pan**: Navigate large datasets and geographic areas
  - **Hover Details**: Get instant information about data points
  - **Click-Through**: Navigate from visualizations to source documents
  
  *[Screenshot: Interactive dashboard features]*
</Tab>
</Tabs>

### Dashboard Analytics

<Steps>
<Step title="Usage Tracking">
  Monitor how dashboards are being used:
  
  - Track which panels are viewed most
  - Monitor filter usage patterns
  - Identify popular visualization types
  - Analyze user interaction patterns
</Step>

<Step title="Performance Metrics">
  Optimize dashboard performance:
  
  - Monitor loading times and responsiveness
  - Track data query performance
  - Identify resource usage patterns
  - Optimize based on usage data
</Step>
</Steps>

---

## Best Practices

### Effective Dashboard Design

<Steps>
<Step title="Start with Questions">
  Design dashboards around specific research questions:
  
  - What trends are you looking for?
  - What relationships need to be explored?
  - What evidence supports your hypotheses?
  - What insights need to be communicated?
</Step>

<Step title="Layer Information Logically">
  Structure dashboards from general to specific:
  
  - **Overview**: High-level summary and key metrics
  - **Trends**: Temporal patterns and changes
  - **Details**: Specific findings and evidence
  - **Context**: Supporting information and background
</Step>

<Step title="Enable Exploration">
  Design for interactive exploration:
  
  - Provide multiple ways to filter and slice data
  - Enable drill-down from summary to detail
  - Support hypothesis testing through interaction
  - Allow for serendipitous discovery
</Step>
</Steps>

### Quality and Validation

<Warning>
**Validate Visualizations**: Always verify that your visualizations accurately represent the underlying data. Check for missing data, incorrect aggregations, and misleading visual representations.
</Warning>

<Steps>
<Step title="Data Quality Checks">
  Ensure your visualizations are based on reliable data:
  
  - Review analysis confidence scores
  - Check for missing or null values
  - Validate geographic coordinates and temporal data
  - Verify entity resolution and deduplication
</Step>

<Step title="Visual Accuracy">
  Ensure visualizations accurately represent your data:
  
  - Check scale and proportion accuracy
  - Verify color mappings and legends
  - Test interactive features for correctness
  - Validate aggregation and calculation logic
</Step>

<Step title="Interpretation Guidelines">
  Provide context for dashboard users:
  
  - Document data sources and collection methods
  - Explain analysis methodologies and limitations
  - Provide interpretation guidelines for visualizations
  - Include confidence and uncertainty information
</Step>
</Steps>

---

Analysis Dashboards bring your intelligence analysis to life through interactive, visual exploration. By combining multiple visualization types in coordinated layouts, you can uncover insights that would be difficult to find in raw data alone.

The dashboard system integrates seamlessly with [Intelligence Chat](/chat-tools) for AI-guided exploration and [Automated Monitors](/monitors) for continuous intelligence updates.
