# Brand Discovery images: provenance and licence status

Status: **not verified**. Nothing in this repository records who made, shot or licensed any of these images. The only source information is that the owner supplied them (pull requests #146 to #154 call them "supplied artwork" or "supplied images"). The notes below come from looking at the pictures, not from a licence check. **Do not treat an image as licensed because it is in the repository.**

## What was checked
- Embedded metadata (EXIF, IPTC, XMP, C2PA): the 12 logos carry C2PA content credentials, which marks them as AI-generated. The 48 photos, textures and direction images carry none, so nothing identifies a photographer, stock library or licence.
- Duplicates: none of the 60 files is byte-identical to any other image in the repository, so none was copied from the existing site assets.
- History: all 60 were added on 4 November 2026 in PRs #146 to #154 by the owner; commit and PR text give no source.
- Visual review: the notes below.

## Priority
- **P1 replace unless a licence (and, for people, a release) is produced:** dark, bold (directions), lifestyle, abstract3d, flatlay (imagery), blank (textures). Real people, brand marks, an apparent third-party template or an apparent vendor wallpaper.
- **P2 needs proof of licence or replacement:** the other photographs and texture images (23 files: 15 textures and 8 photographs).
- **P3 AI-generated or illustrative:** the 12 logos and the other direction images (and the flat illustration). Keep the generation records and check the tool's commercial-use terms; check that fictional business names (for example Roselune, Stonefield Interiors, Savage Forms, The Boho Depot) are not real businesses.

## How to replace an image
Remove the file and remove its key from the matching list at the top of `worker/portal/discovery/pages.js` (`LOGO_IMAGES`, `DIRECTION_IMAGES`, `IMAGERY_IMAGES`, `TEXTURE_IMAGES`). The card then shows the generated SVG sketch that was there before, so a missing photo never leaves a broken card. Admin can also attach a picture to any option (Admin > Brand Discovery > content), which replaces the built-in one.

## Inventory

| Set | File | KB | SHA-256 (first 10) | Priority | Source | Note |
|---|---|---:|---|---|---|---|
| logos | abstract.png | 742 | ec0996b7d0 | P3 | owner-supplied; PR #154 ("supplied artwork") | AI-generated: embedded C2PA content credentials; owner confirmed. Keep the generation records; check the generator's commercial-use terms. |
| logos | botanical.png | 1887 | b70214efee | P3 | owner-supplied; PR #154 ("supplied artwork") | AI-generated: embedded C2PA content credentials; owner confirmed. Keep the generation records; check the generator's commercial-use terms. |
| logos | celestial.png | 1846 | 5028d7ceb6 | P3 | owner-supplied; PR #154 ("supplied artwork") | AI-generated: embedded C2PA content credentials; owner confirmed. Keep the generation records; check the generator's commercial-use terms. |
| logos | combination.png | 1785 | 9f9a683e90 | P3 | owner-supplied; PR #154 ("supplied artwork") | AI-generated: embedded C2PA content credentials; owner confirmed. Keep the generation records; check the generator's commercial-use terms. |
| logos | crest.png | 2054 | 685ca242aa | P3 | owner-supplied; PR #154 ("supplied artwork") | AI-generated: embedded C2PA content credentials; owner confirmed. Keep the generation records; check the generator's commercial-use terms. |
| logos | emblem.png | 1563 | 38b33ee4af | P3 | owner-supplied; PR #154 ("supplied artwork") | AI-generated: embedded C2PA content credentials; owner confirmed. Keep the generation records; check the generator's commercial-use terms. |
| logos | lettermark.png | 1054 | 7ff55216d0 | P3 | owner-supplied; PR #154 ("supplied artwork") | AI-generated: embedded C2PA content credentials; owner confirmed. Keep the generation records; check the generator's commercial-use terms. |
| logos | mascot.png | 1080 | 8432e3b30e | P3 | owner-supplied; PR #154 ("supplied artwork") | AI-generated: embedded C2PA content credentials; owner confirmed. Keep the generation records; check the generator's commercial-use terms. |
| logos | ornamental.png | 1880 | 0b38566d9c | P3 | owner-supplied; PR #154 ("supplied artwork") | AI-generated: embedded C2PA content credentials; owner confirmed. Keep the generation records; check the generator's commercial-use terms. |
| logos | pictorial.png | 1204 | ad73a66c01 | P3 | owner-supplied; PR #154 ("supplied artwork") | AI-generated: embedded C2PA content credentials; owner confirmed. Keep the generation records; check the generator's commercial-use terms. |
| logos | script.png | 1355 | 0e7d956bde | P3 | owner-supplied; PR #154 ("supplied artwork") | AI-generated: embedded C2PA content credentials; owner confirmed. Keep the generation records; check the generator's commercial-use terms. |
| logos | wordmark.png | 1326 | bf60efb018 | P3 | owner-supplied; PR #154 ("supplied artwork") | AI-generated: embedded C2PA content credentials; owner confirmed. Keep the generation records; check the generator's commercial-use terms. |
| directions | architectural.jpg | 16 | 13d23e7bb3 | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Logo mock-up, fictional name 'Savage Forms Architecture'. Looks AI-generated; confirm tool and terms; check the name is not a real business. |
| directions | bohemian.jpg | 26 | 1a558624d3 | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Logo mock-up, name 'The Boho Depot'. Looks AI-generated; check the name. |
| directions | bold.jpg | 64 | 29ca65f1cd | P1 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Stylised portrait of a real-looking person with a large red letter. Check it is AI-generated or licensed, and that no real person is identifiable. |
| directions | dark.jpg | 36 | 83424be425 | P1 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Looks like a website/UI template or screenshot ('Aer', 'Work Anywhere', a hooded person). Likely third-party design. |
| directions | editorial.jpg | 15 | 60f7a7f92f | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Looks AI-generated logo/brand mock-up. Confirm the tool and terms. |
| directions | feminine.jpg | 26 | b1904dcc26 | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Logo mock-up, name 'Roselune Beauty & Wellness'. Looks AI-generated; check the name is not a real business. |
| directions | futuristic.jpg | 53 | cfc1dad74c | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Looks AI-generated logo/brand mock-up. Confirm the tool and terms. |
| directions | gothic.jpg | 41 | 5ef6bbc853 | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Looks AI-generated logo/brand mock-up. Confirm the tool and terms. |
| directions | holistic.jpg | 23 | 5ab2a1b41b | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Looks AI-generated logo/brand mock-up. Confirm the tool and terms. |
| directions | industrial.jpg | 69 | 312c1641fb | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Poster mock-up with the words 'Industrial Design Co.'. Looks AI-generated. |
| directions | luxury.jpg | 15 | fd71559873 | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Looks AI-generated logo/brand mock-up. Confirm the tool and terms. |
| directions | minimalist.jpg | 13 | bc1ba8f4fd | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Looks AI-generated logo/brand mock-up. Confirm the tool and terms. |
| directions | modern.jpg | 73 | 6be22a32d8 | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Looks AI-generated logo/brand mock-up. Confirm the tool and terms. |
| directions | mystical.jpg | 62 | 5c798d60fd | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Looks AI-generated logo/brand mock-up. Confirm the tool and terms. |
| directions | organic.jpg | 82 | 0fb66b59e3 | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Looks AI-generated logo/brand mock-up. Confirm the tool and terms. |
| directions | playful.jpg | 41 | 714cfb8a24 | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Typographic mock-up ('PLAYFUL'); check the lettering is not a licensed font or an existing logo. |
| directions | retro.jpg | 69 | 28d230855f | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Looks AI-generated logo/brand mock-up. Confirm the tool and terms. |
| directions | romantic.jpg | 70 | 7bf82ce60b | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Illustration of a couple. Looks AI-generated; confirm. |
| directions | rustic.jpg | 128 | 348d157580 | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Looks AI-generated logo/brand mock-up. Confirm the tool and terms. |
| directions | traditional.jpg | 74 | baac81cf78 | P3 | owner-supplied; PR #148 (Add Futuristic, Gothic, Architectural, Dark; replace Minimalist), PR #147, PR #146 ("supplied artwork") | Logo mock-up, name 'Stonefield Interiors'. Looks AI-generated; check the name. |
| imagery | abstract3d.jpg | 27 | 878cc802e4 | P1 | owner-supplied; PR #153 ("the 12 supplied images") | Abstract 3D render that resembles an operating-system wallpaper. Confirm it is not a vendor wallpaper. |
| imagery | aerial.jpg | 164 | 5bd742b216 | P2 | owner-supplied; PR #153 ("the 12 supplied images") | Photograph (aerial road). Needs a licence. |
| imagery | architectural.jpg | 78 | 2bdfdbf432 | P2 | owner-supplied; PR #153 ("the 12 supplied images") | Photograph (building). Needs a licence. |
| imagery | botanical.jpg | 96 | 5872703784 | P2 | owner-supplied; PR #153 ("the 12 supplied images") | Photograph (leaves). Needs a licence. |
| imagery | detail.jpg | 85 | 6834baeeef | P2 | owner-supplied; PR #153 ("the 12 supplied images") | Macro photograph of a watch dial; a brand may be visible. |
| imagery | documentary.jpg | 91 | 008d3baa5c | P2 | owner-supplied; PR #153 ("the 12 supplied images") | Photograph of the Manhattan Bridge area. Needs a licence; no people clearly identifiable. |
| imagery | flat.jpg | 23 | e6c8c7d4e6 | P3 | owner-supplied; PR #153 ("the 12 supplied images") | Vector-style illustration. Confirm origin. |
| imagery | flatlay.jpg | 57 | 580ac59dd6 | P1 | owner-supplied; PR #153 ("the 12 supplied images") | Photograph of a wristwatch, keys and a lighter; a watch brand and logo may be visible (trademark). |
| imagery | hand.jpg | 49 | 122515c849 | P2 | owner-supplied; PR #153 ("the 12 supplied images") | Photograph of a hand drawing. Needs a licence. |
| imagery | lifestyle.jpg | 81 | 3f56c2042a | P1 | owner-supplied; PR #153 ("the 12 supplied images") | Photograph of two identifiable people. Needs a licence AND model releases; replace unless both are on file. |
| imagery | softfocus.jpg | 41 | 511b2f60aa | P2 | owner-supplied; PR #153 ("the 12 supplied images") | Photograph (cloud). Needs a licence. |
| imagery | studio.jpg | 48 | 10d823ca4e | P2 | owner-supplied; PR #153 ("the 12 supplied images") | Photograph (photo studio). Needs a licence. |
| textures | blank.jpg | 10 | e69c514368 | P1 | owner-supplied; PR #151 ("Refresh Brand Discovery texture cards") | Phone mock-up with an Apple-style device design. Replace with a neutral shape or a licensed mock-up. |
| textures | concrete.jpg | 50 | 3f08f3d2d1 | P2 | owner-supplied; PR #151 ("Refresh Brand Discovery texture cards") | Texture photograph or scan. Needs a licence (a historic map or textile scan may be public domain, but say so). |
| textures | floral.jpg | 92 | 2a861cec47 | P2 | owner-supplied; PR #151 ("Refresh Brand Discovery texture cards") | Texture photograph or scan. Needs a licence (a historic map or textile scan may be public domain, but say so). |
| textures | gilded.jpg | 80 | 494c16354f | P2 | owner-supplied; PR #151 ("Refresh Brand Discovery texture cards") | Texture photograph or scan. Needs a licence (a historic map or textile scan may be public domain, but say so). |
| textures | halftone.jpg | 141 | c56f1dc647 | P2 | owner-supplied; PR #151 ("Refresh Brand Discovery texture cards") | Texture photograph or scan. Needs a licence (a historic map or textile scan may be public domain, but say so). |
| textures | linen.jpg | 37 | cec67015df | P2 | owner-supplied; PR #151 ("Refresh Brand Discovery texture cards") | Texture photograph or scan. Needs a licence (a historic map or textile scan may be public domain, but say so). |
| textures | lines.jpg | 18 | 391aaacf35 | P2 | owner-supplied; PR #151 ("Refresh Brand Discovery texture cards") | Texture photograph or scan. Needs a licence (a historic map or textile scan may be public domain, but say so). |
| textures | marble.jpg | 31 | 2736644583 | P2 | owner-supplied; PR #151 ("Refresh Brand Discovery texture cards") | Texture photograph or scan. Needs a licence (a historic map or textile scan may be public domain, but say so). |
| textures | mosaic.jpg | 90 | 6a433665b4 | P2 | owner-supplied; PR #151 ("Refresh Brand Discovery texture cards") | Texture photograph or scan. Needs a licence (a historic map or textile scan may be public domain, but say so). |
| textures | paper.jpg | 22 | c58d92cc06 | P2 | owner-supplied; PR #151 ("Refresh Brand Discovery texture cards") | Texture photograph or scan. Needs a licence (a historic map or textile scan may be public domain, but say so). |
| textures | rust.jpg | 63 | 1ced053e3d | P2 | owner-supplied; PR #151 ("Refresh Brand Discovery texture cards") | Texture photograph or scan. Needs a licence (a historic map or textile scan may be public domain, but say so). |
| textures | steel.jpg | 15 | 5a2e8978b4 | P2 | owner-supplied; PR #151 ("Refresh Brand Discovery texture cards") | Texture photograph or scan. Needs a licence (a historic map or textile scan may be public domain, but say so). |
| textures | terrazzo.jpg | 102 | 3dc4faf64d | P2 | owner-supplied; PR #151 ("Refresh Brand Discovery texture cards") | Texture photograph or scan. Needs a licence (a historic map or textile scan may be public domain, but say so). |
| textures | topographic.jpg | 75 | 3cb9ab5ffc | P2 | owner-supplied; PR #151 ("Refresh Brand Discovery texture cards") | Texture photograph or scan. Needs a licence (a historic map or textile scan may be public domain, but say so). |
| textures | watercolour.jpg | 55 | 39770a8777 | P2 | owner-supplied; PR #151 ("Refresh Brand Discovery texture cards") | Texture photograph or scan. Needs a licence (a historic map or textile scan may be public domain, but say so). |
| textures | wood.jpg | 79 | 530c771acb | P2 | owner-supplied; PR #151 ("Refresh Brand Discovery texture cards") | Texture photograph or scan. Needs a licence (a historic map or textile scan may be public domain, but say so). |
