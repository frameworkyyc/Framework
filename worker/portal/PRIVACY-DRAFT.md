# Draft additions to the website privacy notice for the client portal

**Status: DRAFT for your review, not published, not legal advice.** The existing notice (`privacy.html`, effective October 17, 2026) is written for the website and
says Framework does not set cookies on the public pages; it names Cloudflare, Resend, Fontshare and Meta, not WorkOS; it describes assessment and feedback data, not portal
accounts. It already says Framework follows Alberta's Personal Information Protection Act (PIPA) and that providers may process information outside Alberta and Canada,
including in the United States, with contact `hello@frameworkco.ca`. Have your adviser confirm the final wording before the portal is opened to clients.
Items marked **[DECISION]** need your choice. Apply them in `privacy.html` through the normal Staging-to-`main` process and update the effective date.

## 1. Summary section: add one bullet
> If you are a Framework client and we give you access to the client portal, we use your name and email address to sign you in, show you only your own organization's
> project information, and keep a record of sign-ins for security.

## 2. "Information we collect": add a "Client portal" item
> **Client portal:** if you are invited to the client portal: your name and work email address; the organization you belong to and your role; your sign-in activity
> (when you signed in or out, the sign-in method used, and an irreversibly scrambled value derived from your network address that we use to detect abuse, not the address itself);
> and the project information we choose to share with your organization (project names, status, summaries, links and a short activity history). Your one-time sign-in codes
> and any second-factor details are handled by our sign-in provider, WorkOS, and are not stored by us.

## 3. "How we use personal information": add
> To give invited clients secure access to their project information; to keep the portal secure, prevent abuse and investigate security incidents; and to provide support.
> We do not use portal information for advertising and we do not sell it.

## 4. "Cookies, browser storage and analytics": replace the first sentence's scope
Current wording: "we do not set cookies on the public pages of this website ourselves." Keep it, and add:
> **Client portal:** when you sign in to the client portal we set two strictly necessary cookies on this site: a short-lived cookie that keeps a sign-in attempt secure while
> you are redirected to our sign-in provider, and a session cookie that keeps you signed in (it expires after 12 hours of inactivity or 14 days at most, and when you sign out).
> They are used only to provide the portal and are not used for tracking or advertising. Our sign-in provider may set its own cookies on its sign-in pages.

## 5. "Service providers": add WorkOS
> **WorkOS:** sign-in and account security for the client portal (email one-time codes, optional second factor, and the record that you signed in). WorkOS receives your name,
> email address, and technical sign-in details such as your network address and browser.
Also add to the Cloudflare line: "...and the database that stores client-portal accounts, organizations and project information".

## 6. "Where information is processed": confirm it covers the portal
The existing paragraph (processed outside Alberta and Canada, including the United States, and may be accessible to courts and authorities there) already applies. Add:
> This includes the client portal: our sign-in provider (WorkOS) and our hosting provider (Cloudflare) process portal information in the United States and other countries.
> If you have questions about our service providers outside Canada, contact hello@frameworkco.ca.

## 7. "Security": add
> Client-portal sign-in uses one-time email codes [and a second factor, if **[DECISION]** MFA is required]; each organization can see only its own information; sessions end
> automatically; and access is removed immediately when a person leaves an organization or asks us to.

## 8. "How long we keep information": add a portal item **[DECISION: periods below are proposals]**
> **Client portal accounts and access records:** for as long as you have access, and up to 24 months after your organization's access ends, so we can answer questions and show who had access.
> **Sign-in session records:** about 30 days after a session ends. **Security and audit records** (for example who invited or removed a person): up to 24 months after the
> relationship ends. **Sign-in provider records** are kept by WorkOS for the periods it sets. Records are reviewed and deleted manually, and copies in backups age out on the
> provider's schedule.

## 9. "Your choices": add
> Portal users can ask us (hello@frameworkco.ca) to see, correct or delete the information we hold about their portal account, or to remove their access. We will confirm your
> identity first. Removing access ends your portal sessions immediately.

## 10. Operational follow-ups (not website text)
* Add the portal data locations to `PRIVACY-OPERATIONS.md` (the deletion table): the portal database (`framework-portal`: users, memberships, invitations, sessions, activity), WorkOS users,
  Cloudflare Workers Logs, D1 Time Travel backups (cannot be deleted on demand; they age out).
* Deleting a person from the portal = `emergency-offboard.sql` (access) then, for erasure, a reviewed manual deletion of their portal user row only after the retention need has passed
  (foreign keys protect history); WorkOS erasure is done in the WorkOS dashboard.
* Breach handling: write who decides and who notifies (Alberta's PIPA expects notice to the Commissioner and to affected individuals where there is a real risk of significant harm).


## 10. Business Profile and portal feedback (added with the private-beta notice)
The Business Profile notice in the portal says only what the portal does today; it does not describe encryption, retention periods, legal bases, regulatory compliance or data
location. The published website policy (`privacy.html`) does not mention the client portal or the Business Profile at all, so it does not yet cover this processing. Gaps for review:
* **Collection:** Business Profile answers (legal and operating name, industry, description, location, size, products, customers, goals, competitors, websites and social links, contact
  name, role, email and phone, brand personality) saved per organization; and portal feedback messages (type, message text, the section the message is about, who sent it).
* **Purpose and access:** to plan and deliver services; authorized Framework staff can read the answers and the feedback; every member of the organization can read and edit the answers. **[DECISION]** whether to describe a staff-access rule.
* **Retention and deletion:** the website policy gives 24 months for assessment inquiries only. **[DECISION]** a retention period for Business Profile and portal feedback, and who performs deletion requests and how fast. Today deletion is handled by email to `hello@frameworkco.ca` and manual database work.
* **Consent:** no consent checkbox is used. **[DECISION]** whether your adviser wants explicit consent or an acknowledgement for Business Profile information.
* **Providers and location:** answers are stored in the Cloudflare D1 database used for the portal; WorkOS handles sign-in only. The existing wording about processing outside Canada should be confirmed to cover the portal.
* **Sensitive content:** clients may type anything in free-text boxes, including personal information about others. **[DECISION]** whether to add a "don't include sensitive personal information" line.
