/** @type {import('tailwindcss').Config} */
const config = {
  darkMode: "class",
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        rail: {
          50: "#f2f6fb",
          100: "#e3ecf5",
          200: "#c6d7e8",
          300: "#9db8d2",
          400: "#7195b6",
          500: "#537999",
          600: "#405e79",
          700: "#2e4459",
          800: "#1e2e3f",
          900: "#141f2d"
        }
      },
      boxShadow: {
        panel: "0 1px 0 rgba(15,23,42,0.06), 0 26px 58px -30px rgba(15,23,42,0.34)"
      }
    }
  },
  plugins: []
};

export default config;
