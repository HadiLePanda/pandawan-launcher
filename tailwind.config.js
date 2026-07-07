/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        canvas: {
          DEFAULT: 'var(--canvas-default)',
          light: 'var(--canvas-light)',
          elevated: 'var(--canvas-elevated)',
        },
        surface: {
          DEFAULT: 'var(--surface-default)',
          light: 'var(--surface-light)',
          hover: 'var(--surface-hover)',
          elevated: 'var(--surface-elevated)',
        },
        ink: {
          DEFAULT: 'var(--ink-default)',
          muted: 'var(--ink-muted)',
          dim: 'var(--ink-dim)',
          subtle: 'var(--ink-subtle)',
        },
        // Primary CTA — Bamboo Green (Install, Play, Launch, Confirm)
        action: {
          DEFAULT: 'var(--action)',
          hover: 'var(--action-hover)',
          light: 'var(--action-light)',
          muted: 'var(--action-muted)',
          glow: 'var(--action-glow)',
        },
        // Secondary Accent — Forge Gold (selections, highlights, badges)
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          light: 'var(--accent-light)',
          muted: 'var(--accent-muted)',
          glow: 'var(--accent-glow)',
        },
        // Tertiary Semantic — Ember (errors only)
        ember: {
          DEFAULT: 'var(--ember)',
          muted: 'var(--ember-muted)',
        },
        border: {
          DEFAULT: 'var(--border-default)',
          strong: 'var(--border-strong)',
          accent: 'var(--border-accent)',
          action: 'var(--border-action)',
        },
        status: {
          ready: '#4a7a52',         // Bamboo — installed & ready
          downloading: '#c8a84b',   // Forge Gold — in progress
          installing: '#d4b55e',    // Gold shimmer — processing
          updating: '#5a8f62',      // Bamboo light — updating
          error: '#9b1f2e',         // Ember — something's wrong
        },
        // Gradient backgrounds
        gradient: {
          canvas: 'linear-gradient(180deg, var(--canvas-default) 0%, var(--canvas-elevated) 100%)',
          surface: 'linear-gradient(180deg, var(--surface-default) 0%, var(--canvas-elevated) 100%)',
          glow: 'radial-gradient(ellipse at top, var(--accent-muted) 0%, transparent 50%)',
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(232, 93, 63, 0.2)' },
          '50%': { boxShadow: '0 0 30px rgba(232, 93, 63, 0.4)' },
        },
      },
      boxShadow: {
        'premium': '0 4px 20px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(200, 168, 75, 0.06)',
        'premium-lg': '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(200, 168, 75, 0.1)',
        'glow': '0 0 20px rgba(200, 168, 75, 0.25)',
        'glow-lg': '0 0 40px rgba(200, 168, 75, 0.35)',
      },
    },
  },
  plugins: [],
}
