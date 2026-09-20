---
name: construct3-edit
description: >
  Edit the Construct 3 project in BlockBlastNew/ without breaking the editor.
  Use when adding sprites, layouts, event sheets, scripts, sounds, fonts, or
  changing project.c3proj. Triggers: Construct, C3, event sheet, object type,
  /construct3-edit.
---

# Edit Construct 3 (`BlockBlastNew/`)

Read `BlockBlastNew/llm-context.md` and `BlockBlastNew/AGENTS.md` first.

## Index file

`BlockBlastNew/project.c3proj` lists every object type, layout, event sheet, script, sound, font, icon. A file on disk that is not listed is invisible in Construct.

When adding something:

1. Write the JSON/image/script file in the correct subfolder.
2. Append its name to the matching `items` array in `project.c3proj`.
3. Give it a **unique SID** (15-digit integer). Grep existing `"sid"` values and do not collide.

## Folder map

| Subfolder | Contents |
|---|---|
| `objectTypes/` | One JSON per object type |
| `images/` | `object-animation-000.png` for sprites; lowercase object name for tiled/9-patch |
| `layouts/` | Layout JSON (layers + instances) |
| `eventSheets/` | Event sheet JSON |
| `scripts/` | TypeScript modules (`scriptsType` is `module`). List each `.ts` in `project.c3proj` with `script-info.purpose`: `main` (exactly one), `imports-for-events` (event-sheet imports), or `none`. |
| `sounds/` `music/` | Audio (prefer WebM Opus for C3; dump wav/ogg may need convert) |
| `fonts/` | WOFF |
| `files/` | Extra data (e.g. shape JSON copies) |

## Do not touch

- `*.uistate.json` — editor UI state
- `project.uistate.json`, `objecttypes.uistate.json`, layout `uistate/` bars

## Scripts vs events

Prefer TypeScript in `scripts/` for grid math, placement, clears, score. Do not fill `E_Game` unless the user asks — they own the event sheet.

Event sheets may call into TypeScript via `importsForEvents.ts` (`Game.pointerDown(x, y)`, `Game.on("cleared", ...)`).

Keep event JSON valid. Copy the structure of a real C3 event (conditions/actions/sid) — do not invent keys. Script blocks: `{ "eventType": "script", "language": "typescript", "script": "..." }`.

## Sprites

- Current `Block` is ~128×128, origin ~center.
- New animations: add frames under `images/` and list them in the object type JSON `animations.items`.
- Families group object types that share events/behaviors.

## Viewport

Do not change `viewportWidth` / `viewportHeight` (1080×1920) or `orientations: portrait` unless the user asks.

## After edits

Confirm `project.c3proj` still parses as JSON. Confirm every new SID is unique. Confirm new files are indexed.
