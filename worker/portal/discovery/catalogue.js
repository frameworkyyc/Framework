/**
 * Discovery assessments: the built-in content. Pure data (no DOM, no network, no database). An Admin can reword, hide, reorder, add to and attach pictures to this
 * content (repo/discovery.js stores only those differences); this file is what an assessment shows when nothing has been changed.
 *
 * A "kind" is one type of assessment. Only "brand" exists today; Website Discovery and Marketing Discovery are added later as further entries in KINDS, with their own
 * stages and questions, and use the same tables, links, routes, Admin screens and brief machinery.
 *
 * The brand assessment covers Framework's nine Branding sections, using the same keys as Branding itself (admin/assets/brand-sections.js):
 *   logo, typography, colours, tagline, imagery, layout, textures, iconography, style.
 * Each option carries `tags` (what it says about the brand). The first tag is the option's main one. The brief uses them to find preferences that pull against each other.
 */

/** Pairs of tags that pull against each other. A client liking both sides is worth a conversation, not a rejection. */
export const TENSIONS = Object.freeze([
  ["minimal", "ornate", "minimal vs ornate"],
  ["playful", "serious", "playful vs serious"],
  ["bold", "quiet", "bold vs quiet"],
  ["modern", "traditional", "modern vs traditional"],
  ["organic", "technical", "organic vs technical"],
  ["luxury", "approachable", "luxury vs approachable"],
  ["mystical", "technical", "mystical vs technical"],
  ["ethereal", "bold", "ethereal vs bold"],
]);

export const TAG_LABEL = Object.freeze({
  minimal: "Minimal", ornate: "Ornate", playful: "Playful", serious: "Serious", bold: "Bold", quiet: "Quiet", modern: "Modern", traditional: "Traditional",
  organic: "Organic", technical: "Technical", luxury: "Luxury", approachable: "Approachable", warm: "Warm", cool: "Cool",
  holistic: "Holistic", mystical: "Mystical", ethereal: "Ethereal", romantic: "Romantic", feminine: "Feminine", bohemian: "Bohemian",
});

const o = (key, label, tags = [], extra = {}) => Object.freeze({ key, label, tags: Object.freeze(tags), ...extra });

export const SECTIONS = Object.freeze({
  style: Object.freeze({ key: "style", number: "09", label: "Design Style" }),
  logo: Object.freeze({ key: "logo", number: "01", label: "Logo" }),
  typography: Object.freeze({ key: "typography", number: "02", label: "Typography" }),
  tagline: Object.freeze({ key: "tagline", number: "04", label: "Tagline" }),
  colours: Object.freeze({ key: "colours", number: "03", label: "Brand Colours" }),
  imagery: Object.freeze({ key: "imagery", number: "05", label: "Brand Imagery" }),
  textures: Object.freeze({ key: "textures", number: "07", label: "Textures" }),
  iconography: Object.freeze({ key: "iconography", number: "08", label: "Iconography" }),
  layout: Object.freeze({ key: "layout", number: "06", label: "Layout System" }),
});

/** The nine section keys in the order Branding lists them (01 to 09). */
export const SECTION_ORDER = Object.freeze(["logo", "typography", "colours", "tagline", "imagery", "layout", "textures", "iconography", "style"]);

const BRAND_STAGES = Object.freeze([
  Object.freeze({ n: 1, title: "Personality & style", blurb: "How should your brand feel? Pick the words and styles that sound like you.", sections: ["style"] }),
  Object.freeze({ n: 2, title: "Logo", blurb: "Logos come in many forms. Choose the ones you would be proud to see on your signage, packaging, products or website.", sections: ["logo"] }),
  Object.freeze({ n: 3, title: "Typography & tagline", blurb: "The shape of your letters and the way you speak both carry your personality.", sections: ["typography", "tagline"] }),
  Object.freeze({ n: 4, title: "Brand colours", blurb: "Colour sets the mood before anyone reads a word.", sections: ["colours"] }),
  Object.freeze({ n: 5, title: "Imagery, textures & icons", blurb: "The pictures, surfaces and little symbols that finish the look.", sections: ["imagery", "textures", "iconography"] }),
  Object.freeze({ n: 6, title: "Layout & final review", blurb: "How your pages and printed pieces are put together. Then check your choices and send them to us.", sections: ["layout"], review: true }),
]);

const BRAND_QUESTIONS = Object.freeze([
  Object.freeze({
    key: "style.personality", section: "style", multi: true, visual: "word",
    prompt: "Which words feel like your business?", help: "Choose as many as you like.",
    options: Object.freeze([
      o("modern", "Modern", ["modern"]), o("minimal", "Minimal", ["minimal", "quiet"]), o("luxurious", "Luxurious", ["luxury", "ornate"]), o("traditional", "Traditional", ["traditional"]),
      o("bold", "Bold", ["bold"]), o("playful", "Playful", ["playful", "approachable"]), o("industrial", "Industrial", ["technical", "bold"]), o("organic", "Organic", ["organic", "approachable"]),
      o("friendly", "Friendly", ["approachable", "warm"]), o("authoritative", "Authoritative", ["serious"]), o("refined", "Refined", ["quiet", "luxury"]), o("rugged", "Rugged", ["bold", "technical"]),
      o("warm", "Warm", ["warm", "approachable"]), o("technical", "Technical", ["technical", "serious", "cool"]), o("elegant", "Elegant", ["luxury", "quiet"]), o("energetic", "Energetic", ["bold", "playful"]),
      o("calm", "Calm", ["quiet", "approachable"]), o("holistic", "Holistic", ["holistic", "organic", "approachable"]), o("mystical", "Mystical", ["mystical", "ornate"]), o("ethereal", "Ethereal", ["ethereal", "quiet"]),
      o("romantic", "Romantic", ["romantic", "warm"]), o("feminine", "Feminine", ["feminine", "approachable"]), o("bohemian", "Bohemian", ["bohemian", "organic", "warm"]), o("ornamental", "Ornamental", ["ornate", "luxury"]),
    ]),
  }),
  Object.freeze({
    key: "style.direction", section: "style", multi: true, visual: "style",
    prompt: "Which design directions appeal to you?", help: "Each picture is a rough sketch of a look, not a finished design.",
    options: Object.freeze([
      o("modern", "Modern", ["modern"], { note: "Clean shapes, confident type" }), o("minimalist", "Minimalist", ["minimal", "quiet"], { note: "Space, restraint, very little decoration" }),
      o("luxury", "Luxury", ["luxury", "ornate"], { note: "Dark, rich, finely detailed" }), o("traditional", "Traditional", ["traditional", "serious"], { note: "Classic, centred, trustworthy" }),
      o("bold", "Bold", ["bold"], { note: "Big type, strong blocks" }), o("playful", "Playful", ["playful", "approachable"], { note: "Rounded, bright, friendly" }),
      o("industrial", "Industrial", ["technical", "bold"], { note: "Grids, stripes, raw materials" }), o("organic", "Organic", ["organic", "approachable"], { note: "Soft curves, natural shapes" }),
      o("retro", "Retro", ["traditional", "playful"], { note: "Warm, nostalgic, sunburst energy" }), o("editorial", "Editorial", ["modern", "quiet"], { note: "Magazine columns, big headlines" }),
      o("holistic", "Holistic", ["holistic", "organic", "approachable"], { note: "Gentle, grounded, balanced" }), o("mystical", "Mystical", ["mystical", "ornate"], { note: "Moon, stars, a sense of ritual" }),
      o("ethereal", "Ethereal", ["ethereal", "quiet"], { note: "Soft, airy, luminous" }), o("romantic", "Romantic", ["romantic", "ornate", "warm"], { note: "Petals, curves, tenderness" }),
      o("feminine", "Feminine", ["feminine", "approachable"], { note: "Graceful, soft, elegant" }), o("bohemian", "Bohemian", ["bohemian", "organic", "warm"], { note: "Free-spirited, layered, handmade" }),
      o("ornamental", "Ornamental", ["ornate", "luxury"], { note: "Frames, flourishes, fine detail" }),
    ]),
  }),
  Object.freeze({
    key: "logo.type", section: "logo", multi: true, visual: "logo",
    prompt: "Which kinds of logo do you like?", help: "“Your Brand” stands in for your name. Look at the form, not the details.",
    options: Object.freeze([
      o("wordmark", "Wordmark", ["minimal", "modern"], { note: "Your name, set in type" }), o("lettermark", "Monogram", ["minimal", "modern"], { note: "Initials in a compact mark" }),
      o("emblem", "Emblem / badge", ["traditional", "ornate"], { note: "Name inside a seal or badge" }), o("crest", "Heritage crest", ["traditional", "ornate", "luxury"], { note: "Shield, ribbon, a sense of history" }),
      o("pictorial", "Illustrated mark", ["approachable", "organic"], { note: "A picture that stands for the business" }), o("abstract", "Abstract mark", ["modern", "technical"], { note: "Geometric shapes with no literal meaning" }),
      o("combination", "Symbol + wordmark", ["modern"], { note: "A symbol next to the name" }), o("mascot", "Mascot", ["playful", "approachable"], { note: "A character people remember" }),
      o("script", "Signature / script", ["luxury", "warm", "ornate"], { note: "Handwritten, personal" }),
      o("celestial", "Celestial", ["mystical", "ornate"], { note: "Moon, stars and sky" }), o("botanical", "Botanical", ["organic", "romantic"], { note: "Leaves, flowers and sprigs" }),
      o("ornamental", "Ornamental illustration", ["ornate", "luxury"], { note: "Decorative frames and flourishes" }), o("spiritual", "Spiritual motif", ["holistic", "quiet"], { note: "Lotus, sacred geometry, symbols with meaning" }),
      o("expressive", "Expressive emblem", ["mystical", "ornate", "warm"], { note: "A richly illustrated seal or badge" }),
    ]),
  }),
  Object.freeze({
    key: "typography.fonts", section: "typography", multi: true, visual: "font",
    prompt: "Which lettering feels right?", help: "Samples use fonts available on your device, so they may look slightly different on another.",
    options: Object.freeze([
      o("serif-classic", "Classic serif", ["traditional", "serious"], { note: "Timeless, trustworthy" }), o("serif-modern", "Modern serif", ["luxury", "quiet"], { note: "Editorial, refined" }),
      o("sans-geometric", "Geometric sans", ["modern", "minimal"], { note: "Clean, confident" }), o("sans-humanist", "Friendly sans", ["approachable", "warm"], { note: "Open, easy to read" }),
      o("slab", "Slab serif", ["bold", "traditional"], { note: "Sturdy, practical" }), o("script", "Script", ["luxury", "ornate", "warm"], { note: "Personal, flowing" }),
      o("display", "Display", ["bold", "playful"], { note: "Big personality, headlines only" }), o("mono", "Monospace", ["technical"], { note: "Technical, precise" }),
      o("condensed", "Condensed", ["bold", "technical"], { note: "Tall, tough, compact" }),
      o("elegant-italic", "Elegant italic", ["romantic", "luxury", "ornate"], { note: "Graceful, flowing, refined" }), o("calligraphic", "Calligraphy", ["ornate", "luxury", "romantic"], { note: "Formal, handwritten, ceremonial" }),
      o("handwritten", "Handwritten", ["warm", "approachable", "organic"], { note: "Casual, personal, artisan" }), o("deco", "Art deco", ["luxury", "ornate", "modern"], { note: "Glamorous, geometric, decorative" }),
      o("old-style", "Refined old-style", ["traditional", "romantic"], { note: "Classic, literary, warm" }),
    ]),
  }),
  Object.freeze({
    key: "tagline.tone", section: "tagline", multi: true, visual: "word",
    prompt: "How should your business sound?", help: "Think of how you would like customers to describe the way you talk.",
    options: Object.freeze([
      o("friendly", "Friendly", ["approachable", "warm"]), o("professional", "Professional", ["serious"]), o("witty", "Witty", ["playful"]), o("inspiring", "Inspiring", ["warm"]),
      o("direct", "Direct", ["bold", "quiet"]), o("warm", "Warm", ["warm", "approachable"]), o("confident", "Confident", ["bold"]), o("understated", "Understated", ["quiet", "minimal"]),
      o("technical", "Technical", ["technical", "serious"]), o("premium", "Premium", ["luxury"]),
      o("nurturing", "Nurturing", ["warm", "approachable"]), o("calm", "Calm", ["quiet", "approachable"]), o("poetic", "Poetic", ["romantic", "quiet"]), o("empowering", "Empowering", ["bold", "warm"]),
    ]),
  }),
  Object.freeze({
    key: "tagline.style", section: "tagline", multi: true, visual: "tagline",
    prompt: "Which kinds of tagline do you like?", help: "These are made-up examples to show the style. We write yours.",
    options: Object.freeze([
      o("descriptive", "Says what you do", ["serious"], { sample: "Handcrafted goods for everyday living." }), o("promise", "A promise", ["serious", "bold"], { sample: "Done properly, every time." }),
      o("punchy", "Short and punchy", ["bold", "minimal"], { sample: "Made to last." }), o("playful", "A little playful", ["playful", "approachable"], { sample: "Little things, big joy." }),
      o("question", "A question", ["approachable"], { sample: "Ready for something new?" }), o("heritage", "Heritage", ["traditional"], { sample: "Crafted with care since 1987." }),
      o("aspirational", "Aspirational", ["luxury", "warm"], { sample: "Where great things take shape." }), o("none", "No tagline", ["minimal", "quiet"], { sample: "Let the name speak for itself." }),
      o("healing", "Healing", ["holistic", "warm"], { sample: "Find your way back to calm." }), o("balance", "Balance", ["holistic", "quiet"], { sample: "Balance, restored." }),
      o("connection", "Connection", ["warm", "approachable"], { sample: "Come as you are. Belong." }), o("transformation", "Transformation", ["mystical", "warm"], { sample: "Become who you are meant to be." }),
      o("growth", "Personal growth", ["warm", "approachable"], { sample: "Grow at your own pace." }), o("inspiring", "Inspirational", ["warm", "romantic"], { sample: "Begin where you are." }),
    ]),
  }),
  Object.freeze({
    key: "colours.palettes", section: "colours", multi: true, visual: "palette",
    prompt: "Which colour palettes appeal to you?", help: "Each palette is a starting mood. We will tune the exact colours with you.",
    options: Object.freeze([
      o("neutral", "Warm neutrals", ["quiet", "warm"], { colours: ["#F5F1EB", "#D9D2C5", "#A39A8C", "#4A453E", "#1F1D1A"] }),
      o("earthy", "Earthy", ["organic", "warm"], { colours: ["#8B5E3C", "#C08A5A", "#D9B98C", "#5B6B4A", "#2F3B2A"] }),
      o("vibrant", "Vibrant", ["bold", "playful"], { colours: ["#FF3D5A", "#FF9F1C", "#FFD60A", "#2EC4B6", "#3A0CA3"] }),
      o("pastel", "Soft pastels", ["approachable", "quiet"], { colours: ["#FADADD", "#FFE5B4", "#E2F0CB", "#C7E9F1", "#E0D4F7"] }),
      o("monochrome", "Monochrome", ["minimal", "quiet"], { colours: ["#FFFFFF", "#D4D4D4", "#8A8A8A", "#3A3A3A", "#0A0A0A"] }),
      o("luxury", "Black and gold", ["luxury", "ornate"], { colours: ["#0B0B0B", "#2A2623", "#8C7A55", "#C9B27C", "#F4EFE6"] }),
      o("coastal", "Coastal blues", ["cool", "approachable"], { colours: ["#0B3C5D", "#328CC1", "#8FCBE8", "#EAF4F7", "#D9B26F"] }),
      o("sunset", "Sunset", ["warm", "bold"], { colours: ["#3D1E2B", "#A63A50", "#E8744F", "#F2A65A", "#FBE3C4"] }),
      o("forest", "Forest", ["organic", "quiet"], { colours: ["#1E3D2F", "#3C6E57", "#7FA88C", "#D8E4D0", "#A4784E"] }),
      o("primary", "Bold primaries", ["bold", "playful"], { colours: ["#D00000", "#0047AB", "#FFC300", "#111111", "#F7F7F7"] }),
      o("velvet-ritual", "Velvet & Ritual", ["luxury", "ornate", "warm"], { colours: ["#291329", "#5C253F", "#913E54", "#C49A65", "#E9D6C7"] }),
      o("moonlit-amethyst", "Moonlit Amethyst", ["mystical", "quiet", "cool"], { colours: ["#211B3D", "#493267", "#765A9D", "#B8A4D2", "#F2E9DD"] }),
    ]),
  }),
  Object.freeze({
    key: "imagery.style", section: "imagery", multi: true, visual: "imagery",
    prompt: "Which picture styles fit your brand?", help: "These are mood sketches. Framework can attach real photographs here.",
    options: Object.freeze([
      o("lifestyle", "Candid people", ["warm", "approachable"], { note: "Real people, real moments" }), o("studio", "Clean studio", ["minimal", "modern"], { note: "Products on plain backgrounds" }),
      o("documentary", "Black & white documentary", ["serious", "traditional"], { note: "Honest, grainy, timeless" }), o("aerial", "Aerial & landscape", ["organic", "bold"], { note: "Big views, the lay of the land" }),
      o("detail", "Close-up detail", ["quiet", "luxury"], { note: "Craft and texture up close" }), o("flat", "Flat illustration", ["playful", "modern"], { note: "Simple shapes and colour" }),
      o("hand", "Hand-drawn", ["organic", "warm"], { note: "Sketchy, personal" }), o("abstract3d", "Abstract / 3D", ["modern", "technical"], { note: "Soft shapes and gradients" }),
      o("architectural", "Architectural", ["serious", "technical"], { note: "Lines, structure, perspective" }),
      o("softfocus", "Soft & dreamy", ["ethereal", "romantic"], { note: "Glow, haze, gentle light" }), o("flatlay", "Styled flat lay", ["modern", "feminine"], { note: "Objects arranged from above" }),
      o("botanical", "Botanical & natural", ["organic", "holistic"], { note: "Leaves, flowers, natural light" }),
    ]),
  }),
  Object.freeze({
    key: "textures.surface", section: "textures", multi: true, visual: "texture",
    prompt: "Which surfaces and patterns would suit you?", help: "Textures add depth to backgrounds, packaging and print.",
    options: Object.freeze([
      o("paper", "Paper grain", ["warm", "traditional"]), o("concrete", "Concrete", ["technical", "bold"]), o("linen", "Linen weave", ["warm", "quiet"]), o("marble", "Marble", ["luxury", "ornate"]),
      o("wood", "Wood grain", ["organic", "warm"]), o("lines", "Fine lines", ["modern", "minimal"]), o("halftone", "Halftone dots", ["playful", "bold"]), o("topographic", "Topographic", ["organic", "technical"]),
      o("terrazzo", "Terrazzo", ["playful", "modern"]), o("clean", "None, keep it clean", ["minimal", "quiet"]),
      o("watercolour", "Watercolour wash", ["ethereal", "romantic"]), o("floral", "Floral pattern", ["romantic", "feminine"]), o("gilded", "Gilded foil", ["luxury", "ornate"]), o("starfield", "Starfield", ["mystical", "quiet"]),
    ]),
  }),
  Object.freeze({
    key: "iconography.icons", section: "iconography", multi: true, visual: "icons",
    prompt: "Which icon style do you prefer?", help: "The same four symbols in different styles.",
    options: Object.freeze([
      o("line", "Thin line", ["minimal", "modern"]), o("solid", "Solid", ["bold", "modern"]), o("duotone", "Two-tone", ["playful", "modern"]), o("rounded", "Soft & rounded", ["approachable", "playful"]),
      o("sharp", "Sharp & technical", ["technical", "serious"]), o("hand", "Hand-drawn", ["organic", "warm"]), o("badge", "In a badge", ["traditional", "bold"]),
    ]),
  }),
  Object.freeze({
    key: "layout.system", section: "layout", multi: true, visual: "layout",
    prompt: "Which page layouts feel right?", help: "Grey blocks stand for pictures and text. Choose the arrangement, not the content.",
    options: Object.freeze([
      o("airy", "Airy & minimal", ["minimal", "quiet"], { note: "Lots of white space" }), o("modular", "Modular grid", ["modern", "technical"], { note: "Tidy, even blocks" }),
      o("editorial", "Editorial", ["modern", "luxury"], { note: "Asymmetric, magazine-like" }), o("centred", "Centred & classic", ["traditional", "serious"], { note: "Symmetrical, calm" }),
      o("fullbleed", "Full-bleed imagery", ["bold", "warm"], { note: "Pictures edge to edge" }), o("dense", "Information-rich", ["technical", "serious"], { note: "Lots of detail at a glance" }),
      o("cards", "Card-based", ["approachable", "modern"], { note: "Content in friendly tiles" }), o("split", "Split screen", ["bold", "modern"], { note: "Two halves, picture and message" }),
    ]),
  }),
]);

export const KINDS = Object.freeze({
  brand: Object.freeze({
    kind: "brand",
    label: "Brand Discovery",
    intro: "A short, visual way to show us what you like. There are six steps and no wrong answers. It takes about 10 to 15 minutes, and you can stop and come back at any time.",
    stages: BRAND_STAGES,
    questions: BRAND_QUESTIONS,
    sectionOrder: SECTION_ORDER,
  }),
});

export const KIND_KEYS = Object.freeze(Object.keys(KINDS));
export const kindDef = (kind) => (typeof kind === "string" && Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : null);

export const MODES = Object.freeze(["picks", "not_sure", "surprise"]);
export const MODE_LABEL = Object.freeze({ picks: "My picks", not_sure: "I’m not sure", surprise: "Surprise me" });
