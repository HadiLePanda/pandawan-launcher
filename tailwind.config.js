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
          DEFAULT: '#0a0a0b',
          light: '#141415',
        },
        surface: {
          DEFAULT: '#1a1a1c',
          light: '#242426',
          hover: '#2a2a2c',
        },
        ink: {
          DEFAULT: '#fafafa',
          muted: '#a1a1a3',
          dim: '#6b6b6e',
        },
        accent: {
          DEFAULT: '#e85d3f',
          hover: '#f06b4d',
          muted: 'rgba(232, 93, 63, 0.15)',
        },
        border: {
          DEFAULT: 'rgba(255, 255, 255, 0.08)',
          strong: 'rgba(255, 255, 255, 0.15)',
        },
        status: {
          ready: '#22c55e',
          downloading: '#3b82f6',
          installing: '#a855f7',
          error: '#ef4444',
          updating: '#f59e0b',
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
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
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
