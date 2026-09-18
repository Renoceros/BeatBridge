# AGENT.md - BeatBridge Agent Guidelines & Operational Manual

## 1. Project Mission & Identity

**BeatBridge (`ytmusic-mcp-dj`)** turns YouTube Music into an agent-steered programmatic DJ playback engine.

- **Electron Host**: Embeds `music.youtube.com` in an isolated webview with persistent session cookies (`persist:ytmusic`). Eliminates Google Cloud API key requirements.
- **PlayerBridge Controller**: Injects scripts into the DOM to inspect real-time playback state and perform non-disruptive queue mutations.
- **InnerTube Client**: Reuses extracted session cookies (`SAPISID`) to communicate with YouTube Music's internal API for semantic search and algorithmic radio seed discovery.
- **Embedded MCP Server**: Runs an SSE server on `http://127.0.0.1:4382` providing Model Context Protocol tools.
- **Stdio Bridge (`ytmusic-mcp-bridge`)**: Standalone lightweight CLI proxy translating stdio to SSE for clients like Claude Desktop, Cursor, and custom CLI runtimes.

---

## 2. Agent Responsibilities & Workflow

When operating on this codebase, the agent must:

1. **Follow Specifications**: Treat [`documentation/PRD.md`](documentation/PRD.md) and [`documentation/TDD.md`](documentation/TDD.md) as single sources of truth for behavior, DOM selectors, endpoints, and tool schemas.
2. **Maintain State**: Update `TASK.json` when starting, advancing, or completing tasks. Document user-facing changes in `CHANGELOG.md`.
3. **Write Minimal, Pragmatic Code**: Stop at the first rung that works. Avoid speculative abstractions, unnecessary dependencies, and unused configuration options.
4. **Safety & Stability**: Do not disrupt active audio playback with page navigations or heavy synchronous DOM operations. Error handling must return clean MCP error responses rather than crashing the Electron host.

---

## 3. Repository Management Conventions

### Branching Convention
- Main development branch: `main`
- Feature branches: `feat/<short-description>` (e.g. `feat/electron-shell`, `feat/mcp-sse-server`)
- Fix branches: `fix/<short-description>` (e.g. `fix/queue-mutation-offset`)
- Chore & refactor: `chore/<short-description>` or `refactor/<short-description>`
- Documentation: `docs/<short-description>`

### Commit Message Convention
Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <description>

[optional body]

[optional footer(s)]
```

**Allowed Types:**
- `feat`: A new feature or MCP tool
- `fix`: A bug fix
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding or correcting tests
- `chore`: Maintenance, dependency updates, build tooling
- `docs`: Documentation updates only

**Examples:**
- `feat(player): implement DOM queue insertion via Polymer dispatch`
- `feat(mcp): add SSE transport on port 4382`
- `fix(auth): correct SAPISID hash generation for InnerTube requests`
- `docs(readme): add setup instructions for Claude Desktop`

---

## 4. Codebase Architecture & Key Files

```
BeatBridge/
├── documentation/
│   ├── PRD.md              # Product Requirements Document
│   └── TDD.md              # Technical Design Document
├── src/                    # (Target structure)
│   ├── main/               # Electron main process entry & window management
│   ├── bridge/             # PlayerBridge DOM injection & queue mutation logic
│   ├── innertube/          # Authenticated YouTube Music internal client
│   └── mcp/                # MCP Server (SSE transport, tool handlers)
├── bin/                    # Stdio-to-SSE CLI bridge proxy (ytmusic-mcp-bridge)
├── AGENT.md                # Agent instructions & repo rules
├── CHANGELOG.md            # Version and feature changelog
├── TASK.json               # Structured task progress tracker
└── package.json            # Scripts & dependencies
```

---

## 5. Testing & Verification Checklist

Before marking any task as complete in `TASK.json`:
- [ ] Build succeeds with zero TypeScript errors.
- [ ] Stdio proxy correctly proxies JSON-RPC messages to SSE.
- [ ] Player state reads accurately reflect playback.
- [ ] Queue mutation executes without triggering page refresh or audio pause.
- [ ] Error conditions return graceful MCP error payloads.
