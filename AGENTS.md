# Block Blast New — Grok project rules

Clone of **Block Blast / Woodoku Blast**. Gameplay is a Construct 3 project. The Unity dump is reference data only.

## Layout

| Path | Role |
|---|---|
| `BlockBlastNew/` | Construct 3 project — **this is the game**. Edit here. |
| `Assets/` | Extracted Unity dump. Read for rules, shapes, art, audio. Never treat as source to compile. |
| `Docs/phan-tich-assets-block-blast.md` | Canonical analysis of dump (scores, shapes, feel, Journey). Prefer this over memory. |

## Game DNA (do not invent)

- Board **8×8**. No gravity. Pieces **do not rotate**.
- Bank of **3** polyominoes. Refill after all three are placed.
- Clear **full rows and full columns**.
- Lose when **no remaining bank piece** can be placed.
- Unplaceable bank pieces grey out but remain draggable.
- Portrait **1080×1920**, letterbox.
- Numbers (score table, drag offset, combo, shapes) live in `Docs/phan-tich-assets-block-blast.md`. Read it before implementing scoring, piece spawn, or feel.

## Where code goes

- Prefer JavaScript modules in `BlockBlastNew/scripts/` for grid, bank, placement, clears, score.
- Event sheets are glue (start of layout, input). Do not hand-author huge event JSON if a script can do it.
- Register every new object, script, layout, event sheet, sound, or font in `BlockBlastNew/project.c3proj`.
- Never edit `*.uistate.json` (editor chrome only).
- Do not copy Unity C#, prefabs, or Sentis into Construct 3.

## Skills and agents

Project skills (`.grok/skills/`): `block-blast-gameplay`, `construct3-edit`, `block-blast-assets`.  
Project agents (`.grok/agents/`): `c3-implementer`, `asset-analyst`.

Load the matching skill before implementing. Spawn `asset-analyst` for dump research; `c3-implementer` for Construct 3 edits.

## Implementation order

1. 8×8 grid + 3-piece bank + drag/snap + row **and** column clear
2. Core shapes Shape_0–14 from `ShapeDatabase-All.json`
3. Classic score + combo + lose
4. Grey-out unplaceable pieces
5. Journey goals / overlay tiles
6. Invisible Hand (weighted spawn) — not uniform RNG
