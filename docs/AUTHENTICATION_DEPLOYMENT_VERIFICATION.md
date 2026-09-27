# Authentication deployment verification

Verified on 2026-09-15 against `https://mail.calibercode.io`.

## Deployment checks

- Production Worker version: `ad080a4a-872c-4e60-b0f6-d19410fa931e`.
- The signed-out `/login` route returned HTTP 200 and rendered the CC Mail email, password,
  forgot-password, and sign-in controls.
- An existing authenticated production session was accepted and reached `/inbox`.
- The unauthenticated MFA enrollment route redirected to `/login`.
- The unauthenticated MFA policy administration API returned HTTP 403.
- Chrome loaded the production application without a Safe Browsing interstitial.

## Google Safe Browsing

Google's public Safe Browsing Site Status tool reported **No unsafe content found** for
`mail.calibercode.io`. The diagnostic said its information was last updated on 2026-09-02.

Diagnostic:
`https://transparencyreport.google.com/safe-browsing/search?url=mail.calibercode.io`

## Search Console status

The Google account available during verification does not have a Search Console property for
`calibercode.io` or `mail.calibercode.io`; its property selector contains only an unrelated
domain. Consequently, the CC Mail Security Issues report is not yet available and must not be
reported as clear.

Remaining verification:

1. Add and verify the narrowly scoped URL-prefix property
   `https://mail.calibercode.io/` in Google Search Console.
2. Open **Security & Manual Actions > Security Issues** for that property.
3. If the report shows no issues, record the result and complete F1. Google documents the
   Security Issues report as the source of truth even when a browser warning cannot be
   reproduced.
4. If an issue is present, inspect every affected URL, fix the underlying issue, and request a
   review from the report. Do not request a review when no issue is listed.

References:

- `https://support.google.com/webmasters/answer/9044101`
- `https://safebrowsing.google.com/`

