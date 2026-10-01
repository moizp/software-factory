# UI Design System Skill

Reusable design system patterns and component specifications for consistent, accessible UIs.

## Color Palette

### Primary Colors
```
Primary Blue:    #2563EB (hover: #1D4ED8, active: #1E40AF)
Secondary:       #7C3AED
Success Green:   #10B981
Warning Orange:  #F59E0B
Danger Red:      #EF4444
```

### Neutral Colors
```
White:      #FFFFFF
50:         #F9FAFB
100:        #F3F4F6
200:        #E5E7EB
300:        #D1D5DB
400:        #9CA3AF
500:        #6B7280
600:        #4B5563
700:        #374151
800:        #1F2937
900:        #111827
Black:      #000000
```

## Typography

### Font Stack
```
Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif
```

### Scales
```
Display:  32px, 600 weight, 1.2 line-height
H1:       28px, 600 weight, 1.3 line-height
H2:       24px, 600 weight, 1.35 line-height
H3:       20px, 600 weight, 1.4 line-height
Body-lg:  18px, 400 weight, 1.6 line-height
Body:     16px, 400 weight, 1.5 line-height
Body-sm:  14px, 400 weight, 1.4 line-height
Caption:  12px, 400 weight, 1.4 line-height
```

## Spacing Scale

```
xs:   4px
sm:   8px
md:   16px
lg:   24px
xl:   32px
2xl:  48px
3xl:  64px
```

## Component Specs

### Button

```
States:     default, hover, active, disabled, loading
Variants:   primary, secondary, danger, ghost
Sizes:      sm (32px), md (40px), lg (48px)
```

**Primary Button:**
```
Default:  bg-primary, text-white, rounded-md, shadow-sm
Hover:    bg-primary-dark, shadow-md, cursor-pointer
Active:   bg-primary-darker, transform scale-95
Disabled: bg-neutral-300, text-neutral-500, cursor-not-allowed
```

### Input Field

```
States:     default, focus, error, disabled
Variant:    text, email, password, number
```

**Default:**
```
border: 1px solid neutral-300
padding: 8px 12px
border-radius: 6px
font-size: 16px
line-height: 1.5
```

**Focus:**
```
border: 2px solid primary
outline: none
box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1)
```

**Error:**
```
border: 2px solid danger
```

### Card

```
padding: 24px
background: white
border: 1px solid neutral-200
border-radius: 8px
box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1)
```

### Modal

```
Overlay:        rgba(0, 0, 0, 0.5), z-index: 1000
Modal:          white background, rounded-lg
Max Width:      500px (default)
Padding:        24px
Close Button:   top-right corner, X icon
Animation:      fade in 200ms
```

### Badge

```
Variants:   primary, success, warning, danger
Sizes:      sm (8px padding), md (12px padding)
Border Radius: full (9999px)
Font Size: 12px, weight: 500
```

### Dropdown

```
Trigger:        Button or input
Menu:           Absolute positioning, z-index: 100
Items:          Hover state: bg-neutral-100
Selected:       Check mark + primary color
Animation:      Fade in 100ms
```

## Layout Patterns

### Two-Column Layout (Sidebar + Content)

```
Sidebar:      250px fixed, bg-neutral-900, text-white
Content:      flex-1, padding: 24px
Header:       64px sticky, bg-white, border-bottom

On Mobile:    Drawer/hamburger menu
```

### Three-Column Layout (Dashboard)

```
Left Sidebar:     250px fixed
Main Content:     flex-1, padding: 24px
Right Panel:      300px (optional), scrollable
```

### Card Grid

```
Desktop:        3 columns, gap: 24px
Tablet:         2 columns, gap: 16px
Mobile:         1 column, gap: 12px
```

## Responsive Breakpoints

```
Mobile:         < 640px (full width, stacked)
Tablet:         640px - 1023px (2 columns)
Desktop:        1024px+ (3+ columns)
Large Desktop:  1400px+ (full width)
```

## Interaction Patterns

### Loading States

```
Spinner:        24px SVG, rotating, primary color
Skeleton:       Placeholder blocks, pulse animation 1.5s
Progress Bar:   Height 4px, animated stripes
```

### Empty States

```
Layout:         Centered, centered-column
Icon:           48px-64px, neutral-300 color
Heading:        Explain what's empty
Description:    Short reason + CTA
Button:         Primary action to fill state
```

### Error States

```
Inline:         Red border on field, error message below
Banner:         bg-danger-50, border-left danger color
Text:           danger-600 color, 12px font-size
Icon:           Exclamation mark or X
```

### Success States

```
Toast:          bg-success, text-white, auto-dismiss 5s
Icon:           Check mark, success-600 color
Message:        Concise success message
```

## Accessibility Requirements

### Color Contrast
```
Text on background:     4.5:1 ratio (WCAG AA)
Large text:             3:1 ratio
Icons:                  3:1 ratio
```

### Keyboard Navigation
```
Tab Order:              Logical flow
Focus Indicators:       Visible 2px outline
Skip Links:             Jump to main content
Keyboard Trap:          None (focus must escape)
```

### Semantic HTML
```
<button> for clickable elements
<a> for links
<label for="id"> for form fields
<nav> for navigation
<main> for main content
<article> for content blocks
```

### ARIA Labels
```
aria-label="Close modal"
aria-labelledby="heading-id"
aria-describedby="description-id"
aria-expanded="true|false"
aria-disabled="true|false"
role="alert" for error messages
```

## Animation Specifications

### Transitions
```
Default:        150ms cubic-bezier(0.4, 0, 0.2, 1)
Slow:           300ms cubic-bezier(0.4, 0, 0.2, 1)
Fast:           100ms cubic-bezier(0.4, 0, 0.2, 1)
```

### Motion Patterns
```
Fade In:        opacity 0 → 1
Scale:          transform scale(0.95) → 1
Slide Up:       transform translateY(20px) → 0
Slide Left:     transform translateX(-100%) → 0
```

### Micro-Interactions
```
Button Press:   scale(0.95), immediate feedback
Hover Scale:    scale(1.05), ease-in-out
Icon Rotate:    rotate(180deg), 300ms
Loading Spin:   rotate(360deg), infinite 1s
```

## Dark Mode

```
Background:     neutral-900
Surface:        neutral-800
Border:         neutral-700
Text Primary:   neutral-100
Text Secondary: neutral-400
```

## Component Library Setup

### Tailwind Config
```javascript
module.exports = {
  theme: {
    colors: {
      primary: '#2563EB',
      secondary: '#7C3AED',
      // ... rest of palette
    },
    spacing: {
      xs: '4px',
      sm: '8px',
      // ... rest of scale
    },
    borderRadius: {
      sm: '4px',
      md: '6px',
      lg: '8px',
      xl: '12px',
      full: '9999px'
    }
  }
}
```

### Component Export
```typescript
// src/components/index.ts
export { Button } from './Button'
export { Input } from './Input'
export { Card } from './Card'
export { Modal } from './Modal'
export { Badge } from './Badge'
// ... all components
```

## Design Tokens as CSS Variables

```css
:root {
  --color-primary: #2563eb;
  --color-secondary: #7c3aed;
  --color-success: #10b981;
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --typography-body-size: 16px;
  --typography-body-weight: 400;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
  --transition-default: 150ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

## Component Testing Checklist

For each component:
- [ ] Renders all variants
- [ ] Responds to all props
- [ ] Handles all states (default, hover, active, disabled)
- [ ] Keyboard accessible (Tab, Enter, Escape)
- [ ] Screen reader compatible (semantic HTML + ARIA)
- [ ] Responsive (mobile, tablet, desktop)
- [ ] High contrast mode (Windows)
- [ ] Reduced motion respected (prefers-reduced-motion)
