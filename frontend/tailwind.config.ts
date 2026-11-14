import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Nunito", "system-ui", "sans-serif"],
        // Luckiest Guy рисует латиницу и цифры, кириллица падает в Rubik (см. .font-display в index.css)
        display: ['"Luckiest Guy"', "Rubik", "Nunito", "system-ui", "sans-serif"],
      },
      screens: { xs: "420px" },
      colors: {
        // Палитра макета AntiStall (Figma, страница back)
        ink: "#3B2422", rose: "#A0726D", peach: "#EAA695", blush: "#FFCEC2", paper: "#F6EFEC", mute: "#7D625E",
        cream: "#FFF4EF", lime: "#D9DE9F", olive: "#5E6B1F", line: "#CDB3AE", soft: "#EADCD8", petal: "#FCE3DB", cocoa: "#5A3833",
        // Готовые панели (игра, статистика, друзья) написаны на стандартных zinc / pink Tailwind:
        // эти две шкалы переопределены оттенками макета, чтобы всё приложение было в одной палитре.
        zinc: {
          50: "#FBF7F5", 100: "#F6EFEC", 200: "#EDE3DF", 300: "#DCCDC8", 400: "#B8A39E",
          500: "#7D625E", 600: "#6A514D", 700: "#563F3C", 800: "#46302D", 900: "#3B2422", 950: "#2A1817",
        },
        pink: {
          50: "#FFF4F0", 100: "#FFE5DD", 200: "#FFCEC2", 300: "#F3B6A7", 400: "#EAA695",
          500: "#DD8A76", 600: "#C46F5B", 700: "#A0726D", 800: "#7D4F45", 900: "#5A3430", 950: "#3B2422",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
