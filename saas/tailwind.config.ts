import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#060d1a',
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
          600: '#475569',
        },
        gold: {
          300: '#f0d595',
          400: '#dbb96a',
          500: '#c9a961',
          600: '#b8922f',
          700: '#9a7a24',
          950: '#1a1206',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      animation: {
        'glow-gold': 'glow-gold 2s ease-in-out infinite alternate',
        'shimmer': 'shimmer 3s linear infinite',
        'float': 'float 3s ease-in-out infinite',
      },
      keyframes: {
        'glow-gold': {
          '0%': {
            boxShadow:
              '0 0 8px rgba(201,169,97,0.2), 0 0 16px rgba(201,169,97,0.08)',
          },
          '100%': {
            boxShadow:
              '0 0 24px rgba(201,169,97,0.55), 0 0 48px rgba(201,169,97,0.28), 0 0 96px rgba(201,169,97,0.12)',
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
        'gold-radial': 'radial-gradient(ellipse at top, rgba(201,169,97,0.08) 0%, transparent 60%)',
      },
    },
  },
  plugins: [],
}

export default config
