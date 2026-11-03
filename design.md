# Design: Clean Up

Clean Up is a desktop workspace for observing and maintaining local development tools. Its UI uses Hallmark Hum across every page.

## System

- Genre: playful, adapted to app screens.
- Shape: an app shell with nine destinations and task-specific tables, lists and forms.
- Theme: Hum, by request.
- Axes: light paper, rounded sans, chromatic yellow; restrained functional colour within the Hum palette.
- Signature: the real enabled-manager inventory, presented as readable paper controls.
- Content: existing facts, labels, safety notices and handlers remain authoritative. No sample metrics or imagery in the application.

## Tokens

[src/tokens.css](src/tokens.css) is the source of truth. Hum colour roles use the `--hum-*` namespace, mapped to the project's existing shadcn semantic tokens. This avoids conflicts between theme colours and Tailwind aliases.

- Ground: cream paper, `oklch(97% 0.012 95)`.
- Raised surface: card stock, `oklch(98.8% 0.007 95)`.
- Ink: blue black, `oklch(20% 0.014 255)`.
- Primary action: pear yellow, `oklch(87% 0.175 96)` with blue black text.
- Links and focus: blue, `oklch(50% 0.17 250)`.
- Success: mint; caution: pear; errors and destructive actions: coral with readable paired text.
- Type: locally bundled Chillax 500 and 600 with Chinese system sans fallbacks; JetBrains Mono for code only.
- Type scale: 16px body, 14px labels, 19.2px section titles, 27.648px page titles; fixed app scale.
- Radius: 24px paper panels, 16px stock controls, 14px inputs, fully rounded badges.
- Spacing: shared 4px scale; 24px page rhythm; one centred workspace capped at 1600px.
- Texture: subtle deterministic SVG paper grain on the shell and selected stock surfaces, with no animated decoration.

## Controls

- Primary: pear stock, 16px radius, 40px app height, solid lower edge and a short press response.
- Secondary: paper stock; blue links; selected tabs use ink with paper text.
- Fields: neutral paper, 14px radius, visible border, immediate blue focus outline.
- Lists and tables: aligned data, separate headings, horizontal scrolling confined to tables.
- States: retain existing loading, empty, failed and populated states and confirmations.

## Motion

Motion communicates interaction. The primary action has a short spring press; other controls use the snap easing. No load reveal, layout animation or scale effect. Reduced motion disables movement. Focus appears immediately.

## Variants

Dark mode uses blue black paper with lighter stock surfaces, warm ink and the same pear action. Below 960px the sidebar becomes a 44px navigation disclosure showing the current destination; it closes after selection or Escape and returns focus to its trigger. Manager subnavigation becomes a horizontal rail. The phone overview puts scan totals before the inventory, while desktop keeps the inventory-led composition.

## Exports

[src/tokens.css](src/tokens.css), [src/base.css](src/base.css), and [src/styles.css](src/styles.css). Shared components keep the existing React, Radix and shadcn APIs.
