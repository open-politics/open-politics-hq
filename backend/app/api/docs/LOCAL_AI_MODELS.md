---
title: "Local AI Models with Ollama"
description: "Run Open Politics HQ completely locally using Ollama for privacy-focused intelligence analysis with full tool calling capabilities."
---

## Overview

Open Politics HQ supports local AI models through Ollama, allowing you to run analysis entirely on your own infrastructure. Local models can use the same tools and features as cloud models while keeping your data private.

<CardGroup cols={2}>
  <Card title="Complete Privacy" icon="shield">
    All analysis happens locally - your data never leaves your infrastructure
  </Card>
  <Card title="Full Tool Support" icon="wrench">
    Local models can search, analyze, and manipulate data just like cloud models
  </Card>
  <Card title="Unlimited Usage" icon="infinity">
    No API costs or rate limits - process as much content as you need
  </Card>
  <Card title="Offline Capable" icon="wifi-off">
    Works completely offline for air-gapped or secure environments
  </Card>
</CardGroup>

---

## Quick Setup

### Installing Ollama

<Steps>
<Step title="Install Ollama">
  Download and install Ollama on your system:
  
  **Linux/macOS:**
  ```bash
  curl -fsSL https://ollama.com/install.sh | sh
  ```
  
  **Windows:**
  Download from [ollama.com](https://ollama.com) and run the installer.
</Step>

<Step title="Pull Recommended Models">
  Download the models optimized for intelligence analysis:
  
  *[Video: Pulling models with Ollama demonstration]*
  
  **Essential Models:**
  - **llama3.1:8b** - General analysis and tool calling
  - **qwen2.5:14b** - Advanced reasoning and complex analysis
  - **nomic-embed-text** - Semantic search and embeddings
</Step>

<Step title="Configure Open Politics HQ">
  Update your environment configuration to use local models:
  
  - Set Ollama endpoint in your configuration
  - Verify model availability through the interface
  - Test tool calling capabilities
  
  *[Screenshot: Ollama configuration interface]*
</Step>

<Step title="Test Integration">
  Verify everything works through a simple chat interaction:
  
  *[Video: Complete chat demonstration with local models]*
</Step>
</Steps>

---

## Recommended Models

### Primary Analysis Models

<Tabs>
<Tab title="Llama 3.1:8b (Recommended)">
  **Best for**: General intelligence analysis and tool calling
  
  **Capabilities:**
  - Excellent tool calling support
  - Good reasoning for most analysis tasks
  - Fast processing for bulk operations
  - Reliable entity extraction and classification
  
  **Requirements:**
  - **RAM**: 8GB minimum, 16GB recommended
  - **Storage**: ~4.7GB model size
  - **Processing**: Works well on modern CPUs, GPU acceleration optional
  
  **Use Cases:**
  - News article analysis
  - Entity extraction from documents
  - Basic sentiment and topic classification
  - Interactive chat for data exploration
</Tab>

<Tab title="Qwen 2.5:14b (Advanced)">
  **Best for**: Complex reasoning and multi-step analysis
  
  **Capabilities:**
  - Superior reasoning and logic
  - Excellent tool orchestration
  - Better handling of complex schemas
  - Strong performance on multi-modal tasks
  
  **Requirements:**
  - **RAM**: 16GB minimum, 32GB recommended
  - **Storage**: ~8.5GB model size
  - **Processing**: Benefits significantly from GPU acceleration
  
  **Use Cases:**
  - Complex policy analysis
  - Multi-document synthesis
  - Knowledge graph construction
  - Advanced research workflows
</Tab>
</Tabs>

### Specialized Models

<Tabs>
<Tab title="Embedding Models">
  **nomic-embed-text**
  
  **Purpose**: Semantic search and document similarity
  - High-quality text embeddings
  - Optimized for retrieval tasks
  - Fast processing for large document collections
  
  **Requirements**: 4GB RAM, ~1.7GB storage
</Tab>

<Tab title="Code & Structured Data">
  **codellama:13b**
  
  **Purpose**: Analysis of structured data and code
  - Excellent for CSV and JSON analysis
  - Good at understanding data schemas
  - Helpful for technical document analysis
  
  **Requirements**: 16GB RAM, ~7.3GB storage
</Tab>
</Tabs>

---

## Tool Calling with Local Models

### How It Works

Local Ollama models can use the same tools as cloud models - they can search your data, run analysis, and generate reports.

<Info>
**Tool Support**: Local models use the Model Context Protocol (MCP) to access the same tools available to cloud models.
</Info>

### Available Tools for Local Models

<CardGroup cols={3}>
  <Card title="Search Tools" icon="search">
    - Asset search (text/semantic/hybrid)
    - Bundle exploration
    - Schema discovery
  </Card>
  <Card title="Analysis Tools" icon="brain">
    - Run annotation schemas
    - Create custom analysis
    - Multi-modal processing
  </Card>
  <Card title="Intelligence Tools" icon="lightbulb">
    - Generate reports
    - Curate knowledge fragments
    - Export results
  </Card>
</CardGroup>

### Example Local Model Workflow

<Steps>
<Step title="Research Question">
  **User**: "Find recent government documents about renewable energy and analyze them for policy commitments"
  
  *[Chat demonstration showing local model receiving and understanding the request]*
</Step>

<Step title="Tool Orchestration">
  **Local Model Actions**:
  1. **search_assets** - Find government documents containing "renewable energy"
  2. **analyze_assets** - Apply policy analysis schema to found documents
  3. **get_annotations** - Retrieve analysis results
  4. **create_report** - Generate summary of policy commitments found
  
  *[Chat demonstration showing tool calls executing locally]*
</Step>

<Step title="Results & Insights">
  **Local Model Response**: Comprehensive analysis with supporting evidence, all processed without any external API calls.
  
  *[Chat demonstration showing final results and evidence]*
</Step>
</Steps>

---

## Performance & Optimization

### Hardware Recommendations

<Tabs>
<Tab title="Minimum Requirements">
  **For basic intelligence analysis:**
  
  - **CPU**: 4+ cores, modern processor
  - **RAM**: 16GB (8GB for model, 8GB for system)
  - **Storage**: 50GB+ available space
  - **Network**: Not required for local processing
  
  **Suitable for:**
  - Small to medium document collections
  - Basic entity extraction and classification
  - Interactive chat with simple queries
</Tab>

<Tab title="Recommended Setup">
  **For optimal performance:**
  
  - **CPU**: 8+ cores with high clock speeds
  - **RAM**: 32GB+ for comfortable operation
  - **GPU**: NVIDIA GPU with 8GB+ VRAM (optional but recommended)
  - **Storage**: SSD with 100GB+ available space
  
  **Enables:**
  - Large-scale document processing
  - Complex multi-modal analysis
  - Multiple concurrent analysis runs
  - Advanced reasoning tasks
</Tab>

<Tab title="High-Performance Setup">
  **For production intelligence workflows:**
  
  - **CPU**: 16+ cores, server-grade processors
  - **RAM**: 64GB+ for large-scale processing
  - **GPU**: Multiple high-end GPUs for acceleration
  - **Storage**: NVMe SSD with 500GB+ space
  
  **Supports:**
  - Enterprise-scale document processing
  - Real-time analysis workflows
  - Multiple simultaneous users
  - Complex multi-model analysis pipelines
</Tab>
</Tabs>

### Performance Optimization

<Steps>
<Step title="Model Selection Strategy">
  Choose models based on your specific needs:
  
  - **Exploration**: Start with Llama 3.1:8b for fast, interactive analysis
  - **Production**: Use Qwen 2.5:14b for high-quality, reliable results
  - **Bulk Processing**: Optimize for speed with appropriate model sizing
  
  *[Screenshot: Model performance comparison dashboard]*
</Step>

<Step title="Resource Management">
  Optimize system resources for best performance:
  
  - **Memory Allocation**: Reserve sufficient RAM for model loading
  - **GPU Utilization**: Enable GPU acceleration when available
  - **Concurrent Processing**: Balance parallel operations with available resources
  
  *[Screenshot: Resource monitoring interface]*
</Step>

<Step title="Processing Optimization">
  Configure processing for your workload:
  
  - **Batch Sizes**: Optimize batch sizes for your hardware
  - **Context Windows**: Manage context length for efficiency
  - **Tool Call Frequency**: Balance tool usage with processing speed
</Step>
</Steps>

---

## Security & Privacy Benefits

### Data Privacy

<Check>
**Complete Data Sovereignty**: With local models, your intelligence data never leaves your control. No external APIs, no cloud processing, no data sharing.
</Check>

<Tabs>
<Tab title="Sensitive Content">
  **Perfect for analyzing:**
  - Classified or confidential documents
  - Personal information and PII
  - Internal organizational communications
  - Legally sensitive materials
  - Proprietary research data
</Tab>

<Tab title="Compliance Requirements">
  **Meets strict compliance needs:**
  - GDPR data protection requirements
  - Government security classifications
  - Healthcare privacy regulations (HIPAA)
  - Financial compliance standards
  - Academic research ethics
</Tab>
</Tabs>

### Air-Gapped Environments

<Info>
**Offline Operation**: Once models are downloaded, Open Politics HQ can operate completely offline, making it suitable for secure, air-gapped environments.
</Info>

<Steps>
<Step title="Initial Setup">
  Prepare for offline operation:
  - Download all required models while connected
  - Configure local storage and processing
  - Test all functionality before going offline
</Step>

<Step title="Offline Operations">
  Full functionality available offline:
  - Complete document analysis workflows
  - Interactive chat with tool calling
  - Dashboard creation and visualization
  - Report generation and export
</Step>
</Steps>

---

## Troubleshooting Local Models

### Common Issues

<Tabs>
<Tab title="Model Loading Problems">
  **Symptoms**: Models fail to load or respond slowly
  
  **Solutions**:
  - Check available RAM and close unnecessary applications
  - Verify Ollama service is running
  - Try smaller models if resources are limited
  - Enable GPU acceleration if available
  
  *[Screenshot: Model loading diagnostics]*
</Tab>

<Tab title="Tool Calling Issues">
  **Symptoms**: Local models don't use tools properly
  
  **Solutions**:
  - Verify tool calling support for your specific model
  - Check MCP server connectivity
  - Review tool call logs for errors
  - Try alternative models with better tool support
  
  *[Screenshot: Tool calling diagnostics]*
</Tab>

<Tab title="Performance Issues">
  **Symptoms**: Slow processing or system responsiveness
  
  **Solutions**:
  - Monitor system resource usage
  - Adjust batch sizes and concurrency settings
  - Consider model size vs. performance tradeoffs
  - Optimize hardware configuration
</Tab>
</Tabs>

### Optimization Tips

<Tip>
**GPU Acceleration**: If you have a compatible GPU, enable GPU acceleration in Ollama for significantly faster processing, especially for larger models.
</Tip>

<Steps>
<Step title="Monitor Resource Usage">
  Keep track of system performance:
  - CPU and memory utilization
  - GPU usage (if applicable)
  - Storage space for models and results
  - Processing queue lengths
</Step>

<Step title="Optimize Model Selection">
  Choose the right model for each task:
  - Use smaller models for simple, high-volume tasks
  - Reserve larger models for complex analysis
  - Switch models based on current system load
</Step>

<Step title="Configure Processing Limits">
  Set appropriate limits to maintain system stability:
  - Maximum concurrent analysis runs
  - Processing timeouts for long tasks
  - Memory limits for large document processing
</Step>
</Steps>

---

Local AI models with Ollama provide the perfect solution for privacy-conscious intelligence analysis. With full tool calling support and complete feature parity with cloud models, you can build sophisticated intelligence workflows while maintaining complete control over your data.

For more advanced local deployments, see our [Kubernetes Configuration](/deployment) guide or explore [Enterprise Security](/security) features.
