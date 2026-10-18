/* Framework digital business card: the details shown at /card.
   Edit this file only. Anything left empty ("") is simply not shown: no placeholder button or link is ever published.
   Keep real values only (they appear on the public page and in the downloaded contact file). */
window.FRAMEWORK_CARD = {
  // The permanent PUBLIC address of the card: what the QR code, Share button, saved contact and link previews use on the live site.
  // On any other host (Staging, local testing) the page automatically uses its own address instead, so tests never point at production.
  cardUrl: "https://frameworkco.ca/card",
  websiteUrl: "https://frameworkco.ca/",
  company: "Framework",

  name: "JJ Brick",
  title: "Founder",   // shown as "Founder, Framework" and stored as the contact title
  phone: "+16472153773", // international format
  email: "hello@frameworkco.ca",

  // Full profile URLs (https://…). Leave "" to hide an icon.
  social: {
    instagram: "https://www.instagram.com/frameworkmethod",
    linkedin: "",
    facebook: "",
    x: "",
    youtube: "",
    tiktok: ""
  }
};
