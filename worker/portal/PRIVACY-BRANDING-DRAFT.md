# Privacy policy: proposed amendments for Branding (DRAFT FOR ADVISER REVIEW)

**Nothing here is published.** `privacy.html` is unchanged (Production's policy still has no client-portal content; the Staging copy is the existing portal draft). This file only
proposes wording. It is not legal advice. Markers: **[DECISION]** needs your business decision; **[LEGAL]** needs adviser review.

## Why an amendment is needed
Branding adds three new kinds of information to the portal: (1) **files** clients upload (logos, fonts, guidelines, business cards, email signatures, reference documents),
(2) **brand deliverables** Framework provides, and (3) **service requests** ("Request a quote"). Business cards and email signatures often contain **personal information**
(names, job titles, phone numbers, email addresses of the client's staff). Files are stored in a new private store (Cloudflare R2).

## 1. "Information in the client portal" (new items)
> **Brand materials you upload:** files you choose to share with us, such as logos, brand guidelines, colour palettes, font files, business cards, email signatures and reference documents, together with the file's name, type, size, the date it was uploaded and who in your organization uploaded it. These files can contain personal information about the people named on them, so please upload only what is needed. Everyone in your organization who uses the portal can see and download files uploaded for your organization.
>
> **Brand deliverables:** the logos, colours, typography, guidelines and other brand files Framework prepares for you and publishes to your portal.
>
> **Service requests:** if you ask us for a quote for a service (for example business card design), we keep the request, the optional note you add, who made it and when, and how we followed up.
>
> **File activity records:** short records of when files are uploaded, downloaded or deleted, and by whom. They do not contain the file or its address.

## 2. "How we use personal information"
> To store the brand materials you upload and make them available to you and the people in your organization, to prepare and deliver brand work, to respond to quote requests, and to keep the portal secure (including reviewing uploaded files for safety). We do not use uploaded files for advertising, and we do not sell them.

**[DECISION D1]** Confirm that uploads and quote requests are used only for those purposes (no marketing, no portfolio or case-study use without asking).

## 3. Who can see files
> People in your organization who use the portal can see, download and upload brand files. Only Owners can delete files uploaded for the organization or request a quote. Authorized Framework personnel can view and download files you upload, when needed to provide services to you.

**[DECIDED D2]** Owners and members can view, download and upload; only Owners delete shared uploads or request a quote. Staff download activity stays internal. Counsel should still confirm that is acceptable given that files may include personal information.

## 4. Security and where files are stored
> Files are stored in a private Cloudflare storage service and are only reachable through the portal after you sign in. We check files when they are uploaded and do not display them in the portal. No technical control can guarantee that a file is free of harmful content; please upload only files you trust.
>
> As with other portal information, this storage may be located outside Alberta and outside Canada. **[LEGAL]** the existing wording on providers outside Canada should be checked for files.

## 5. Retention and deletion
> We keep files while your organization has an active relationship with us, and generally for 90 days afterward, unless we need to keep them longer for contractual, legal or privacy reasons. After that we delete them. You can ask us to delete files earlier by contacting [owner contact], and Owners can delete files they or their colleagues uploaded.

**[DECISION D3]** The 90-day period is decided. Still open: whether deliverables are kept longer, whether deletion metadata is kept, and the backup statement (deleted files are not recoverable). **[LEGAL]** consistency with the 12-month review promise and the access/deletion request timing already in the draft.

## 6. Fonts
> If you upload font files, you confirm that you are allowed to share them with Framework for the purpose of your project. We do not make uploaded fonts available to anyone outside Framework and your organization.

## 7. Items for the adviser
1. Whether notice (no consent step) suffices for uploaded files that contain colleagues' personal information, as for the Business Profile.
2. Disclosure of storage outside Alberta/Canada for files.
3. Retention wording and the interaction with deletion requests.
4. Staff access wording ("authorized personnel ... when needed") and whether staff downloads should be disclosed as logged.
5. Whether a short in-portal notice at the upload form is also needed (recommended: one line, "Don't upload anything you aren't allowed to share").

## 8. Publication
Not before the adviser's review, and not before Branding is switched on for Production. Publishing changes the live site the moment `privacy.html` reaches `main`; the effective date must be set at publication.
