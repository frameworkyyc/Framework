# Apple Wallet pass for the digital business card

Adds an "Add to Apple Wallet" button to `/card`. Owner steps: `scripts/wallet/SETUP.md`. Tests: `worker/test/card-wallet.test.mjs`.

## How it works
1. `scripts/wallet/wallet.mjs build` creates the pass **on the owner's computer** from `assets/js/card-config.js` (single source of truth), signs it with the owner's Apple Pass Type ID certificate, and writes `assets/wallet/Framework-card.pkpass` and `assets/wallet/pass-meta.json`.
2. Both files are committed. `worker/card-wallet.js` serves the pass at `/api/card/wallet.pkpass` (`application/vnd.apple.pkpass`).
3. The Worker serves it only when `pass-meta.json` says `status: ready`, `signing: apple` and the Pass Type ID matches. Otherwise it answers 404. A test-signed pass can therefore never reach a phone.
4. `card.js` reveals the button only when `walletUrl` is configured, the visitor is on an iPhone/iPad, Apple's badge loaded, and a HEAD request to the pass returns 200 with the pass content type. Every other case leaves the card exactly as before.

## Pass
Generic pass, `pass.ca.frameworkco.card`, serial `framework-card-jj-brick-v1`. Monochrome (black background, white text). Logo, name, title, company, phone, email, website, QR code to the card URL; back: phone, email, website, card link, Instagram, about, how to save the contact. No photo, no locations, no update service yet.
Poster Generic (iOS 27) can be added later by adding its keys beside `generic`; nothing here prevents it.

## Security
- The private key and certificates live in a folder **outside** the repository. The tool refuses repository paths (including via symlinks), `.gitignore` and `.assetsignore` block `*.p12 *.pem *.key *.cer *.certSigningRequest wallet-secrets/`, `scripts/` is not published, and a test fails if key material is tracked.
- Cloudflare holds no secret for this feature: the pass is a pre-signed static file. Nothing in the pass is private (it carries the same details as the public card).
- Anyone with the pass file could read it, so it contains only public information. Do not add private data to it.

## Rebuilding
Rebuild and commit whenever `card-config.js` details change, or the certificate nears its expiry (the meta file records `certNotAfter`). A guard test fails if the committed pass no longer matches the configuration or if the certificate has expired.

## Automatic updates (not built; structure is ready)
Wallet can refresh installed passes when the details change. To add it later without redesign:
- Pass: add `webServiceURL` (`https://frameworkco.ca/api/card/wallet/`) and a random `authenticationToken` in `buildPassJson` (kept out today because Wallet would try to register). Bump `version` in the meta file and keep `serialNumber` stable.
- Worker: `/api/card/wallet/` is reserved. Apple's protocol needs `POST|DELETE /v1/devices/{device}/registrations/{passType}/{serial}`, `GET /v1/devices/{device}/registrations/{passType}?passesUpdatedSince=`, `GET /v1/passes/{passType}/{serial}` (the current pass, `If-Modified-Since` aware) and `POST /v1/log`.
- Storage: registrations need a small additive D1 table (a migration; needs approval).
- Push: the notification that wakes phones is signed with the same Pass Type ID certificate, so it would be sent from the owner's computer (or another trusted place), never with a key in Cloudflare.

## Open points that need a real device to confirm
Apple's rules were taken from Apple's documentation; behaviour on the real iPhone (re-adding the same pass, in-app browsers, Chrome on iOS) is confirmed in the Staging test checklist in `scripts/wallet/SETUP.md`. The CMS signature uses SHA-256 and has been verified with OpenSSL; if a phone rejects it, rebuild with `--digest sha1`.
