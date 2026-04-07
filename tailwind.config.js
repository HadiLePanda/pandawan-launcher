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
        // Premium dark theme with subtle blue-gray warmth
        canvas: {
          DEFAULT: '#0d1117',           // Deep blue-gray (not pure black)
          light: '#161b22',             // Slightly lighter for contrast
          elevated: '#1c2128',          // For elevated surfaces
        },
        surface: {
          DEFAULT: '#21262d',           // Primary surface with subtle depth
          light: '#30363d',             // Hover/active states
          hover: '#3d444d',             // Interactive hover
          elevated: 'rgba(48, 54, 61, 0.6)', // Glass effect base
        },
        ink: {
          DEFAULT: '#f0f6fc',           // Primary text - slightly warm white
          muted: '#8b949e',             // Secondary text
          dim: '#6e7681',               // Tertiary text
          subtle: '#484f58',            // Very subtle text
        },
        accent: {
          DEFAULT: '#e85d3f',           // Keep the orange but enhance usage
          hover: '#f06b4d',             // Brighter on hover
          light: '#ff7a5c',             // Light variant
          muted: 'rgba(232, 93, 63, 0.12)', // Subtle background
          glow: 'rgba(232, 93, 63, 0.4)', // Glow effect
        },
        border: {
          DEFAULT: 'rgba(240, 246, 252, 0.08)',  // Subtle borders
          strong: 'rgba(240, 246, 252, 0.15)',   // Stronger borders
          accent: 'rgba(232, 93, 63, 0.3)',      // Accent-tinted borders
        },
        status: {
          ready: '#3fb950',             // Vibrant green
          downloading: '#58a6ff',       // Bright blue
          installing: '#a371f7',        // Soft purple
          error: '#f85149',             // Soft red
          updating: '#d29922',          // Warm amber
        },
        // Gradient backgrounds
        gradient: {
          canvas: 'linear-gradient(180deg, #0d1117 0%, #0a0c10 100%)',
          surface: 'linear-gradient(180deg, #21262d 0%, #1c2128 100%)',
          glow: 'radial-gradient(ellipse at top, rgba(232, 93, 63, 0.08) 0%, transparent 50%)',
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
        'premium': '0 4px 20px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        'premium-lg': '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        'glow': '0 0 20px rgba(232, 93, 63, 0.3)',
        'glow-lg': '0 0 40px rgba(232, 93, 63, 0.4)',
      },
    },
  },
  plugins: [],
}
