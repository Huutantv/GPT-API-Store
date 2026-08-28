/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./*.html",
    "./public/**/*.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        primary: '#6366f1',
        dark: {
          900: '#0a0a0f',
          800: '#12121a',
          700: '#1a1a2e',
          600: '#252540'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif']
      },
      animation: {
        'float-orb': 'floatOrb 8s ease-in-out infinite',
        'gradient-shift': 'gradientShift 3s ease-in-out infinite',
        'badge-pulse': 'badgePulse 2s ease-in-out infinite',
      },
      keyframes: {
        floatOrb: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)', opacity: '0.5' },
          '25%': { transform: 'translate(30px, -20px) scale(1.1)', opacity: '0.7' },
          '50%': { transform: 'translate(-20px, -40px) scale(0.9)', opacity: '0.4' },
          '75%': { transform: 'translate(-30px, 10px) scale(1.05)', opacity: '0.6' },
        },
        gradientShift: {
          '0%, 100%': { backgroundPosition: '0% center' },
          '50%': { backgroundPosition: '100% center' },
        },
        badgePulse: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
        }
      }
    },
  },
  plugins: [],
}
