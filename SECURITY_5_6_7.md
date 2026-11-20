# WarehouseOS security hardening — controls 5, 6, 7
Updated: November 20, 2026

## 5. Abuse protection / Firebase App Check — requires Firebase console administrator
Status: **NOT activated**. Never enable enforcement until every production Firebase client has App Check initialized. The app uses Firebase Auth and Firestore from several HTML pages, not just index.html.

1. Open the Firebase console for project `put-away-log-cw` > Build > App Check.
2. Register the WarehouseOS web app using reCAPTCHA Enterprise. Authorize the actual production origin (`zaspdragon.github.io`) and any approved custom domain. The public site key is a configuration value, not a secret; never commit private keys/service-account credentials.
3. Add Firebase App Check SDK initialization to **every** page using Firestore, before its first database request, with the generated public reCAPTCHA Enterprise site key. Verify the SDK version matches Firebase compatibility scripts. Do not use a development debug token in production.
4. Leave Firestore enforcement **OFF** while watching App Check metrics for legitimate user sessions (PO Checking, receiving, lift-driver scanners, mobile camera, cycle counting, inventory corrections). Test all roles and devices.
5. Only after verified request metrics show the legitimate clients are supplying tokens, enable Cloud Firestore App Check enforcement in the Firebase console; monitor for denied legitimate requests. Have a rollback plan.
6. App Check is **not** a substitute for restrictive Firestore Security Rules or Firebase Auth; review each collection and role. Also review Firestore usage and Cloud Monitoring for unusual volume.

Official guidance:
- https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
- https://firebase.google.com/docs/app-check/monitor-metrics
- https://firebase.google.com/docs/app-check/enable-enforcement

## 6. Malicious-script protections — partly implemented
- A small CSP meta policy (`object-src 'none'; base-uri 'self'; upgrade-insecure-requests`) was added to the primary app and PO production page. This does **not** guarantee XSS protection, prevent clickjacking, or apply to other pages.
- A GitHub Actions workflow runs `scripts/security_audit.py` on pushes/PRs to review third-party script hosts, prevent HTTP scripts, and flag accidentally committed private-key headers.
- CDN host allowlisting by itself does not ensure packages are safe. Review and pin third-party scripts, add tested Subresource Integrity (SRI) where feasible, and audit `innerHTML` with untrusted data.
- This repository uses inline scripts and styles. A strict `script-src` CSP requires migrating inline code and testing all pages first; applying it immediately would likely break production.
- GitHub Pages does not let repository owners configure arbitrary HTTP response headers. Header-level CSP reporting, `frame-ancestors`, HSTS and anti-framing protections require a hosting layer that supports response headers. Do not claim a meta CSP provides them.
- Monitor the Actions tab to confirm the security checks actually run; a committed workflow is not proof of a passing build.
- A workflow is informational until branch protection rules require its check to pass. Configure repository rulesets after testing.

Reference: https://owasp.org/www-project-cheat-sheets/cheatsheets/Content_Security_Policy_Cheat_Sheet.html

## 7. Firestore backups — requires project administrator and billing approval
Status: **NOT scheduled**. No database backups have been created from this repository change.

Recommended:
1. In the Google Cloud / Firebase console for `put-away-log-cw`, inspect Firestore's backup feature, supported database, retention options, billing, and IAM permissions.
2. Obtain approval for ongoing cloud costs and choose daily scheduled Firestore backups with retention matching warehouse recovery needs. Weekly long-retention backups can supplement daily ones.
3. Confirm backup jobs complete successfully and alert the responsible admin on failures.
4. Run a documented restore drill into an isolated test database/project; verify `activityLogs`, `putAwayLogs`, and all other required warehouse collections and access rules.
5. Keep GitHub repo/branch protection and a separate copy of production configuration. A GitHub source-code copy is **not** a Firestore database backup.
6. Never export real employee/inventory data to the public GitHub repository. Do not place service-account keys in a browser or GitHub Pages source file.
7. Record backup owner, retention, storage location, restore authorization, monthly cost and last successful restore test.

Official guidance:
- https://firebase.google.com/docs/firestore/backups
- https://firebase.google.com/docs/firestore/manage-data/export-import
- https://firebase.google.com/docs/firestore/solutions/schedule-export

## Verification checklist
- [ ] GitHub Actions security check has run and passed.
- [ ] Inline JavaScript migration plan reviewed.
- [ ] Firebase App Check reCAPTCHA key provisioned and all app pages integrated.
- [ ] App Check metrics show legitimate requests and enforcement approved.
- [ ] Live Firestore rules reviewed in Firebase console; rules match intended role permissions.
- [ ] Scheduled backups enabled with explicit billing approval.
- [ ] At least one restoration drill completed in an isolated environment.
