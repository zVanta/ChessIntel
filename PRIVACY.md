# Privacy Policy

*Last updated: 2026-08-17*

This product helps parents of junior chess players understand their child's
games. We treat child data as personal data and build with privacy-by-default
in mind.

## Data we collect

- A player's first name or nickname (optional).
- chess.com and/or Lichess usernames.
- Public game data fetched from those platforms, and/or photos of paper
  scoresheets you upload.
- Generated coach reports and analysis results.

We do **not** collect children's email addresses, and we never email minors.

## Legal basis & children's privacy

We follow COPPA (U.S.) and GDPR-K (EU) friendly defaults:

- **No analytics on child accounts.** We do not run third-party analytics,
  advertising trackers, or behavioral profiling for any player profile.
- **Per-player opt-in.** A player profile is only created when a parent or
  guardian explicitly adds it, and only the parent/guardian's account views it.
- **No email to minors.** We never request or store a child's email address.
- **Parental control.** A parent/guardian may delete a player profile and all
  associated reports at any time.

## Data minimization & storage

- Game data is fetched only when a report is requested, for the configured
  platform(s), and limited to a recent window (30 days, up to 50 games).
- Data is stored locally in a SQLite database at the path configured by
  `DATABASE_PATH`. No child data is sent to us by default.
- If you configure an OpenAI-compatible API key for report summaries, game
  summaries and OCR repair prompts are sent to that provider. Disable it by
  leaving `OPENAI_API_KEY` empty (deterministic summaries are used instead).

## Payments

Billing is handled by Stripe. The billing account belongs to the parent or
guardian, never the child. We store only a Stripe customer ID and subscription
status, not card details.

## Your rights

Contact the operator of your deployment to access, correct, export, or delete a
player profile and its reports. Deleting a player profile removes the child's
name, usernames, reports, and follow-up rows.

## Changes

This policy may be updated. Significant changes will be noted in the product.
