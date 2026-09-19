# Construct 3 project (`BlockBlastNew/`)

This folder is a Construct 3 project. Format notes: `llm-context.md`. Official guide: [Construct's project format](https://www.construct.net/en/tutorials/constructs-project-format-3275).

## Always

- Viewport is **1080×1920**, portrait, `letterbox-scale`.
- `project.c3proj` is the index. New files are invisible until listed there.
- Ignore `*.uistate.json`.
- Object type JSON lives in `objectTypes/`. Sprite frames: `images/<object>-<animation>-<frame padded to 3>.png`.
- Event sheets: `eventSheets/`. Scripts: `scripts/` (`scriptsType` is `module`).
- SIDs must be unique 15-digit integers across the project. Generate a new SID for every new object, family, layout, event sheet, instance, and animation.

## Gameplay convention

- Core loop in JS modules (`scripts/`), not a 500-event sheet.
- Layout `Game` is the playfield. Layout `ObjectBanks` is the object pool / template bank.
- Event sheet `E_Game` wires input and layout start into the scripts.
- One cell ≈ one `Block` sprite instance (currently ~128×128). Scale to fit an 8×8 board with HUD.

When adding or changing C3 files, follow skill `construct3-edit`. When changing rules, follow skill `block-blast-gameplay`.
