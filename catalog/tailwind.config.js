/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink:  { 950: '#08070c', 900: '#0d0c13', 800: '#16151f', 700: '#22212e', 600: '#33313f' },
        haze: { 400: '#8b87a3', 300: '#a9a5c0', 200: '#cbc8dc' },
        pop:  { DEFAULT: '#ff4d6d', soft: '#ff8fa3' },
        mint: '#5eead4',
        gold: '#fbbf24',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Inter', 'system-ui', 'sans-serif'],
      },
      spacing: {
        // Notch and home indicator. Used everywhere, so it lives here.
        'safe-t': 'env(safe-area-inset-top)',
        'safe-b': 'env(safe-area-inset-bottom)',
        'safe-l': 'env(safe-area-inset-left)',
        'safe-r': 'env(safe-area-inset-right)',
      },
      animation: { 'fade-in': 'fadeIn .35s ease both', 'rise': 'rise .3s cubic-bezier(.2,.9,.3,1) both' },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        rise:   { from: { transform: 'translateY(14px)', opacity: 0 }, to: { transform: 'none', opacity: 1 } },
      },
    },
  },
  plugins: [],
};
