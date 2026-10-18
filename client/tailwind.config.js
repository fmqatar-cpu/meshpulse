/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        mesh: {
          dark: '#0b0f19',
          card: '#111827',
          border: 'rgba(255, 255, 255, 0.08)'
        }
      }
    },
  },
  plugins: [],
}
