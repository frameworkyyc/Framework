/**
 * Which picture stands for an option, as plain data (no markup): used by the client pages (pages.js) and by the Admin review (brief.js), so both show the same thing.
 * Order of preference: a picture Admin attached, a bundled photo, a colour palette, a font sample, then a generated sketch (see visuals.js).
 */
import { visualFor } from "./visuals.js";

export const DIRECTION_IMAGES = new Set(["modern", "minimalist", "luxury", "traditional", "bold", "playful", "industrial", "organic", "retro", "editorial", "holistic", "mystical", "romantic", "bohemian", "feminine", "rustic", "futuristic", "gothic", "architectural", "dark"]);
export const TEXTURE_IMAGES = new Set(["paper", "concrete", "linen", "marble", "wood", "lines", "halftone", "topographic", "terrazzo", "watercolour", "floral", "gilded", "mosaic", "steel", "rust", "blank"]);
export const IMAGERY_IMAGES = new Set(["abstract3d", "botanical", "lifestyle", "detail", "hand", "aerial", "architectural", "documentary", "flat", "studio", "flatlay", "softfocus", "earthy", "woody", "holistic", "ethereal"]);
export const LOGO_IMAGES = new Set(["wordmark", "lettermark", "emblem", "crest", "pictorial", "abstract", "combination", "mascot", "script", "celestial", "botanical", "ornamental"]);

export const FONT_KEYS = new Set(["serif-classic", "serif-modern", "sans-geometric", "sans-humanist", "slab", "script", "display", "mono", "condensed", "elegant-italic", "calligraphic", "handwritten", "deco", "old-style"]);

/** @returns {{type:"photo",src:string}|{type:"colours",colours:string[]}|{type:"font",font:string}|{type:"sketch",svg:string}|{type:"word"}} */
export function thumbFor(q, o, imageUrl = (id) => `/api/admin/discovery/media/${id}`) {
  if (o.imageId) return { type: "photo", src: imageUrl(o.imageId) };
  if (q.key === "logo.type" && LOGO_IMAGES.has(o.key)) return { type: "photo", src: `/assets/img/discovery-logos/${o.key}.png` };
  if (q.key === "style.direction" && DIRECTION_IMAGES.has(o.key)) return { type: "photo", src: `/assets/img/discovery-directions/${o.key}.jpg` };
  if (q.key === "textures.surface" && TEXTURE_IMAGES.has(o.key)) return { type: "photo", src: `/assets/img/discovery-textures/${o.key}.jpg` };
  if (q.key === "imagery.style" && IMAGERY_IMAGES.has(o.key)) return { type: "photo", src: `/assets/img/discovery-imagery/${o.key}.jpg` };
  if (q.visual === "palette") return { type: "colours", colours: (o.colours || []).filter((c) => /^#[0-9A-Fa-f]{6}$/.test(c)) };
  if (q.visual === "font" && FONT_KEYS.has(o.key)) return { type: "font", font: o.key };
  const svg = visualFor(q.visual, o, q.key);
  return svg ? { type: "sketch", svg } : { type: "word" };
}
