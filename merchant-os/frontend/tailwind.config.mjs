/** @type {import('tailwindcss').Config} */
const config = {
  darkMode: "class",
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        rail: {
          50: "#ecfffb",
          100: "#d4fdf5",
          200: "#a9f7e8",
          300: "#76ecd6",
          400: "#3dd8be",
          500: "#16c3aa",
          600: "#0c9d89",
          700: "#0a7f72",
          800: "#0c665d",
          900: "#0d554f"
        }
      },
      boxShadow: {
        panel: "0 1px 0 rgba(8, 37, 44, 0.04), 0 18px 38px rgba(8, 37, 44, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
