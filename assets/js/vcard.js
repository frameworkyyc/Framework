/* vCard 3.0 builder for the Framework digital business card (works in the browser and in Node tests).
   Lines end in CRLF, text is escaped, and long lines are folded at 75 characters as RFC 2425/2426 require. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FrameworkVCard = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var escapeText = function (v) {
    return String(v == null ? "" : v)
      .replace(/\\/g, "\\\\")
      .replace(/\r\n|\r|\n/g, "\\n")
      .replace(/;/g, "\;")
      .replace(/,/g, "\\,");
  };

  // Fold to 75 characters per line (continuation lines start with one space).
  var fold = function (line) {
    if (line.length <= 75) return line;
    var out = [line.slice(0, 75)];
    for (var i = 75; i < line.length; i += 74) out.push(" " + line.slice(i, i + 74));
    return out.join("\r\n");
  };

  var splitName = function (full) {
    var parts = String(full || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return { family: "", given: parts[0] || "" };
    return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
  };

  /** @param c {name, company, role, phone, email, websiteUrl, cardUrl?} @returns {string} the .vcf text */
  var build = function (c) {
    var name = String(c.name || "").trim();
    var company = String(c.company || "").trim();
    var n = splitName(name);
    var lines = ["BEGIN:VCARD", "VERSION:3.0"];
    if (name) {
      lines.push("N:" + escapeText(n.family) + ";" + escapeText(n.given) + ";;;");
      lines.push("FN:" + escapeText(name));
    } else {
      lines.push("N:;;;;");
      lines.push("FN:" + escapeText(company));
    }
    if (company) lines.push("ORG:" + escapeText(company));
    if (c.role) lines.push("TITLE:" + escapeText(c.role));
    if (c.phone) lines.push("TEL;TYPE=CELL,VOICE:" + String(c.phone).replace(/[^\d+]/g, ""));
    if (c.email) lines.push("EMAIL;TYPE=INTERNET,WORK:" + escapeText(c.email));
    if (c.websiteUrl) lines.push("URL:" + String(c.websiteUrl).replace(/[\r\n]/g, ""));
    lines.push("END:VCARD");
    return lines.map(fold).join("\r\n") + "\r\n";
  };

  var fileName = function (c) {
    var base = String(c.name || c.company || "contact").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return (base || "contact") + ".vcf";
  };

  return { build: build, fileName: fileName, escapeText: escapeText, fold: fold };
}));
