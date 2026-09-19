---
name: block-blast-gameplay
description: >
  Implement or fix Block Blast / Woodoku Blast clone rules in this repo.
  Use when building the 8x8 grid, piece bank, drag-drop, line clears, scoring,
  combo, lose condition, Journey goals, or piece spawn. Triggers: gameplay,
  board, shapes, scoring, combo, journey, invisible hand, /block-blast-gameplay.
---

# Block Blast gameplay

Read `Docs/phan-tich-assets-block-blast.md` before changing rules or numbers. Do not invent score tables, piece sets, or feel values.

Edit Construct 3 under `BlockBlastNew/`. Follow skill `construct3-edit` for file format. Load this skill's rules, then implement.

## Core loop (must match)

1. Empty **8×8** board.
2. Spawn **3** pieces into the bank (polyominoes from the shape database).
3. Player drags a piece onto the board. No rotation. Snap to cells if every occupied cell is in-bounds and empty.
4. After a successful place: write cells, score 1 per cell, then clear every **full row and full column** (simultaneous). Remaining blocks do not fall.
5. When the bank is empty, spawn 3 new pieces.
6. A piece that cannot be placed anywhere is greyed out but still draggable.
7. If **no** remaining bank piece can be placed, the game is lost (after a short delay, 0.5s in dump).

## Numbers (from dump)

- Place: +1 per cell
- Simultaneous clears: 10 / 20 / 60 / 100 / 150 / 250 for 1–6 lines
- Full board empty after a clear: +300
- Streak after 2 consecutive clears; reset after 3 non-clear placements
- `dragOffset.y = 125`, bank scale `0.5`, hover scale `1.25`
- Hit-stop 0.2s (timescale 0) and camera shake from 3+ lines

If Docs and dump disagree, dump JSON wins; update Docs.

## Shapes

Source: `Assets/Resources/jsondata/shapedatabases/ShapeDatabase-All.json`.

- `shapeData` is row-major. `0` = hole, nonzero = filled.
- Bounding box = `rows` × `cols`.
- Phase 1: families **Shape_0 through Shape_14** only (standard polyominoes). Later families are rare/special.
- `Shape_0` (1×1) is revive/mercy, gated at high BRC — do not spam it in normal Classic spawn.

Parse the JSON; do not hardcode 165 matrices by hand unless a tiny subset is needed for a first prototype.

## Spawn (do not skip forever)

Uniform random among placeable pieces is acceptable only for the first playable prototype. Next: Invisible Hand (`inv-hand-classic.bytes`) — terminator, perfect-fit, complementary-fit, BRC 0–100. Document any shortcut in the change.

## Journey

Same engine as Classic plus a 64-cell starting grid and AND-goals. Cell codes and overlays are in Docs §5.3. Do not build Journey until Classic loop works.

## Out of scope unless asked

Unity shaders, Sentis, ads, live-ops, IQ Puzzle, gacha, season pass.

## Done when

A player can place three pieces, clear a row or column, see score update, and lose when trapped.
