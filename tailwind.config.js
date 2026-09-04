/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // The dark canvas + large primary surfaces. We keep this cool/blue
        // so the warm orange accent has something to play against. It's
        // intentionally *not* the same as the accent — think of it as
        // "structural indigo", not "brand".
        brand: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        // The logo orange. The 500 step is sampled from the rendered logo
        // PNG. Use it for: active nav, current step, focus rings, status
        // dots, progress fills, the "this is the thing you're on" marks.
        // Never for large solid fills — small + glowing reads as premium,
        // big and flat reads as a banner ad.
        accent: {
          50:  '#fdf3ec',
          100: '#fae3d1',
          200: '#f5c8a4',
          300: '#eea578',
          400: '#e88a5b',
          500: '#e87848',  // ← logo
          600: '#d35f30',
          700: '#ad4a25',
          800: '#82381c',
          900: '#5b2815',
          950: '#321509',
        },
        // Neutral surface tokens that work for both themes. Tailwind's
        // gray-* is too cold; we want something with a touch of warmth
        // that pairs with the orange.
        ink: {
          50:  '#f7f6f4',
          100: '#eeece7',
          200: '#dcd8cf',
          300: '#b9b3a5',
          400: '#8c8576',
          500: '#5f5a4f',
          600: '#403d35',
          700: '#2a2823',
          800: '#1a1916',
          900: '#0f0e0c',
          950: '#08070a',
        },
        // Semantic surface tokens resolved per theme in styles.scss.
        // Components should reach for these instead of raw gray-* so
        // both modes get the right material.
        surface: {
          canvas:     'rgb(var(--surface-canvas) / <alpha-value>)',
          panel:      'rgb(var(--surface-panel) / <alpha-value>)',
          card:       'rgb(var(--surface-card) / <alpha-value>)',
          cardhover:  'rgb(var(--surface-cardhover) / <alpha-value>)',
          sunken:     'rgb(var(--surface-sunken) / <alpha-value>)',
          border:     'rgb(var(--surface-border) / <alpha-value>)',
          strong:     'rgb(var(--surface-strong) / <alpha-value>)',
          subtle:     'rgb(var(--surface-subtle) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans:  ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['Lora', 'Georgia', 'serif'],
        // Used for: model name, status codes, chapter numbers, file names.
        mono:  ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      // Multi-stop shadows that actually feel like depth in both modes.
      // `glow-accent` is the orange halo we drop on focus rings and the
      // current step; `glow-accent-lg` is the wider one for primary CTAs.
      boxShadow: {
        'card':   '0 1px 0 rgb(0 0 0 / 0.04), 0 1px 2px rgb(0 0 0 / 0.06), 0 4px 12px -2px rgb(0 0 0 / 0.04)',
        'card-lg':'0 1px 0 rgb(0 0 0 / 0.05), 0 4px 8px rgb(0 0 0 / 0.06), 0 16px 32px -8px rgb(0 0 0 / 0.08)',
        'inner-line': 'inset 0 1px 0 rgb(255 255 255 / 0.04)',
        'glow-accent':    '0 0 0 1px rgb(232 120 72 / 0.4), 0 0 18px 0 rgb(232 120 72 / 0.35)',
        'glow-accent-lg': '0 0 0 1px rgb(232 120 72 / 0.5), 0 0 32px 0 rgb(232 120 72 / 0.45), 0 8px 24px -8px rgb(232 120 72 / 0.5)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-in-left': 'slideInLeft 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'spin-slow': 'spin 2s linear infinite',
        'halo': 'halo 2.4s ease-in-out infinite',
        'sheen': 'sheen 2.5s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInLeft: {
          '0%': { opacity: '0', transform: 'translateX(-10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        // Soft expanding halo for the active step indicator. Less aggressive
        // than `animate-ping` — sits at ~20% opacity so it reads as ambient
        // glow, not a notification.
        halo: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(232 120 72 / 0.45)' },
          '50%':      { boxShadow: '0 0 0 10px rgb(232 120 72 / 0)' },
        },
        // Slow horizontal sheen for "live" elements like the progress bar.
        sheen: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      backgroundImage: {
        // Subtle grid that shows through in dark mode. 24px squares, hairline
        // strokes. Kept under content via mix-blend / low alpha.
        'grid-faint':  "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
        'grid-soft':   "linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)",
        // Aurora-style wash for the dark canvas hero. Anchored top-left so
        // the orange glow naturally echoes the logo's warm side.
        'aurora-dark': "radial-gradient(60% 50% at 12% 0%, rgb(232 120 72 / 0.12) 0%, transparent 70%), radial-gradient(50% 40% at 100% 8%, rgb(99 102 241 / 0.10) 0%, transparent 65%)",
        // Soft paper feel for the light canvas. Two layered radials of warm
        // cream — the whole app reads as "page" instead of "office".
        'paper-light': "radial-gradient(80% 60% at 50% -10%, rgb(232 120 72 / 0.05) 0%, transparent 60%), radial-gradient(60% 50% at 0% 100%, rgb(255 245 230 / 1) 0%, transparent 70%)",
      },
      backgroundSize: {
        'grid-24': '24px 24px',
        'grid-32': '32px 32px',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
};
