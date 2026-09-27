/**
 * Glyph metrics for the combo art, measured from the PNGs (alpha > 0) in
 * `images/combotext-default-000.png` and `images/numbercombo-default-00N.png`.
 *
 * - imageW / imageH: frame size in px (matches objectTypes/*.json frames).
 * - glyphW / glyphH: tight bounds of the non-transparent pixels.
 * - offX / offY: glyph-bounds centre minus image centre, in px (+x right, +y down).
 *   Frames use a centred origin, so glyph centre = instance position + offset * scale.
 *
 * The frames are the tight recrop (0–3 px border). Digit glyphW is measured at
 * alpha > 8 (ignores the faint anti-aliased fringe; approved) and digit offsets are
 * set to 0. ComboText is measured at alpha > 0. Re-measure and update this table
 * if the art is re-exported.
 */

export interface GlyphMetrics {
	imageW: number;
	imageH: number;
	glyphW: number;
	glyphH: number;
	offX: number;
	offY: number;
}

export const COMBO_TEXT_OBJECT = "ComboText";
export const COMBO_DIGIT_OBJECT = "NumberCombo";

/** ComboText, animation "Default", frame 0. */
export const COMBO_TEXT_GLYPH: GlyphMetrics = {
	imageW: 770, imageH: 241, glyphW: 768, glyphH: 239, offX: 0, offY: 0
};

/** NumberCombo, animation "Default"; index = animation frame = digit value. */
export const COMBO_DIGIT_GLYPHS: readonly GlyphMetrics[] = [
	{ imageW: 252, imageH: 258, glyphW: 236, glyphH: 248, offX: 0, offY: 0 },
	{ imageW: 160, imageH: 256, glyphW: 144, glyphH: 246, offX: 0, offY: 0 },
	{ imageW: 228, imageH: 257, glyphW: 212, glyphH: 246, offX: 0, offY: 0 },
	{ imageW: 225, imageH: 253, glyphW: 209, glyphH: 244, offX: 0, offY: 0 },
	{ imageW: 226, imageH: 251, glyphW: 210, glyphH: 239, offX: 0, offY: 0 },
	{ imageW: 222, imageH: 251, glyphW: 206, glyphH: 245, offX: 0, offY: 0 },
	{ imageW: 229, imageH: 257, glyphW: 213, glyphH: 247, offX: 0, offY: 0 },
	{ imageW: 225, imageH: 253, glyphW: 209, glyphH: 244, offX: 0, offY: 0 },
	{ imageW: 242, imageH: 257, glyphW: 226, glyphH: 247, offX: 0, offY: 0 },
	{ imageW: 227, imageH: 257, glyphW: 211, glyphH: 247, offX: 0, offY: 0 }
];

/** Layout at scale 1, in px: gap between COMBO art and the number, and between digits. */
export const COMBO_WORD_GAP = 40;
export const COMBO_DIGIT_GAP = 4;
/** On-screen height of the COMBO art at base scale, in board cells. */
export const COMBO_HEIGHT_CELLS = 1.2;
/** Minimum distance from the visible viewport edge, in layout px. */
export const COMBO_VIEW_MARGIN = 16;
