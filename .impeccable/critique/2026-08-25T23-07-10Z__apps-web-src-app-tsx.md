---
target: apps/web
total_score: 19
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 4
timestamp: 2026-08-25T23-07-10Z
slug: apps-web-src-app-tsx
---

# Critique: apps/web (Leave OS)

Method: degraded single-context (prior dual-agent tasks lost; detector + source review completed in-session)

## Heuristics

1 Visibility 2 · 2 Real world 3 · 3 Control 2 · 4 Consistency 1 · 5 Prevention 2
6 Recognition 2 · 7 Flexibility 1 · 8 Aesthetic 2 · 9 Recovery 2 · 10 Help 2
Total 19/40

## Priority issues

P1 Inline styles and per-page CSS instead of tokens
P1 Loading/empty/error states missing (spinner text)
P1 Reject used window.prompt; notifications labelled "N"
P1 No Lucide icons; status colour-only
P2 Mobile drawer without overlay; 36px controls
P2 Dates as ISO; glass header (banned)

## Post-pass

Shared product.css, Lucide, skeletons, reject drawer, date format, overlay nav.
