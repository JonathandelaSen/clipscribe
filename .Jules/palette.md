## 2024-05-18 - Added aria-label to BackgroundTasksButton
**Learning:** Icon-only buttons using Lucide icons inside standard Shadcn UI components sometimes miss `aria-label` attributes out of the box, rendering them invisible to screen readers.
**Action:** Always check icon-only buttons for an accessible name. Added `aria-label` attribute to the dismiss button.