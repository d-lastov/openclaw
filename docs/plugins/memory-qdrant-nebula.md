---
summary: "Qdrant + Nebula Graph memory plugin: hybrid vector + knowledge graph search with multi-language support"
read_when:
  - You want to use Qdrant for vector memory storage
  - You want knowledge graph relationships via Nebula Graph
  - You need multi-language memory capture (EN/RU/CS)
title: "Memory Qdrant Nebula Plugin"
---

# Memory Qdrant Nebula (plugin)

Hybrid memory storage combining Qdrant vector database with Nebula Graph
for semantic search and knowledge graph relationships.

Current providers for embeddings:

- `openai` (text-embedding-3-small/large)
- `gemini` (gemini-embedding-001)
- `yandex` (text-search-doc)
- `local` (embeddinggemma via node-llama-cpp)
- `auto` (tries OpenAI, then Gemini)

Quick mental model:

- Install plugin
- Start Qdrant and Nebula Graph services
- Configure under `plugins.entries.memory-qdrant-nebula.config`
- Use `openclaw qn-memory ...` CLI or agent tools

## Features

- **Hybrid search**: Vector similarity (semantic) + graph traversal (relationships)
- **Multi-language**: English, Russian, Czech trigger patterns for auto-capture
- **Knowledge graph**: Automatic entity extraction (people, organizations, concepts)
- **GDPR-compliant**: Full memory deletion with graph cleanup
- **Auto-recall**: Inject relevant memories before agent starts
- **Auto-capture**: Store important info after conversations

## Where it runs (local vs remote)

The plugin runs **inside the Gateway process**. Both Qdrant and Nebula Graph
can run locally or as remote services.

## Install

### Option A: install from npm (recommended)

```bash
openclaw plugins install @openclaw/memory-qdrant-nebula
```

Restart the Gateway afterwards.

### Option B: install from a local folder (dev, no copying)

```bash
openclaw plugins install ./extensions/memory-qdrant-nebula
cd ./extensions/memory-qdrant-nebula && pnpm install
```

Restart the Gateway afterwards.

## Prerequisites

### Qdrant

Start Qdrant locally:

```bash
docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant
```

Or use [Qdrant Cloud](https://cloud.qdrant.io/) with an API key.

### Nebula Graph

Start Nebula Graph locally:

```bash
docker-compose -f nebula-docker-compose.yml up -d
```

See [Nebula Graph docs](https://docs.nebula-graph.io/) for setup details.

## Config

Set config under `plugins.entries.memory-qdrant-nebula.config`:

```json5
{
  plugins: {
    entries: {
      "memory-qdrant-nebula": {
        enabled: true,
        config: {
          // Qdrant connection
          qdrant: {
            url: "http://localhost:6333",
            apiKey: "${QDRANT_API_KEY}", // optional, supports env vars
            collectionPrefix: "openclaw_memories",
          },

          // Nebula Graph connection
          nebula: {
            host: "localhost",
            port: 9669,
            user: "root",
            password: "${NEBULA_PASSWORD}", // supports env vars
            space: "openclaw_memory",
          },

          // Embedding provider
          embedding: {
            provider: "auto", // openai | gemini | yandex | local | auto
            model: "text-embedding-3-small",
            remote: {
              apiKey: "${OPENAI_API_KEY}",
              baseUrl: "https://api.openai.com/v1", // optional override
              headers: {}, // optional extra headers
            },
            fallback: "none", // openai | gemini | local | none
          },

          // Behavior
          autoCapture: true, // auto-store important info from conversations
          autoRecall: true, // inject memories before agent starts
          graphEnrichment: true, // extract entities and build knowledge graph
          hybridWeight: 0.7, // vector weight in hybrid search (0-1)
          languages: ["en", "ru"], // trigger languages for auto-capture
        },
      },
    },
  },
}
```

### Embedding providers

| Provider | Model                    | Dimensions | Notes                       |
| -------- | ------------------------ | ---------- | --------------------------- |
| `openai` | `text-embedding-3-small` | 1536       | Default, batch supported    |
| `openai` | `text-embedding-3-large` | 3072       | Higher quality              |
| `gemini` | `gemini-embedding-001`   | 768        | Requires GOOGLE_API_KEY     |
| `yandex` | `text-search-doc/latest` | 256        | Requires Yandex Cloud setup |
| `local`  | embeddinggemma           | 1024       | Requires node-llama-cpp     |

### Environment variables

The config supports `${VAR}` syntax for secrets:

- `OPENAI_API_KEY` or `GOOGLE_API_KEY` for embeddings
- `QDRANT_API_KEY` for Qdrant Cloud
- `NEBULA_PASSWORD` for Nebula Graph auth

## CLI

```bash
# Search memories
openclaw qn-memory search "what did we decide about the API"
openclaw qn-memory search "Ivan's preferences" --limit 10
openclaw qn-memory search "meeting notes" --no-graph

# Explore knowledge graph
openclaw qn-memory graph "Ivan"
openclaw qn-memory graph "Acme Corp" --depth 3

# Statistics
openclaw qn-memory stats

# Sync Qdrant and Nebula (rebuild graph links)
openclaw qn-memory sync
```

## Agent tools

### memory_recall

Search through long-term memories with hybrid vector + graph search.

Parameters:

- `query` (string, required): Search query
- `limit` (number, optional): Max results (default: 5)
- `includeGraph` (boolean, optional): Include graph relationships (default: true)

Example:

```
Use memory_recall to find what we discussed about the API design.
```

### memory_store

Save important information with automatic entity extraction.

Parameters:

- `text` (string, required): Information to remember
- `importance` (number, optional): 0-1 scale (default: auto-detected)
- `category` (string, optional): preference | fact | decision | entity | other

Example:

```
Use memory_store to remember: "Ivan prefers TypeScript over JavaScript"
```

### memory_graph

Explore the knowledge graph to find relationships and connected memories.

Parameters:

- `entity` (string, required): Entity name to explore
- `maxHops` (number, optional): Max relationship depth (default: 2)

Example:

```
Use memory_graph to explore relationships for "Acme Corp"
```

### memory_forget

Delete specific memories (GDPR-compliant with full graph cleanup).

Parameters:

- `query` (string, optional): Search to find memory
- `memoryId` (string, optional): Specific memory ID

Example:

```
Use memory_forget to delete any memories about my phone number.
```

## Multi-language triggers

Auto-capture recognizes memory-worthy phrases in multiple languages:

### English

- "remember", "don't forget", "keep in mind"
- "I prefer", "I like", "I want", "I need"
- "we decided", "we agreed", "we chose"

### Russian

- "запомни", "помни", "сохрани", "не забудь"
- "предпочитаю", "нравится", "хочу", "нужно"
- "решили", "договорились", "выбрали"
- "меня зовут", "мой телефон", "моя почта"

### Czech

- "zapamatuj si", "pamatuj", "nezapomen"
- "preferuji", "chci", "potrebuji"
- "rozhodli jsme se", "dohodli jsme se"

## Knowledge graph schema

### Entity types (Nebula tags)

- `Person`: name, phone, email, role
- `Organization`: name, type
- `Concept`: name, category, importance
- `Memory`: qdrantId, text, category — when graph enrichment is on, each stored memory is represented as a vertex with the Qdrant id, a truncated copy of the memory text (for debugging and graph traversal), and its category.

### Relationships (Nebula edges)

- `knows`: person-to-person relationships
- `related_to`: general entity relationships
- `mentions`: memory-to-entity links

## How hybrid search works

1. **Vector search**: Query is embedded and matched against Qdrant
2. **Entity extraction**: Names/concepts extracted from query
3. **Graph traversal**: Related memories found via Nebula relationships
4. **Score fusion**: Results merged with configurable `hybridWeight`

The `hybridWeight` parameter (0-1) controls vector vs graph influence:

- `0.0`: Pure graph search
- `0.5`: Equal weight
- `0.7`: Favor vector (default)
- `1.0`: Pure vector search

## Auto-recall (before_agent_start)

When `autoRecall: true`, the plugin:

1. Embeds the user's prompt
2. Searches for relevant memories (limit 3, score > 0.3)
3. Injects memories as `<relevant-memories>` context

This helps the agent recall relevant past information automatically.

## Auto-capture (agent_end)

When `autoCapture: true`, the plugin:

1. Extracts text from conversation messages
2. Filters for memory-worthy content (matching language triggers)
3. Checks for duplicates (cosine similarity > 0.95)
4. Stores new memories with auto-detected category and importance
5. Extracts entities and links them in the knowledge graph

Limit: 3 memories per conversation to avoid spam.

## Memory categories

| Category     | Description         | Examples                         |
| ------------ | ------------------- | -------------------------------- |
| `preference` | User likes/dislikes | "I prefer dark mode"             |
| `fact`       | Factual information | "The API uses REST"              |
| `decision`   | Agreed decisions    | "We decided to use PostgreSQL"   |
| `entity`     | Personal info       | "My email is `user@example.com`" |
| `other`      | General notes       | Everything else                  |
