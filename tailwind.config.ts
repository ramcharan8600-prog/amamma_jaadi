import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          maroon: '#7B1F1F',
          'maroon-dark': '#5A1515',
          gold: '#C6992E',
          'gold-light': '#E8C868',
          cream: '#FFF8F0',
          'cream-dark': '#F5EDE0',
          green: '#1B4332',
          charcoal: '#2D2926',
          'warm-white': '#FEFCF8',
        },
      },
      fontFamily: {
        display: ['Playfair Display', 'Georgia', 'serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
