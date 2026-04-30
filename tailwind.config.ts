import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Background scale — matches multivenzadigital.com exactly
        navy: {
          950: '#080D14',
          900: '#0D1420',
          800: '#111B2A',
          700: '#1a2535',
          600: '#243044',
        },
        // Primary accent: cyan (#00D4E8) replaces legacy gold
        // Keeping "gold" key so all existing components rebrand automatically
        gold: {
          300: '#7ee8f0',
          400: '#00D4E8',   // main brand cyan
          500: '#00B8CA',
          600: '#00A3AD',   // dark cyan — used in logo "Multi"
          700: '#008a93',
          950: '#011820',
        },
        // Brand blue
        blue: {
          brand: '#2563EB',
          dark:  '#1D4ED8',
        },
        // Logo orange — "Venza"
        orange: {
          brand: '#FF8200',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      animation: {
        'glow-gold':  'glow-cyan 2s ease-in-out infinite alternate',
        'shimmer':    'shimmer 3s linear infinite',
        'float':      'float 3s ease-in-out infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4,0,0.6,1) infinite',
      },
      keyframes: {
        'glow-cyan': {
          '0%': {
            boxShadow:
              '0 0 8px rgba(0,212,232,0.2), 0 0 16px rgba(0,212,232,0.08)',
          },
          '100%': {
            boxShadow:
              '0 0 24px rgba(0,212,232,0.55), 0 0 48px rgba(0,212,232,0.28), 0 0 96px rgba(37,99,235,0.12)',
          },
        },
        shimmer: {
          '0%':   { transform: 'translateX(-150%)' },
          '100%': { transform: 'translateX(150%)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-4px)' },
        },
      },
      backgroundImage: {
        'gold-radial':  'radial-gradient(ellipse at top, rgba(0,212,232,0.08) 0%, transparent 60%)',
        'cyan-radial':  'radial-gradient(ellipse at top, rgba(0,212,232,0.08) 0%, transparent 60%)',
        'grad-hero':    'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(0,212,232,0.15) 0%, transparent 70%)',
        'grad-btn':     'linear-gradient(135deg, #00D4E8 0%, #2563EB 100%)',
        'grid-dots':    'linear-gradient(rgba(0,212,232,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,232,0.04) 1px, transparent 1px)',
      },
    },
  },
  plugins: [],
}

export default config
