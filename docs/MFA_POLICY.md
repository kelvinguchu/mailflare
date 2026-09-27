# MFA policy

CC Mail supports three workspace modes: optional MFA, required MFA for administrators, and
required MFA for every active user. Migration `0048_add_mfa_policy.sql` installs the policy in
`optional` mode, so deploying the feature does not change access for existing accounts.

## Existing accounts and grace periods

When enforcement is enabled, each active covered account receives its own coverage timestamp.
Its deadline is that timestamp plus the configured grace period (0–30 days). Accounts that
already have verified MFA are compliant immediately. Pending invitations, disabled accounts,
revoked accounts, and archived accounts are not covered; activation, re-enablement, or promotion
starts a new coverage period when the policy applies.

During grace, the user retains normal access and sees an enrollment deadline. After the deadline,
the underlying server-side session remains valid only so `/api/auth/me`, `/api/settings/mfa`,
account recovery, and logout can work. Ordinary application APIs, API-key authentication, and new
realtime connections reject the account until MFA enrollment succeeds. Existing sessions are
evaluated on every authenticated request, so a session created before the deadline cannot bypass
enforcement indefinitely.

## Enrollment and recovery

Password sign-in for a restricted account redirects to `/enroll-mfa`. Starting enrollment requires
the current password. The authenticator secret is encrypted at rest and MFA is not marked enabled
until a valid TOTP is verified. Recovery codes are stored only as hashes and are single use.

Enabling an enforcing policy requires the acting administrator to have verified MFA and at least
one unused recovery code. A recently authenticated, MFA-enabled administrator can reset another
active managed account's lost authenticator. This action clears the credential and recovery codes,
revokes every session, starts coverage again under the current grace period, and writes an audit
record. Administrators cannot reset their own MFA through this route; self-recovery uses an
authenticator or recovery code. Password-reset and account-activation tokens remain independent of
policy enforcement.

## Exceptions

An administrator may grant another covered account a temporary exception for at most 30 days. An
expiry and reason are mandatory, self-exemption is rejected, and grant/revoke operations are
audited. An expired exception has no effect even if its database fields have not yet been cleared.
There is no permanent bypass.

## Operations

Configure and review policy coverage at `/security`. Policy changes require a recent-authentication
window. Audit actions are:

- `auth.mfa_policy_updated`
- `auth.mfa_policy_exception_granted`
- `auth.mfa_policy_exception_revoked`
- `auth.mfa_reset_by_administrator`

Backups created after this change use format v12. Formats v1–v11 remain restorable; older backups
restore with an empty policy table, which behaves as optional until an administrator saves a new
policy.
