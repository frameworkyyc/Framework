/* Generates the concept illustrations the client portal shows for services (assets/img/portal/*.svg). They are drawings of what a service LOOKS like, in Framework's
   black-and-white identity with placeholder wording ("Your Name"); they are never client work. Run: node scripts/portal-art.mjs */
import { writeFileSync, mkdirSync } from "node:fs";
const INK = "#0A0A0A", SLATE = "#5C5C5C", STONE = "#A3A3A3", LINE = "#E0E0E0", MIST = "#F5F5F5", PAPER = "#FFFFFF", SIGNAL = "#B3261E";
const f = (n) => Math.round(n * 10) / 10;
const rect = (x, y, w, h, { fill = PAPER, stroke = INK, sw = 2 } = {}) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ""}/>`;
const line = (x1, y1, x2, y2, { stroke = INK, sw = 2, dash = "" } = {}) => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
const text = (s, x, y, { size = 14, weight = 600, fill = INK, anchor = "start", ls = 0 } = {}) => `<text x="${f(x)}" y="${f(y)}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${ls ? ` letter-spacing="${ls}"` : ""}>${s}</text>`;
const bars = (x, y, w, n, { fill = LINE, h = 6, gap = 14 } = {}) => Array.from({ length: n }, (_, i) => rect(x, y + i * gap, i === n - 1 ? w * 0.6 : w, h, { fill, stroke: null })).join("");
const mark = (x, y, s = 28) => `<g>${rect(x, y, s, s, { fill: INK, stroke: null })}<path d="M${f(x + s * 0.25)} ${f(y + s * 0.3)}H${f(x + s * 0.75)}V${f(y + s * 0.45)}H${f(x + s * 0.4)}V${f(y + s * 0.8)}H${f(x + s * 0.25)}Z" fill="${PAPER}"/></g>`;
const cross = (x, y, w, h) => `${rect(x, y, w, h, { fill: MIST, stroke: STONE, sw: 1.5 })}${line(x, y, x + w, y + h, { stroke: STONE, sw: 1.5 })}${line(x + w, y, x, y + h, { stroke: STONE, sw: 1.5 })}`;
const win = (x, y, w, h, title = "") => `${rect(x, y, w, h)}${line(x, y + 26, x + w, y + 26)}${rect(x + 10, y + 9, 8, 8, { stroke: INK, fill: PAPER, sw: 1.5 })}${rect(x + 24, y + 9, 8, 8, { stroke: INK, fill: PAPER, sw: 1.5 })}${title ? text(title, x + w / 2, y + 18, { size: 10, weight: 500, fill: SLATE, anchor: "middle" }) : ""}`;
const frame = (inner, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" role="img" aria-label="${label}"><rect width="640" height="400" fill="${MIST}"/>${inner}</svg>\n`;

const art = {
  "business-card": frame(`
    ${rect(150, 120, 300, 180, { fill: INK })}${mark(176, 146, 34)}${text("YOUR BUSINESS", 176, 184, { size: 12, fill: PAPER, ls: 3 })}
    ${rect(230, 190, 300, 180)}${text("Your Name", 254, 236, { size: 22 })}${text("Title, Company", 254, 258, { size: 13, weight: 500, fill: SLATE })}${line(254, 278, 330, 278, { sw: 3 })}${bars(254, 296, 180, 3, { fill: STONE, h: 4, gap: 14 })}`, "Concept illustration of a business card, front and back"),
  "digital-card": frame(`
    ${rect(220, 30, 200, 340, { fill: PAPER, sw: 3 })}${line(300, 44, 340, 44, { sw: 4 })}
    ${rect(290, 70, 60, 60, { fill: INK, stroke: null })}${text("Your Name", 320, 160, { size: 18, anchor: "middle" })}${text("Title, Company", 320, 180, { size: 11, weight: 500, fill: SLATE, anchor: "middle" })}
    ${["Call", "Email", "Website"].map((t, i) => `${rect(240, 200 + i * 38, 160, 30)}${text(t, 320, 220 + i * 38, { size: 12, anchor: "middle" })}`).join("")}
    ${rect(280, 318, 40, 40, { fill: PAPER, sw: 1.5 })}${rect(286, 324, 10, 10, { fill: INK, stroke: null })}${rect(304, 324, 10, 10, { fill: INK, stroke: null })}${rect(286, 342, 10, 10, { fill: INK, stroke: null })}${text("Save to contacts", 340, 342, { size: 10, weight: 500, fill: SLATE })}`, "Concept illustration of a digital business card on a phone"),
  poster: frame(`
    ${rect(110, 40, 200, 300, { fill: INK })}${text("GRAND", 126, 100, { size: 34, fill: PAPER })}${text("OPENING", 126, 136, { size: 34, fill: PAPER })}${cross(126, 156, 168, 100)}${text("SATURDAY · 10 AM", 126, 290, { size: 12, fill: PAPER, ls: 2 })}${text("Your address here", 126, 310, { size: 11, weight: 500, fill: STONE })}
    ${rect(340, 90, 190, 260)}${cross(354, 104, 162, 120)}${text("Event Title", 354, 258, { size: 20 })}${bars(354, 274, 160, 3, { fill: STONE, h: 4, gap: 14 })}${rect(354, 320, 70, 16, { fill: INK, stroke: null })}`, "Concept illustration of two posters"),
  "flyer-brochure": frame(`
    ${rect(60, 50, 170, 250)}${rect(60, 50, 170, 70, { fill: INK })}${text("YOUR OFFER", 76, 92, { size: 16, fill: PAPER, ls: 2 })}${bars(76, 140, 138, 5, { fill: STONE, h: 5, gap: 16 })}${rect(76, 262, 90, 22, { fill: INK, stroke: null })}
    ${rect(270, 80, 100, 230)}${rect(370, 80, 100, 230)}${rect(470, 80, 100, 230)}
    ${mark(292, 104, 30)}${bars(284, 160, 76, 5, { fill: STONE, h: 4, gap: 14 })}${cross(382, 98, 76, 70)}${bars(384, 190, 72, 4, { fill: STONE, h: 4, gap: 14 })}${rect(482, 98, 76, 214, { fill: INK, stroke: null })}${text("Contact", 496, 130, { size: 13, fill: PAPER })}${bars(496, 146, 48, 3, { fill: STONE, h: 3, gap: 12 })}`, "Concept illustration of a flyer and a tri-fold brochure"),
  social: frame(`
    ${rect(60, 70, 170, 170, { fill: INK })}${text("NEW", 84, 140, { size: 30, fill: PAPER })}${text("THIS WEEK", 84, 170, { size: 14, fill: PAPER, ls: 3 })}
    ${rect(260, 40, 136, 170)}${cross(272, 52, 112, 90)}${bars(272, 154, 112, 3, { fill: STONE, h: 4, gap: 12 })}
    ${rect(440, 40, 110, 240)}${cross(450, 50, 90, 130)}${text("Story", 495, 214, { size: 14, anchor: "middle" })}${rect(462, 236, 66, 16, { fill: INK, stroke: null })}
    ${text("1:1", 145, 264, { size: 11, weight: 500, fill: SLATE, anchor: "middle" })}${text("4:5", 328, 232, { size: 11, weight: 500, fill: SLATE, anchor: "middle" })}${text("9:16", 495, 304, { size: 11, weight: 500, fill: SLATE, anchor: "middle" })}`, "Concept illustration of social media graphics in three formats"),
  letterhead: frame(`
    ${rect(150, 24, 250, 352)}${mark(172, 46, 30)}${text("YOUR BUSINESS", 212, 66, { size: 11, ls: 2.5 })}${line(172, 92, 378, 92, { sw: 1.5, stroke: STONE })}${bars(172, 120, 206, 3, { fill: LINE, h: 5, gap: 16 })}${bars(172, 190, 206, 5, { fill: LINE, h: 5, gap: 16 })}${line(172, 336, 378, 336, { sw: 1.5, stroke: STONE })}${text("address · phone · web", 275, 356, { size: 9, weight: 500, fill: SLATE, anchor: "middle" })}
    ${rect(430, 150, 170, 100)}${line(430, 150, 515, 210)}${line(600, 150, 515, 210)}${mark(446, 214, 22)}`, "Concept illustration of a letterhead and envelope"),
  "email-signature": frame(`
    ${win(80, 40, 480, 320, "New message")}${bars(104, 84, 300, 2, { fill: LINE, h: 6, gap: 18 })}${bars(104, 130, 420, 3, { fill: LINE, h: 6, gap: 16 })}
    ${line(104, 220, 540, 220, { sw: 1.5, stroke: STONE })}${mark(104, 238, 56)}${text("Your Name", 180, 260, { size: 17 })}${text("Title, Company", 180, 280, { size: 12, weight: 500, fill: SLATE })}${text("phone · email · website", 180, 304, { size: 11, weight: 500, fill: SLATE })}${rect(180, 318, 70, 4, { fill: INK, stroke: null })}`, "Concept illustration of an email signature"),
  "custom-branded": frame(`
    ${rect(70, 160, 150, 150)}${line(70, 200, 220, 200)}${mark(120, 226, 50)}
    ${rect(250, 110, 130, 200, { fill: INK })}${text("YOUR", 315, 200, { size: 20, fill: PAPER, anchor: "middle" })}${text("BRAND", 315, 226, { size: 20, fill: PAPER, anchor: "middle" })}
    <circle cx="470" cy="150" r="56" fill="${PAPER}" stroke="${INK}" stroke-width="2"/>${mark(448, 128, 44)}
    ${rect(420, 240, 140, 70)}${bars(436, 256, 100, 3, { fill: STONE, h: 4, gap: 14 })}`, "Concept illustration of custom branded materials: packaging, a bottle, a sticker and a tag"),
  app: frame(`
    ${win(60, 40, 520, 320, "Your application")}${rect(60, 66, 120, 294, { fill: INK })}${["Overview", "Customers", "Jobs", "Reports"].map((t, i) => text(t, 80, 98 + i * 30, { size: 12, fill: i === 1 ? PAPER : STONE, weight: i === 1 ? 700 : 500 })).join("")}
    ${text("Customers", 204, 100, { size: 18 })}${rect(204, 114, 130, 28, { fill: INK, stroke: null })}${text("Add customer", 269, 133, { size: 11, fill: PAPER, anchor: "middle" })}
    ${[0, 1, 2, 3].map((i) => `${line(204, 168 + i * 38, 558, 168 + i * 38, { sw: 1, stroke: LINE })}${rect(204, 178 + i * 38, 90, 8, { fill: STONE, stroke: null })}${rect(330, 178 + i * 38, 120, 8, { fill: LINE, stroke: null })}${rect(490, 176 + i * 38, 50, 12, { fill: PAPER, stroke: INK, sw: 1.5 })}`).join("")}`, "Concept illustration of a custom web application"),
  dashboard: frame(`
    ${win(50, 30, 540, 340, "Business dashboard")}
    ${["Revenue", "Jobs", "Leads"].map((t, i) => `${rect(70 + i * 172, 62, 156, 64)}${text(t, 84 + i * 172, 84, { size: 11, weight: 500, fill: SLATE })}${text(["$ — — —", "— —", "— —"][i], 84 + i * 172, 112, { size: 22 })}`).join("")}
    ${rect(70, 142, 330, 206)}${[0, 1, 2, 3, 4, 5, 6].map((i) => rect(92 + i * 42, 320 - [60, 90, 70, 120, 100, 140, 130][i], 26, [60, 90, 70, 120, 100, 140, 130][i], { fill: i === 6 ? INK : LINE, stroke: null })).join("")}
    ${rect(414, 142, 156, 206)}<polyline points="430,300 460,270 490,282 520,230 552,200" fill="none" stroke="${INK}" stroke-width="3"/>${line(430, 320, 552, 320, { sw: 1, stroke: LINE })}`, "Concept illustration of a business dashboard with figures and charts"),
  portal: frame(`
    ${win(50, 30, 540, 340, "Client portal")}${rect(50, 56, 540, 40, { fill: INK })}${mark(66, 64, 24)}${text("YOUR BUSINESS", 102, 82, { size: 11, fill: PAPER, ls: 2 })}${text("Home   Projects   Files   Invoices", 330, 82, { size: 11, fill: STONE, weight: 500 })}
    ${text("Welcome back", 74, 130, { size: 22 })}
    ${[0, 1, 2].map((i) => `${rect(74 + i * 170, 150, 156, 80)}${text(["Projects", "Files", "Invoices"][i], 88 + i * 170, 176, { size: 13 })}${rect(88 + i * 170, 192, 90, 6, { fill: STONE, stroke: null })}${rect(88 + i * 170, 206, 60, 6, { fill: LINE, stroke: null })}`).join("")}
    ${[0, 1, 2].map((i) => `${line(74, 262 + i * 30, 566, 262 + i * 30, { sw: 1, stroke: LINE })}${rect(74, 272 + i * 30, 120, 8, { fill: STONE, stroke: null })}${rect(480, 270 + i * 30, 70, 12, { fill: PAPER, stroke: INK, sw: 1.5 })}`).join("")}`, "Concept illustration of a client portal"),
  invoice: frame(`
    ${rect(170, 24, 300, 352)}${mark(192, 46, 30)}${text("INVOICE", 448, 66, { size: 14, anchor: "end", ls: 3 })}${line(192, 92, 448, 92, { sw: 1.5, stroke: STONE })}
    ${bars(192, 108, 110, 3, { fill: STONE, h: 5, gap: 14 })}${[0, 1, 2].map((i) => `${line(192, 190 + i * 34, 448, 190 + i * 34, { sw: 1, stroke: LINE })}${rect(192, 202 + i * 34, 120, 7, { fill: LINE, stroke: null })}${rect(396, 202 + i * 34, 52, 7, { fill: STONE, stroke: null })}`).join("")}
    ${text("Total", 448, 296, { size: 12, weight: 500, fill: SLATE, anchor: "end" })}${text("$ — — —", 448, 316, { size: 18, anchor: "end" })}${rect(192, 334, 80, 24, { fill: INK, stroke: null })}${text("Pay now", 232, 350, { size: 11, fill: PAPER, anchor: "middle" })}`, "Concept illustration of an invoice"),
  seo: frame(`
    ${rect(80, 40, 480, 44, { fill: PAPER, sw: 2 })}<circle cx="106" cy="62" r="9" fill="none" stroke="${INK}" stroke-width="2"/>${line(113, 69, 120, 76)}${text("your service near you", 134, 67, { size: 14, weight: 500, fill: SLATE })}
    ${[0, 1, 2].map((i) => `${rect(80, 108 + i * 84, 480, 72, { fill: i === 0 ? PAPER : MIST, stroke: i === 0 ? INK : LINE, sw: i === 0 ? 2.5 : 1.5 })}${text(i === 0 ? "1" : String(i + 1), 100, 150 + i * 84, { size: 24, fill: i === 0 ? INK : STONE })}${rect(140, 126 + i * 84, 200, 9, { fill: i === 0 ? INK : STONE, stroke: null })}${rect(140, 146 + i * 84, 340, 6, { fill: LINE, stroke: null })}${rect(140, 160 + i * 84, 260, 6, { fill: LINE, stroke: null })}`).join("")}`, "Concept illustration of a search results page"),
  ai: frame(`
    ${rect(50, 60, 150, 80)}${text("Incoming", 125, 94, { size: 13, anchor: "middle" })}${text("email, form, call", 125, 114, { size: 10, weight: 500, fill: SLATE, anchor: "middle" })}
    ${rect(245, 120, 150, 160, { fill: INK })}<path d="M320 160 l8 18 18 8 -18 8 -8 18 -8 -18 -18 -8 18 -8z" fill="${PAPER}"/>${text("Automation", 320, 258, { size: 13, fill: PAPER, anchor: "middle" })}
    ${rect(440, 60, 150, 80)}${text("Reply drafted", 515, 94, { size: 13, anchor: "middle" })}${rect(440, 160, 150, 80)}${text("Lead sorted", 515, 194, { size: 13, anchor: "middle" })}${rect(440, 260, 150, 80)}${text("Task created", 515, 294, { size: 13, anchor: "middle" })}
    ${line(200, 100, 245, 170)}${line(395, 170, 440, 100)}${line(395, 200, 440, 200)}${line(395, 230, 440, 300)}${line(125, 140, 125, 330, { stroke: STONE, dash: "4 6" })}${text("You review", 125, 350, { size: 11, weight: 500, fill: SLATE, anchor: "middle" })}`, "Concept illustration of an AI automation that sorts incoming messages"),
  workflow: frame(`
    ${["Request", "Approve", "Work", "Deliver"].map((t, i) => `${rect(40 + i * 150, 150, 110, 80, { fill: i === 3 ? INK : PAPER })}${text(t, 95 + i * 150, 196, { size: 14, anchor: "middle", fill: i === 3 ? PAPER : INK })}${i < 3 ? `${line(150 + i * 150, 190, 190 + i * 150, 190)}<path d="M${186 + i * 150} 184 l8 6 -8 6z" fill="${INK}"/>` : ""}`).join("")}
    ${rect(190, 270, 110, 56, { stroke: STONE })}${text("Notify team", 245, 304, { size: 11, weight: 500, fill: SLATE, anchor: "middle" })}${line(245, 230, 245, 270, { stroke: STONE, dash: "4 4" })}
    ${rect(340, 70, 110, 56, { stroke: STONE })}${text("Reminder", 395, 104, { size: 11, weight: 500, fill: SLATE, anchor: "middle" })}${line(395, 126, 395, 150, { stroke: STONE, dash: "4 4" })}`, "Concept illustration of an automated workflow"),
  integrations: frame(`
    ${rect(60, 100, 170, 200)}${text("Your website", 145, 140, { size: 14, anchor: "middle" })}${bars(84, 160, 122, 4, { fill: LINE, h: 7, gap: 22 })}
    ${rect(410, 100, 170, 200)}${text("Accounting", 495, 140, { size: 14, anchor: "middle" })}${bars(434, 160, 122, 4, { fill: LINE, h: 7, gap: 22 })}
    ${rect(270, 170, 100, 60, { fill: INK })}${text("Sync", 320, 207, { size: 15, fill: PAPER, anchor: "middle" })}${line(230, 200, 270, 200)}${line(370, 200, 410, 200)}
    <path d="M254 194 l10 6 -10 6z" fill="${INK}"/><path d="M386 194 l-10 6 10 6z" fill="${INK}" transform="translate(0 0)"/>${rect(280, 250, 80, 20, { fill: PAPER, stroke: STONE, sw: 1.5 })}${text("Your CRM", 320, 265, { size: 10, weight: 500, fill: SLATE, anchor: "middle" })}${line(320, 230, 320, 250, { stroke: STONE, dash: "4 4" })}`, "Concept illustration of software integrations syncing data between systems"),
  tools: frame(`
    ${rect(150, 40, 340, 320)}${text("Project estimate", 170, 76, { size: 18 })}
    ${["Area (sq ft)", "Material", "Finish"].map((t, i) => `${text(t, 170, 112 + i * 62, { size: 11, weight: 500, fill: SLATE })}${rect(170, 120 + i * 62, 300, 32, { fill: PAPER, sw: 1.5 })}${rect(180, 133 + i * 62, [70, 110, 90][i], 7, { fill: STONE, stroke: null })}`).join("")}
    ${rect(170, 306, 120, 36, { fill: INK, stroke: null })}${text("Calculate", 230, 329, { size: 13, fill: PAPER, anchor: "middle" })}${text("Estimate", 400, 316, { size: 10, weight: 500, fill: SLATE, anchor: "middle" })}${text("$ — — —", 400, 338, { size: 18, anchor: "middle" })}`, "Concept illustration of a custom calculator tool"),
  other: frame(`
    ${rect(110, 70, 180, 120, { stroke: STONE })}${line(110, 70, 290, 190, { stroke: STONE, dash: "5 7", sw: 1.5 })}${line(290, 70, 110, 190, { stroke: STONE, dash: "5 7", sw: 1.5 })}
    ${rect(350, 70, 180, 120, { stroke: STONE })}${rect(350, 220, 180, 100, { stroke: STONE })}${rect(110, 220, 180, 100, { stroke: INK })}
    ${rect(190, 250, 22, 40, { fill: INK, stroke: null })}${rect(180, 260, 42, 22, { fill: INK, stroke: null })}${text("Your idea", 200, 350, { size: 14, anchor: "middle" })}`, "Concept illustration of a custom project: an outline waiting for your idea"),
};
mkdirSync(new URL("../assets/img/portal/", import.meta.url), { recursive: true });
for (const [name, svg] of Object.entries(art)) writeFileSync(new URL(`../assets/img/portal/${name}.svg`, import.meta.url), svg);
console.log(Object.keys(art).length + " illustrations written");
