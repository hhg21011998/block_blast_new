# Phân tích Assets — Block Blast

Nguồn: dump Unity 6 (`6000.3.15f1`) tại `Assets/`.  
Sản phẩm gốc: **Block Blast / Woodoku Blast** (Tripledot Studios).  
Support email trong config: `woodoku-blast-support@tripledotstudios.com`.  
Ngày khảo sát: 2026-09-19.

Đây **không phải source code**. Folder `Assets/` chứa data, config, sprite, audio, mesh, prefab hierarchy đã extract. Luật chơi, hình khối, điểm số và feel lấy từ các file JSON/bytes bên dưới.

Dự án clone: Construct 3 tại `BlockBlastNew/` — portrait **1080×1920**, hiện chỉ có sprite `Block`.

---

## 1. Game này thực sự là gì

Không phải Tetris. Đây là **Woodoku / Block Blast**:

- Bàn **8×8**, không trọng lực, không xoay quân.
- Hàng chờ (**shape bank**) **3 khối** polyomino.
- Kéo thả lên lưới. Hết 3 quân thì refill bank.
- Xóa **cả hàng và cột đầy** (không rơi xuống).
- Thua khi **không quân nào còn lại** đặt được.
- Quân không đặt được bị grey-out nhưng **vẫn kéo được**.

### Feel kéo thả (từ `GameServerSettings`)

| Thông số | Giá trị |
|---|---|
| `dragOffset.y` | 125 (khối nổi trên ngón tay) |
| Scale quân trong bank | 0.5 |
| Hover scale source | 1.25 |
| Hover scale target | 0.25 |
| Delay spawn bank | 0.1s |
| Delay khi hết chỗ đặt | 0.5s |
| Hit-stop | 0.2s, timescale 0, từ 3 line trở lên |
| Camera shake | bật, cùng ngưỡng 3+ clears |
| Haptic | ~7ms |

---

## 2. Hai mode chính

### Classic — endless điểm

- Mục tiêu: sống lâu, combo, high score.
- `scorePerBlock = 1`
- Revive **tắt** trong config baked (`maxRevive = 0`).
- HUD: combo text, điểm popup, heart HUD cho goal Score.

### Journey — 75 level, 6 chapter

File: `Assets/Resources/offlinedata/offline-journey-levels.json`  
Version: `AJ1 New Structure Test New Levels 20250325 FIX | 6ch | 75lvl | 1.13.00+`  
Banner: `#5425B7` / highlight `#FC8DFF`.

- Goal kiểu **AND** (phải đạt hết target).
- Revive tối đa **3**, cần ≥ **50%** mục tiêu.
- Độ khó: Super Easy → Easy → Medium → Hard → Super Hard.
- Onboarding: sau tutorial vào Journey; hiện popup Journey sau 4 ván Classic.

### Mode khác

| Mode | Ghi chú |
|---|---|
| Tutorial / FTUE | Scene `16-FTUE`, video mechanic (butterfly, balloon, box, flower, fireworks, apple) |
| IQ Puzzle | Collection + gacha, **đang tắt** trong baked `IQPuzzle.bytes` |
| Daily | `mode.daily.active = false` |

---

## 3. Điểm số Classic — số thật từ config

Nguồn: `Assets/Resources/offlinedata/GameServerSettings.bytes`

| Sự kiện | Điểm |
|---|---|
| Mỗi ô đặt | 1 |
| Xóa 1 line | 10 |
| Xóa 2 line cùng lúc | 20 |
| Xóa 3 line | 60 |
| Xóa 4 line | 100 |
| Xóa 5 line | 150 |
| Xóa 6 line | 250 |
| Xóa sạch cả bàn | 300 |

Legacy (không dùng khi `useAlternateScoreMethod = true`): `scorePerLineClear = 25`.

### Streak / combo

- Streak bật sau **2 lần xóa liên tiếp**.
- Reset sau **3 nước không xóa**.
- Sau full-board clear: reset sau **7 nước không xóa**.
- Combo stinger audio: `BT_Sting_Clear0` … `Clear15`.
- VO: amazing, awesome, great job, lovely, perfect, boom, fantastic, genius, spectacular, impressive, nice work.

---

## 4. Catalog hình khối

File: `Assets/Resources/jsondata/shapedatabases/ShapeDatabase-All.json`

- **165** variant, **46** họ (`Shape_0` … `Shape_45`).
- `shapeData`: mảng row-major. `0` = lỗ, số khác = color id 1–6.
- `rows` × `cols`: bounding box.
- `modifier`: ~nghịch đảo kích thước (quân nhỏ “đắt” hơn khi sinh).
- `rarityTier`: 0–5.
- `onlyShowShapeAfterBrcValue`: khóa quân theo BRC (board-run counter).

### 4.1 Họ lõi — clone trước (rarity 0)

```
Shape_0    n=1   1x1   #                 1 ô     BRC 300 (revive mercy)
Shape_1    n=4   2x2   .# / ##           L 3 ô
Shape_2    n=2   2x1   ##                I2
Shape_3    n=2   3x1   ###               I3
Shape_4    n=2   4x1   ####              I4
Shape_5    n=2   5x1   #####             I5
Shape_6    n=1   3x3   3x3 đặc           9 ô
Shape_7    n=4   3x3   L 5 ô
Shape_8    n=4   2x3   T
Shape_9    n=4   2x3   S/Z
Shape_10   n=8   2x3   J/L 4 ô
Shape_11   n=2   3x3   chéo 3 ô          BRC 30
Shape_12   n=2   2x2   chéo 2 ô
Shape_13   n=1   2x2   2x2 đặc
Shape_14   n=2   2x3   2x3 / 3x2 đặc
```

ASCII (biến thể `_0` của mỗi họ):

```
Shape_0_0     Shape_1_0     Shape_2_0     Shape_3_0     Shape_4_0
#             . #           #             #             #
              # #           #             #             #
                                          #             #
                                                        #

Shape_5_0     Shape_6_0     Shape_7_0     Shape_8_0     Shape_9_0
#             # # #         . . #         . # .         # # .
#             # # #         . . #         # # #         . # #
#             # # #         # # #
#
#

Shape_10_0    Shape_11_0    Shape_12_0    Shape_13_0    Shape_14_0
. . #         . . #         . #           # #           # # #
# # #         . # .         # .           # #           # # #
              # . .
```

### 4.2 Họ đặc biệt / hiếm (làm sau)

| Họ | Size | Ô | Rarity | Hình dạng tiêu biểu |
|---|---|---|---|---|
| Shape_15 | 3×3 | 5 | 2 | dấu cộng |
| Shape_16 | 2×3 | 5 | 1 | U |
| Shape_17 | 3×3 | 5 | 1 | T lớn / U xoay |
| Shape_18–25 | 3×3 | 5–7 | 2–3 | góc, C, X |
| Shape_26 | 4×4 | 4 | 4 | chéo dài |
| Shape_27–32 | 3×3 / 4×2 | 5–8 | 2–4 | U, C, P |
| Shape_33–36 | 5×3 / 5×4 | 11–12 | 3 | chữ E, H, U lớn |
| Shape_37, 41, 43–45 | 5×5 | 9–13 | 5 | X, plus, kim cương, sao |
| Shape_42 | 4×4 | 16 | 5 | 4×4 đặc |

Revive (Journey IH): sinh ba `Shape_0_0` (1×1).

Mesh 3D tương ứng nằm ở `Assets/Mesh/Shape_*.glb` — dùng cho preview / shuffle cube, gameplay chính là 2D sprite.

---

## 5. Màu và tile

### 5.1 Bảy màu block

Blue, Green, Indigo, Orange, Red, Violet, Yellow.

Sprite gloss bo góc, ví dụ `Assets/Resources/blocks/Block_Blue.png`.  
Atlas: `Assets/SpriteAtlas/Blocks_Atlas.json`.

Sprite block khác: Gold, Special, 2X, BW, Placeholder, ClearPreview, Golden, Butterfly 1–4, TNT.

### 5.2 Packed sprites trong Blocks_Atlas

`T_Block_Blue / Green / Indigo / Orange / Red / Violet / Yellow`  
`T_Block_Gold / Golden / 2X / Special / Placeholder / ClearPreview / BW`  
`T_Block_Butterfly_01`–`04`  
`T_Gem_Circle / FourPoint / Heart / Hexagon / Square / Star / TearDrop / Triangle`  
`T_Grid_Tile / Inner / Outer`  
`T_Pearl_*`, `Balloon_Blue / Green / Orange / Red`

### 5.3 Mã ô Journey (64 ô, trái→phải, trên→dưới)

| Code | Ý nghĩa |
|---|---|
| `0` | trống |
| `aa`–`ag` | 7 màu block (có thể remap qua `colourConfig.setStartingGridToBankColor`) |
| `ba` | gem circle |
| `bb` | gem fourpoint |
| `bc` | gem heart |
| `bd` | gem hexagon |
| `be` | gem square |
| `bf` | gem star |
| `bg` | gem teardrop |
| `bh` | gem triangle |
| `ma` | táo đỏ |
| `mb` | táo xanh |
| `tn` | TNT |
| `ha` | đất / vine hoa |
| `\|ga` `\|ga2` `\|ga3` | box HP 1 / 2 / 3 lớp |
| `\|ia` `\|ib` | flower type 0 / 1 chồng lên block |

Ví dụ cell: `"aa|ga2"` = block màu `aa` + hộp 2 lớp.  
`"tn|ga2"` = TNT bọc hộp.  
`"ae|ga"` = block + hộp 1 lớp.

`colourConfig.colours` trên từng level (green, violet, indigo, blue, orange, red, yellow) remap màu bank / lưới khi `setStartingGridToBankColor = true`.

---

## 6. Journey goals và tiến trình mechanic

Tag trong `description` của level:

| Tag | Mechanic |
|---|---|
| `TS\|` | score |
| `GM\|` | gem |
| `BX\|` | box |
| `TN\|` | TNT |
| `AP\|` | apple |
| `FL\|` | flower |
| `BX-\|` `TN-\|` | overlay hiện nhưng không phải goal chính (`targetValue: -1`) |

Lobby pagination: 6 chapter, `levelCount` 5 / 10 / 15 / 15 / 15 / 15. Mỗi chapter có `awardImageName` + `journeyImageName`.

---

## 7. MechanicsConfig

File: `Assets/Resources/offlinedata/MechanicsConfig.bytes`  
Version: `mechanicConfig 1.04.00+`

| Config | Trạng thái | Ghi chú |
|---|---|---|
| `x2Config` | **tắt** | multiplier cell, max 3 trên bàn |
| `gemSpawningConfig` | bật | xác suất 1–6 gem: 27.5 / 25 / 20 / 12.5 / 7.5 / 7.5% |
| `butterflyConfig` | bật | variant `block`, max 10, curve giảm theo tiến độ |
| `boxMechanicConfig` | bật | 1 lớp 60%, 2 lớp 30%, max 20, box-on-apple |
| `flowerConfig` | bật | max 20, vine spawn radius 2 |
| `appleSpawningConfig` | bật | 1–3 táo theo curve |
| `appleCrateSpawningConfig` | bật | max 20, spawn radius 4 |
| `colourConfig` | bật | 4 màu, mỗi màu 25% |
| `reviveConfig` | bật | max 3, 50% goal, 3 bank đầu ignore terminator |

Curve dùng Unity AnimationCurve (`time` 0–1 = tiến độ level/ván).

FTUE video (tắt): butterfly, balloon, box, flower, fireworks, apple.

---

## 8. Invisible Hand — sinh quân

Không random đều. Đây là hệ thống độ khó cốt lõi.

| File | Dùng cho |
|---|---|
| `inv-hand-classic.bytes` | Classic — version “Super Easy (Better End Game)” |
| `inv-hand-journey.bytes` | Journey — “JOURNEY-JIH 2+ Clear Mechs WB” |
| `invisiblehandconfigs/*.bytes` | 4 biến thể hashed |

### Tham số chung

| Tham số | Classic | Journey |
|---|---|---|
| `maxBrc` | 100 | 100 |
| `brcValueOnClear` | +1 | +1 |
| `complexShapeMultiplier` | **3** | 0 |
| `terminatorMod` | 1 | 1 |
| `perfectFitModValue` | (có) | 100 |
| `minimumPerfectFitPercentage` | — | 0.67 |
| `minimumCellsFilledPercentage` | — | 0.26 |
| `rngStrategy` | — | 2 |
| `cherryPickRange` | — | 100 |

BRC (board-run counter) 0–100, tăng mỗi lần xóa line. Dùng làm trục X của các curve.

### Các trọng số chấm điểm quân

- **Terminator** — quân khó, tăng theo BRC (Classic: 0 → 0.15 @0.26 → 0.8 @0.36 → 1.5 @1.0).
- **Perfect fit** — thưởng khớp lỗ trên bàn.
- **Complementary fit** — quân điền phần còn lại.
- **Complex shape** — Classic nhân 3.
- **Mercy** — cứu khi sắp thua.
- **Can be placed / empty board / already in bank / seen before** — phạt trùng, thưởng đặt được.

Journey IH chỉ whitelist subset Shape_1–17 (không 1×1 thường, không họ hiếm). Revive: ba `Shape_0_0`.

Unity **Sentis** (shader NN) có trong `Assets/Resources/sentis/` — có thể hỗ trợ sinh quân phía client. **Không bắt buộc** cho bản clone đầu; bắt đầu bằng weighted random + perfect-fit.

Level Journey có `invisibleHandOverrideKey` (`JIH 1`, `JIH 4`, `JIH 7`, `JIH 10`, `JIH 11`…) để chọn profile IH theo level.

---

## 9. Powerup và live-ops

Nguồn: `LiveOpsBuiltInConfig.bytes`, prefab `Powerup_*`.

| Powerup | Prefab / SFX | Tác dụng suy ra |
|---|---|---|
| Anvil | `Powerup_Magnet_AnvilEffect`, `ColumnEffect` | đập hàng / cột |
| Tornado | `Powerup_Tornado_SpinningTop` | xoáy / xóa vùng |
| Shuffle | `Powerup_Shuffle_Cube` + RT | đổi 3 quân bank |
| Lightning | `Feedback_Powerup_Lightning_*` | xóa mạnh / burst |

Live-ops baked:

- **Golden Blocks** — max 5 golden shape / 30 golden block mỗi ván, cooldown 1–3 bank, degrade khi refresh bank. Mốc 5 / 10 / 15 → anvil / tornado / shuffle.
- **Leaderboards**
- **Season / Blast Pass**
- Shop, chest gacha (wood / bronze / silver / gold / diamond), no-ads, lives.

Prefab liên quan: `BlastBoost_Propeller`, `GoldenBlock_Nag`, `GachaChestLock_*`, `Leaderboards_PlayerEntry`.

---

## 10. IQ Puzzle (tham khảo, đang tắt)

- Star: lưới 9×9, 6 mảnh, `cells` index tuyến tính.
- Rhombus: lưới 9×5, 5 mảnh, aspect 0.5.
- Bank UI: 0–3 mảnh = 1 hàng cell 400; 4–6 = 2 hàng; 7–12 = 3 hàng cell 250; …
- Gacha rương theo lịch bronze/silver/gold/platinum sau N chest.

---

## 11. Audio / font / UI

### Mixer

`Master` → `Music` / `SoundEffects` / `ClearStingers` / `VO`

### Nhóm SFX quan trọng cho clone

| Nhóm | File tiêu biểu |
|---|---|
| Đặt quân | `sfx_TilePlacement_drop_v3a.wav`, `SFX_drop_block_bank_quiet.wav` |
| Nhặt quân | `SFX_UI_PickupShape.wav` |
| Clear combo | `BT_Sting_Clear0` … `Clear15` |
| Fail / revive | `BT_Sting_Failure`, `BT_Sting_Revive`, `sfx_loseScreen_v4` |
| BGM | `BCTV_BGM_Gameplay1v3.ogg`, `BCTVLobbyBGMv1a.ogg` |
| VO combo | `vo01_amazing` … `vo12_nice_work` |
| UI | `SFX_press_button_soft`, `SFX_Popup_In` |

~228 clip (118 wav + 110 ogg).

### Font

- UI: **Kanit** Bold/SemiBold, **Roboto** Regular/Medium/Bold/Italic
- Tiêu đề / combo: **Anton**, **Bangers**, **Oswald-Bold**
- Khác: LiberationSans, Electronic Highway Sign, fontawesome

### Scene Unity

```
0-SplashScreen
1-LoadingScreen
2-CollectAwards
3-Game                  ← gameplay chính (không extract thành glb scene)
5-Settings
8-ReviewUs
9-AssetsLoading
10-JourneyPopup
2-MainMenu-1
11-ConfirmationPopup
12-SpecialShapePopup
14-IQPuzzleCollectionScreen
15-IQ-Puzzle-Game
16-FTUE
```

Sorting layer: Default + UI. Layer riêng: `3D_RenderTexture` (shuffle cube).

---

## 12. Cấu trúc dump vs dự án clone

```
D:\Code\BlockBlastNew\
├── Assets\                 dump Unity (học luật + art)
│   ├── Resources\
│   │   ├── jsondata\shapedatabases\ShapeDatabase-All.json
│   │   ├── jsondata\puzzles\
│   │   ├── jsondata\liveops\
│   │   └── offlinedata\    GameServerSettings, MechanicsConfig,
│   │                       inv-hand-*, offline-journey-levels
│   ├── Sprite\ / SpriteAtlas\ / Texture2D\
│   ├── AudioClip\
│   ├── Mesh\Shape_*.glb
│   └── PrefabHierarchyObject\
└── BlockBlastNew\          Construct 3 (nơi implement)
    ├── project.c3proj      name: BLockBlast_New, 1080×1920
    ├── layouts\Game, ObjectBanks
    ├── eventSheets\E_Game
    └── objectTypes\Block   sprite ~128×128
```

Construct 3: `fullscreenMode = letterbox-scale`, `orientations = portrait`.

---

## 13. File nguồn nên giữ trong tầm tay

| File | Việc dùng |
|---|---|
| `Assets/Resources/jsondata/shapedatabases/ShapeDatabase-All.json` | catalog 165 quân |
| `Assets/Resources/offlinedata/GameServerSettings.bytes` | điểm, feel, mode, haptic |
| `Assets/Resources/offlinedata/MechanicsConfig.bytes` | gem/box/flower/apple/revive |
| `Assets/Resources/offlinedata/offline-journey-levels.json` | 75 level Journey |
| `Assets/Resources/offlinedata/inv-hand-classic.bytes` | sinh quân Classic |
| `Assets/Resources/offlinedata/inv-hand-journey.bytes` | sinh quân Journey |
| `Assets/SpriteAtlas/Blocks_Atlas.json` | danh sách sprite block/gem/grid |
| `Assets/Resources/blocks/Block_Blue.png` | mẫu art 1 viên |
| `BlockBlastNew/project.c3proj` | viewport + index C3 |

---

## 14. Thứ tự implement clone (khuyến nghị)

1. Lưới 8×8 + bank 3 quân + kéo/snap + xóa hàng **và** cột.
2. Import họ **Shape_0–14** (polyomino chuẩn).
3. Điểm Classic + combo stinger + hit-stop.
4. Grey-out quân không đặt được + lose khi hết nước.
5. Journey: load grid 64 ô + goal score/gem/box/TNT.
6. Overlay tile (box HP, gem, apple, flower).
7. Invisible Hand (weighted + perfect-fit) — **không** random đều từ đầu.
8. Powerup Shuffle / Anvil / Tornado.
9. Meta: lives, chest, golden blocks, pass.

---

## 15. Nguyên tắc clone

- Gameplay 2D sprite, không cần mesh 3D trừ VFX shuffle cube.
- Màu 7 sắc kẹo bóng, bo góc, atlas chung.
- Portrait 1080×1920, letterbox.
- Combo audio là một phần feel, không phải trang trí.
- Độ khó nằm ở **sinh quân**, không ở tốc độ rơi.
- Journey là lớp goal chồng lên cùng engine Classic, không phải engine khác.
