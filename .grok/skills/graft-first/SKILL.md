---
name: graft-first
description: >
  Query the graft code graph before reading or editing this repo.
  Use at the start of any code change, debug, or "how does X work" question.
  Triggers: graft, đục code, where is, who calls, /graft-first.
---

# Graft first

Graph: `graft/` at the repo root (`D:\Code\BlockBlastNew\graft`). Map: `graft/INDEX.md`.

Before opening a `.ts` / `.json` source file:

```
graft ask "<task or bug>"
graft grep "<symbol or keyword>"
graft callers <symbol>
```

Then open **only** the `file:line` spans graft returns. Do not dump whole files to find a function.

| Command | Use |
|---|---|
| `graft ask "..."` | Ranked nodes for a question |
| `graft grep "pattern"` | Hits grouped by symbol |
| `graft callers <symbol>` | Incoming calls (`--direction out` = callees) |
| `graft skeleton <file>` | Signatures only |
| `graft build` | Refresh graph if cards look stale |

MCP equivalents if connected: `graft_find_code`, `graft_find_all`, `graft_trace_calls`, `graft_file_api`, `graft_repo_map`.

After a graft grep/callers/skeleton line that reports tokens saved, mention the sum once at the end of the user-facing reply.
