# STEMORA workspace redesign

3 November 2026. Graphite surfaces, the existing lime identity, local Manrope and IBM Plex Sans Thai fonts, consistent controls and touch layouts across authentication, stem studio, cloud library, playlists, account and help.

The studio groups track input and output settings, with batch separation beside the heading. Recent jobs and cloud/playlist shortcuts replace promotional panels. On narrow screens saved playlists fold away so the composer is immediately accessible. Session handling, cloud quotas, worker leases, separation models and private download expiry are unchanged. Waiting messages stay short; progress only uses reported values.

## Magic UI

Vendored from the official registry, under MIT (license alongside components):

- [Blur Fade](https://magicui.design/docs/components/blur-fade), used for workspace headings and the authentication introduction. Adapted to honor reduced motion.
- [Border Beam](https://magicui.design/docs/components/border-beam), used on a selected track. Decorative and omitted when reduced motion is requested.

No effects block input or replay on progress updates. Font OFL licenses are included in `frontend/public/fonts`. Fonts are served locally.

## Validation

Production build, TypeScript, ESLint (one pre-existing hook warning), bilingual catalog consistency; browser review in TH/EN at desktop and 390 px. Isolated local synthesized music used to verify library analysis, playlist generation, mixer and navigation. Production rollout rebuilds only the frontend, preserves backend/container/settings and retains the prior frontend image/source for rollback.
