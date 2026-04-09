## 2024-03-01 - Interactive Text Elements Keyboard Accessibility
**Learning:** Found an inline editable title (`<h3 onClick={...} title="Click to rename">`) that was functioning as a button but completely inaccessible to keyboard and screen reader users since `<h3>` is not natively focusable or interactive.
**Action:** When making non-interactive elements clickable (like headers or divs), always add `role="button"`, `tabIndex={0}`, an appropriate `aria-label`, a visible `focus-visible` ring, and an `onKeyDown` handler that triggers on "Enter" or "Space".
