# Apple Wallet setup guide (owner steps)

You do these steps once. Claude never needs, and must never be sent, your private key, passphrase or Apple password.
Works on Windows, macOS or Linux. You need: Node.js 18 or newer, an iPhone with an Apple ID that has two-factor sign-in, and a card or bank account for Apple's yearly fee.

**What you are making.** A "pass" file that Apple Wallet accepts. Apple only accepts it if it is signed with a certificate that Apple issues to you. The signing happens on your computer; the private key never leaves it and is never put in the website, GitHub or Cloudflare.

## 1. Join the Apple Developer Program (about US$99 a year)
1. Go to https://developer.apple.com/programs/enroll/ and sign in with the Apple ID you want to own this.
2. Choose **Individual** (fastest; often same day) or **Organization** (needs a legal entity and a D-U-N-S number; slower). Either works. The name on the pass is "Framework" regardless, because that is written into the pass itself.
3. Pay and wait for Apple's "Welcome" email. The membership must stay active: the Add to Apple Wallet badge licence and new signing depend on it.

## 2. Register the Pass Type ID
1. Open https://developer.apple.com/account/resources/identifiers/list and click **+**.
2. Choose **Pass Type IDs**, **Continue**.
3. Description: `Framework business card`. Identifier: exactly `pass.ca.frameworkco.card`. **Continue**, **Register**.
(Only the Account Holder or an Admin can do this.)

## 3. Create your private key and request file (on your computer)
In a terminal, inside this repository:
```
node scripts/wallet/wallet.mjs init
```
- It creates a folder `framework-wallet-secrets` in your home folder with two files: `pass-private-key.pem` (SECRET) and `pass-request.certSigningRequest` (safe to upload).
- It refuses to write inside this repository, and it never overwrites an existing key.
- Optional extra protection: before running, set a passphrase in the terminal (`set WALLET_KEY_PASSPHRASE=your passphrase` on Windows cmd, `$env:WALLET_KEY_PASSPHRASE="..."` in PowerShell, `export WALLET_KEY_PASSPHRASE='...'` on macOS/Linux). You must set the same one again whenever you build. Do not forget it.
- **Back up `pass-private-key.pem`** somewhere private (a password manager's file storage, an encrypted drive). If you lose it you can simply repeat steps 3 to 5 and get a new certificate, so a loss is annoying, not fatal.

## 4. Get your certificate from Apple
1. Back on the identifiers page, click `pass.ca.frameworkco.card`, then **Create Certificate** (under Production Certificates).
2. Upload `pass-request.certSigningRequest`, **Continue**, then **Download**. You get `pass.cer`. Move it into `framework-wallet-secrets`.

## 5. Download Apple's intermediate certificate
1. Open https://www.apple.com/certificateauthority/ and, under "Worldwide Developer Relations", download the current certificate (today that is **G4**, file `AppleWWDRCAG4.cer`; if the next step says it did not issue your certificate, download the other "Worldwide Developer Relations" ones listed there and try those).
2. Save it in `framework-wallet-secrets` too.

## 6. Download Apple's official button
1. Open https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/ and download the **Add to Apple Wallet** badge in SVG (black, your language).
2. Save it as `assets/img/wallet/add-to-apple-wallet.svg` in this repository. Do not edit it.

## 7. Build and check the pass
Replace the paths with where your files are (the quotes matter if a path has spaces):
```
node scripts/wallet/wallet.mjs build --cert "C:\Users\you\framework-wallet-secrets\pass.cer" --wwdr "C:\Users\you\framework-wallet-secrets\AppleWWDRCAG4.cer" --key "C:\Users\you\framework-wallet-secrets\pass-private-key.pem"
node scripts/wallet/wallet.mjs verify
```
- The tool checks that the certificate is for `pass.ca.frameworkco.card`, matches your key, was issued by Apple's intermediate, and has not expired. Any problem is explained in plain words and nothing is written.
- If Apple's servers or iPhone reject the pass later with the default settings, build again adding `--digest sha1`.
- It writes `assets/wallet/Framework-card.pkpass` and `assets/wallet/pass-meta.json`. Those two files are safe to publish.
- Want to rehearse first, with no Apple account? `node scripts/wallet/wallet.mjs rehearse` does a full dry run with a fake certificate. The result cannot be installed and is never published.

## 8. Turn the button on (Staging first)
1. In `assets/js/card-config.js` set `walletUrl: "/api/card/wallet.pkpass"`.
2. Run `node --test worker/test/*.test.mjs`. The wallet guards fail if anything is missing (pass, badge, current details, Apple signing).
3. Open a pull request into `Staging`, merge when the checks pass. Production needs your separate approval.

## 9. Test on a real iPhone (Staging)
Open the Staging `/card` in **Safari** on an iPhone.
- [ ] The black "Add to Apple Wallet" button appears under Save Contact (it never appears on Android or desktop, by design).
- [ ] Tap it. Wallet shows the pass preview with logo, name, title, QR code. Tap **Add**.
- [ ] The pass is in Wallet; the QR opens the card when scanned; phone, email and website are on the back (tap "i").
- [ ] Save Contact, Call, Text, Email, Share and Show QR Code still work as before.
- [ ] Optional: it also appears on a paired Apple Watch.
Tell Claude what you saw (screenshots are fine; never your key).

## 10. Every year
Your certificate expires (the tool prints the date at build time and the tests fail once it has passed). Passes already on phones keep working, but new installs need a fresh certificate: repeat steps 3 to 5 and 7, then merge. Keep the Developer Program membership active.

## Troubleshooting
| Message | Meaning |
|---|---|
| "inside the repository" | Move the key or certificate to a private folder outside the repo. |
| "does not belong" | The key is not the one created by `init` for this certificate. |
| "is for X, not pass.ca.frameworkco.card" | You downloaded the certificate for another identifier. |
| "did not issue your pass certificate" | Try the other Worldwide Developer Relations certificate on apple.com/certificateauthority. |
| Button does not show on the phone | The page only shows it on iPhone/iPad Safari, and only when the pass address answers. Open `/api/card/wallet.pkpass` on the Staging address to see: a download prompt means ready, a "not_found" message means not ready. |
