# Brand Discovery images: provenance and licence status

Last updated 5 November 2026 after the owner's instructions.

## Decision
The owner has confirmed that the **photos and textures (32 files) come from Unsplash**, which permits commercial use under its standard licence, and that the **12 logo examples are AI-generated**. All existing images are kept. Nothing is replaced only because the repository holds no licence record.

## What the records show
- **Logos (12):** embedded C2PA content credentials mark them as AI-generated, which matches the owner's statement. Keep the generation records and the generator's commercial-use terms.
- **Photos (12) and textures (16):** source stated by the owner as Unsplash. The files carry no embedded photographer or page URL, so **please keep a list of the Unsplash page URL and photographer for each file** (add them to the Source column below when known). Unsplash does not require attribution, but a record shows where each file came from.
- **Design directions (20):** the owner has not stated a source. Most look AI-generated logo or poster mock-ups with fictional brand names. Please confirm.
- No file is byte-identical to any other image in the repository.

## Follow-up rights review (after launch; does not block it)
The owner has decided to keep all existing images for the launch. The seven files below are recorded for a follow-up review: keep, or swap to the generated sketch.

## Quick rights review (people and trademarks)
Unsplash's licence covers use of the photograph; it does not give trademark rights or a model release for identifiable people. These are the files where that matters. None is a blocker if the owner accepts the risk for illustrative use; each is a one-minute decision (keep, or swap to the generated sketch by removing the file and its key from the list at the top of `worker/portal/discovery/pages.js`).

| File | Flag |
|---|---|
| imagery/lifestyle.jpg | PEOPLE: two identifiable people. Unsplash's licence does not include a model release or the right to use a likeness commercially in a way that implies endorsement. Quick review: confirm that is acceptable for illustrative use, or swap. |
| imagery/flatlay.jpg | TRADEMARKS: the watch face reads TIMEX and QUARTZ, the knife is marked WESN, and a lighter and coin are shown. Unsplash does not grant trademark rights. Quick review, or swap. |
| imagery/documentary.jpg | MINOR: vehicles with visible badges and licence plates on a public street; no clearly identifiable person. Quick review. |
| imagery/abstract3d.jpg | CHECK: resembles an operating-system wallpaper. Confirm the Unsplash page and that it is not a vendor wallpaper. |
| textures/blank.jpg | TRADEMARK / DESIGN: a phone shaped like a recent iPhone (camera island). Looks like a device mock-up rather than a photograph; confirm it really came from Unsplash, or swap for a neutral shape. |
| directions/bold.jpg | PEOPLE: a stylised portrait of a person. The owner has said photos and textures are from Unsplash; this is a direction image, so confirm its source and that the person is not identifiable. |
| directions/dark.jpg | TRADEMARK / THIRD-PARTY DESIGN: looks like a website or app screen ('Aer', 'Work Anywhere') with a hooded person. Confirm its source. |

No other file shows an identifiable person or a readable brand.

## How to swap an image
Remove the file and its key from the matching list at the top of `worker/portal/discovery/pages.js` (`LOGO_IMAGES`, `DIRECTION_IMAGES`, `IMAGERY_IMAGES`, `TEXTURE_IMAGES`). Options that still have a generated sketch then show it. `dark` (directions) and `blank` (textures) have no generated sketch, so they would show the plain word card until a sketch is added. Admin can also attach a picture to any option (Admin > Brand Discovery > content).

## Inventory

| Set | File | KB | SHA-256 (first 10) | Source | Rights review |
|---|---|---:|---|---|---|
| logos | abstract.png | 742 | ec0996b7d0 | AI-generated (owner-confirmed); embedded C2PA content credentials | No |
| logos | botanical.png | 1887 | b70214efee | AI-generated (owner-confirmed); embedded C2PA content credentials | No |
| logos | celestial.png | 1846 | 5028d7ceb6 | AI-generated (owner-confirmed); embedded C2PA content credentials | No |
| logos | combination.png | 1785 | 9f9a683e90 | AI-generated (owner-confirmed); embedded C2PA content credentials | No |
| logos | crest.png | 2054 | 685ca242aa | AI-generated (owner-confirmed); embedded C2PA content credentials | No |
| logos | emblem.png | 1563 | 38b33ee4af | AI-generated (owner-confirmed); embedded C2PA content credentials | No |
| logos | lettermark.png | 1054 | 7ff55216d0 | AI-generated (owner-confirmed); embedded C2PA content credentials | No |
| logos | mascot.png | 1080 | 8432e3b30e | AI-generated (owner-confirmed); embedded C2PA content credentials | No |
| logos | ornamental.png | 1880 | 0b38566d9c | AI-generated (owner-confirmed); embedded C2PA content credentials | No |
| logos | pictorial.png | 1204 | ad73a66c01 | AI-generated (owner-confirmed); embedded C2PA content credentials | No |
| logos | script.png | 1355 | 0e7d956bde | AI-generated (owner-confirmed); embedded C2PA content credentials | No |
| logos | wordmark.png | 1326 | bf60efb018 | AI-generated (owner-confirmed); embedded C2PA content credentials | No |
| directions | architectural.jpg | 16 | 13d23e7bb3 | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| directions | bohemian.jpg | 26 | 1a558624d3 | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| directions | bold.jpg | 64 | 29ca65f1cd | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | Yes: PEOPLE |
| directions | dark.jpg | 36 | 83424be425 | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | Yes: TRADEMARK / THIRD-PARTY DESIGN |
| directions | editorial.jpg | 15 | 60f7a7f92f | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| directions | feminine.jpg | 26 | b1904dcc26 | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| directions | futuristic.jpg | 53 | cfc1dad74c | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| directions | gothic.jpg | 41 | 5ef6bbc853 | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| directions | holistic.jpg | 23 | 5ab2a1b41b | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| directions | industrial.jpg | 69 | 312c1641fb | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| directions | luxury.jpg | 15 | fd71559873 | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| directions | minimalist.jpg | 13 | bc1ba8f4fd | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| directions | modern.jpg | 73 | 6be22a32d8 | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| directions | mystical.jpg | 62 | 5c798d60fd | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| directions | organic.jpg | 82 | 0fb66b59e3 | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| directions | playful.jpg | 41 | 714cfb8a24 | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| directions | retro.jpg | 69 | 28d230855f | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| directions | romantic.jpg | 70 | 7bf82ce60b | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| directions | rustic.jpg | 128 | 348d157580 | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| directions | traditional.jpg | 74 | baac81cf78 | Not stated by the owner; most look AI-generated (fictional brand names). Owner to confirm | No |
| imagery | abstract3d.jpg | 27 | 878cc802e4 | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | Yes: CHECK |
| imagery | aerial.jpg | 164 | 5bd742b216 | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| imagery | architectural.jpg | 78 | 2bdfdbf432 | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| imagery | botanical.jpg | 96 | 5872703784 | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| imagery | detail.jpg | 85 | 6834baeeef | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| imagery | documentary.jpg | 91 | 008d3baa5c | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | Yes: MINOR |
| imagery | flat.jpg | 23 | e6c8c7d4e6 | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| imagery | flatlay.jpg | 57 | 580ac59dd6 | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | Yes: TRADEMARKS |
| imagery | hand.jpg | 49 | 122515c849 | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| imagery | lifestyle.jpg | 81 | 3f56c2042a | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | Yes: PEOPLE |
| imagery | softfocus.jpg | 41 | 511b2f60aa | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| imagery | studio.jpg | 48 | 10d823ca4e | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| textures | blank.jpg | 10 | e69c514368 | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | Yes: TRADEMARK / DESIGN |
| textures | concrete.jpg | 50 | 3f08f3d2d1 | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| textures | floral.jpg | 92 | 2a861cec47 | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| textures | gilded.jpg | 80 | 494c16354f | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| textures | halftone.jpg | 141 | c56f1dc647 | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| textures | linen.jpg | 37 | cec67015df | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| textures | lines.jpg | 18 | 391aaacf35 | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| textures | marble.jpg | 31 | 2736644583 | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| textures | mosaic.jpg | 90 | 6a433665b4 | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| textures | paper.jpg | 22 | c58d92cc06 | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| textures | rust.jpg | 63 | 1ced053e3d | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| textures | steel.jpg | 15 | 5a2e8978b4 | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| textures | terrazzo.jpg | 102 | 3dc4faf64d | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| textures | topographic.jpg | 75 | 3cb9ab5ffc | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| textures | watercolour.jpg | 55 | 39770a8777 | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| textures | wood.jpg | 79 | 530c771acb | Unsplash (owner-stated, 5 Nov 2026); photographer and page URL not recorded | No |
| imagery | earthy.jpg | 141 | 51e69eeb3d | Unsplash, added 5 November 2026: [Hans](https://unsplash.com/@hansphoto?utm_source=framework&utm_medium=referral), [photo page](https://unsplash.com/photos/a-close-up-view-of-a-brown-substance-RN0v7qyjGUE); downloaded through the Unsplash API | No |
| imagery | woody.jpg | 163 | 4b5ae78690 | Unsplash, added 5 November 2026: [Ruben Hanssen](https://unsplash.com/@rhfhanssen?utm_source=framework&utm_medium=referral), [photo page](https://unsplash.com/photos/brown-wood-logs-on-brown-dirt-road-0wl6_y8lTCM); downloaded through the Unsplash API | No |
| imagery | holistic.jpg | 39 | 410647ce70 | Unsplash, added 5 November 2026: [Sean Stratton](https://unsplash.com/@seanstratton?utm_source=framework&utm_medium=referral), [photo page](https://unsplash.com/photos/black-stacking-stones-on-gray-surface-ObpCE_X3j6U); downloaded through the Unsplash API | No |
| imagery | ethereal.jpg | 39 | 4cd0e68283 | Unsplash, added 5 November 2026: [Pascal Debrunner](https://unsplash.com/@debrupas?utm_source=framework&utm_medium=referral), [photo page](https://unsplash.com/photos/the-sun-is-shining-through-the-foggy-trees-RO9nomDWJk8); downloaded through the Unsplash API | No |
