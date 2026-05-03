## 2024-05-24 - Add ARIA Labels to icon-only buttons
**Learning:** Found some `<Button variant="ghost" size="icon">` and similar patterns throughout the codebase that lacked `aria-label`s. This is a common accessibility issue for icon-only buttons.
**Action:** Always verify if an icon-only button has a descriptive `aria-label` or text alternative.
