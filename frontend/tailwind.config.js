/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep charcoal / midnight surfaces
        base: {
          950: '#0a0d12',
          900: '#0f141b',
          850: '#141a23',
          800: '#1a212c',
          750: '#202936',
          700: '#283341',
          600: '#364454',
          500: '#4a5a6e',
        },
        // Restrained Ukrainian blue accent
        ukon: {
          DEFAULT: '#3b82c4',
          50: '#eef4fb',
          100: '#d6e6f5',
          200: '#a9c8e6',
          300: '#7aaad6',
          400: '#5190c4',
          500: '#3b82c4',
          600: '#2e6aa8',
          700: '#275788',
          800: '#22496f',
          900: '#1e3d5c',
        },
        // Restrained Ukrainian yellow accent
        ukyellow: {
          DEFAULT: '#ffd24a',
          50: '#fff9e6',
          100: '#fff1bf',
          200: '#ffe588',
          300: '#ffd24a',
          400: '#f5b821',
          500: '#d99b0f',
          600: '#a8730a',
        },
        success: {
          DEFAULT: '#3fb98a',
          600: '#2e9570',
        },
        warning: {
          DEFAULT: '#e0a73a',
        },
        danger: {
          DEFAULT: '#e0584a',
          600: '#c0453a',
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '6px',
      },
      boxShadow: {
        surface: '0 1px 2px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.02)',
        elevated: '0 8px 24px -8px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        'spin-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'progress': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
        'spin-slow': 'spin-slow 1.4s linear infinite',
        'progress': 'progress 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
