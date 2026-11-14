# Rexnora visual identity and design system

This document is the source of truth for Rexnora's visual identity: premium, precise, modern and approachable.

## Visual identity

- **Brand:** Rexnora — *Intelligence in motion. Describe it. Build it. Run it.*
- **Primary:** Obsidian `#0B0F14`.
- **Surface:** Slate `#1A1F29`.
- **Borders:** Charcoal `#2A2F3A`.
- **Accents:** Royal Blue `#3B82F6` and Lavender `#8B5CF6`, used sparingly for focus, active states and selected highlights.
- **Text:** Ivory `#F8FAFC`; muted text `#94A3B8`.
- **Typography:** Inter for headings and UI; Geist for body text.
- **Shape language:** precise rounded corners, restrained borders, soft depth, generous spacing and strong hierarchy.
- **Logo:** silver geometric R mark in `public/rexnora-mark.svg`. Use the supplied SVG without recolouring.

## Product UI direction

- Marketing: immersive obsidian canvas, sculptural low-contrast geometry, ivory typography and restrained blue/lavender highlights.
- Workspace: near-black navigation, slate surfaces, charcoal dividers and clear blue focus/active states.
- Dashboard: meaningful metric cards, readable charts, clear workflow status badges, recent activity and quick actions.
- Visual workflow builder: spacious canvas, distinct trigger/action/condition nodes, clear connectors and obvious save/test/activate controls.
- AI assistant: readable conversation, explicit proposed steps, and review/approval before consequential actions.
- Mobile: adapt layouts and actions for narrow screens rather than merely shrinking desktop UI.

## Interaction principles

- Make the primary action obvious on every screen.
- Use blue for primary emphasis and focus; use lavender as a secondary accent, not a competing primary.
- Keep status colours semantic and accessible.
- Ensure keyboard navigation, visible focus rings, accessible contrast and reduced-motion support.
- Keep copy concise and professional. Avoid fake urgency, excessive gradients and visual clutter.
- Clearly label sample data and unavailable integrations. Never make a mock feature look live.

## Implementation rules

1. Reuse shared CSS tokens and components; do not invent a separate style for each page.
2. Build responsive layouts for desktop, tablet and mobile.
3. Preserve the approved palette, spacing, typography, border and status patterns.
4. The concept image is a visual north star, not a claim that every pictured feature is implemented.
5. Keep technical identifiers and database migration names stable during the visual rebrand; change user-facing brand surfaces without rewriting persisted data.
