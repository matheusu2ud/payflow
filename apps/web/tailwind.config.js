/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        soft: '0 18px 45px -20px rgba(14, 165, 233, 0.35)',
      },
      colors: {
        brand: {
          500: '#22d3ee',
          600: '#06b6d4',
        },
      },
    },
  },
  plugins: [],
};
