# Light Default On-Screen Keyboard Design

## Goal

Replace the panel application's custom dark alphanumeric keyboard with
react-simple-keyboard's maintained default keyboard layout, presented with a
light, Apple-inspired visual treatment.

## Scope

- Remove the handwritten default and shift layouts and their custom display
  labels.
- Let react-simple-keyboard render its built-in default layout. This supplies
  standard keys including Tab, Caps Lock, Shift, Backspace, punctuation,
  hyphen, equals, and space.
- Keep the existing numeric and IP layouts intact because their respective
  fields require deliberately restricted input.
- Keep the existing keyboard host, focus-retention behavior, close control,
  320 px reservation contract, and pointer handling intact.

## Visual Design

- The keyboard surface is a soft white or very light gray panel with a subtle
  cool-gray border and shadow; it contains no dark background.
- Individual keys are white or near-white, with soft rounded corners, a light
  border, and restrained shadowing that resembles an Apple on-screen keyboard.
- Function keys use a slightly darker neutral fill to distinguish them without
  introducing a dark theme. The close control follows the same light treatment.
- Controls retain the project minimum 44 px touch-target requirement.

## Behavior and Validation

- Default text fields display the library layout and preserve the library's
  Caps Lock / Shift behavior.
- Numeric and IP fields continue to expose only their existing permitted keys.
- Tests will assert the default-layout special keys and retain the existing
  input, focus transfer, close, and layout-restriction coverage.
- A rendered panel route with an on-screen keyboard will be checked at desktop
  and a practical compact viewport for light styling, key visibility, and
  interaction health.
