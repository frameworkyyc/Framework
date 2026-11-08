# Official "Add to Apple Wallet" badge

The button on /card must use Apple's own badge, unmodified. It is licensed (free while you are an Apple Developer Program member) and
cannot be redistributed by anyone else, so it is not in the repository until the owner adds it.

1. Download "Add to Apple Wallet" (SVG, black) from https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/ (Apple's Marketing Resources and Identity Guidelines).
2. Save it as `assets/img/wallet/add-to-apple-wallet.svg`. Do not recolour, crop, redraw or add effects.
3. Keep the clear space around it (the page already does) and the Apple trademark credit line (already in the page footer, shown with the button).

The button stays hidden until this file, a signed pass and `walletUrl` in `assets/js/card-config.js` are all in place. See `worker/WALLET.md`.
