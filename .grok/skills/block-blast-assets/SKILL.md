---
name: block-blast-assets
description: >
  Research the Unity dump in Assets/ for Block Blast rules, shapes, art, and
  audio. Use when the user asks to study Assets, extract sprites, decode
  Journey grids, or check dump numbers. Triggers: Assets, Unity dump, shape
  database, journey levels, /block-blast-assets.
---

# Research `Assets/` dump

`Assets/` is an extracted Unity 6 build of Woodoku Blast / Block Blast. It is **not** the Construct 3 game. Do not "fix" dump JSON. Do not copy C# or prefabs into C3.

Canonical write-up: `Docs/phan-tich-assets-block-blast.md`. Update that doc if you find a factual error; do not fork a second analysis.

## Read these first

| File | Why |
|---|---|
| `Docs/phan-tich-assets-block-blast.md` | Already-extracted rules |
| `Assets/Resources/jsondata/shapedatabases/ShapeDatabase-All.json` | 165 pieces |
| `Assets/Resources/offlinedata/GameServerSettings.bytes` | Score, feel, modes (JSON despite `.bytes`) |
| `Assets/Resources/offlinedata/MechanicsConfig.bytes` | Gems, boxes, flowers, apples, revive |
| `Assets/Resources/offlinedata/offline-journey-levels.json` | 75 Journey levels |
| `Assets/Resources/offlinedata/inv-hand-classic.bytes` | Classic piece spawn |
| `Assets/Resources/offlinedata/inv-hand-journey.bytes` | Journey piece spawn |
| `Assets/SpriteAtlas/Blocks_Atlas.json` | Packed sprite names |

Many `.bytes` files are JSON. Open them as text.

## How to search

- Piece matrices: parse `shapeData` row-major with `rows`/`cols`.
- Journey cell codes: Docs §5.3 (`aa`–`ag`, gems `ba`–`bh`, overlays `\|ga`).
- Art: `Assets/Texture2D/`, `Assets/Sprite/`, atlas PNGs named `sactx-*Blocks_Atlas*`.
- Audio: `Assets/AudioClip/` (wav/ogg). Mixer groups: Music, SoundEffects, ClearStingers, VO.

## Output

When reporting, cite file paths. If extracting for C3, copy only the needed sprites/audio into `BlockBlastNew/images` or `sounds` and register them in `project.c3proj` (skill `construct3-edit`).
