import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
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
      colors: {
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        sidebar: {
          DEFAULT: "var(--sidebar)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
        // Solar Dusk 브랜드 토큰
        ok: {
          orange: "var(--ok-orange)",
          "orange-600": "var(--ok-orange-600)",
          "orange-700": "var(--ok-orange-700)",
          "orange-50": "var(--ok-orange-50)",
          "orange-100": "var(--ok-orange-100)",
          "orange-200": "var(--ok-orange-200)",
          brown: "var(--ok-brown)",
          "brown-700": "var(--ok-brown-700)",
          yellow: "var(--ok-yellow)",
          "yellow-300": "var(--ok-yellow-300)",
          "yellow-50": "var(--ok-yellow-50)",
        },
        neutral: {
          0: "var(--n-0)",
          25: "var(--n-25)",
          50: "var(--n-50)",
          100: "var(--n-100)",
          200: "var(--n-200)",
          300: "var(--n-300)",
          400: "var(--n-400)",
          500: "var(--n-500)",
          600: "var(--n-600)",
          700: "var(--n-700)",
          800: "var(--n-800)",
          900: "var(--n-900)",
        },
        success: {
          DEFAULT: "var(--success)",
          bg: "var(--success-bg)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          bg: "var(--warning-bg)",
        },
        danger: {
          DEFAULT: "var(--danger)",
          bg: "var(--danger-bg)",
        },
        info: {
          DEFAULT: "var(--info)",
          bg: "var(--info-bg)",
        },
        // 레거시 호환 (Phase 5 에서 제거)
        "ok-orange": "var(--ok-orange)",
        "ok-dark-brown": "var(--ok-brown)",
        "ok-yellow": "var(--ok-yellow)",
        "ok-bright-gray": "var(--muted)",
        "ok-gold": "var(--ok-yellow)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        // Semantic tokens (use these for headings/body text)
        display: ["clamp(30px, 30px + 0.80vw, 48px)", { lineHeight: "1.2", fontWeight: "800", letterSpacing: "-0.03em" }],
        h1: ["clamp(24px, 24px + 0.50vw, 34px)", { lineHeight: "1.25", fontWeight: "800", letterSpacing: "-0.02em" }],
        h2: ["clamp(20px, 20px + 0.35vw, 26px)", { lineHeight: "1.3", fontWeight: "700", letterSpacing: "-0.02em" }],
        h3: ["clamp(17px, 17px + 0.28vw, 21px)", { lineHeight: "1.35", fontWeight: "700" }],
        h4: ["clamp(15px, 15px + 0.22vw, 18px)", { lineHeight: "1.4", fontWeight: "600" }],
        body: ["clamp(13px, 13px + 0.15vw, 15px)", { lineHeight: "1.55" }],
        micro: ["clamp(10px, 10px + 0.10vw, 12px)", { lineHeight: "1.45" }],
        // Tailwind default scale, clamp-ified for responsive type
        "2xs": ["clamp(9px,  9px  + 0.08vw, 11px)", { lineHeight: "1.4" }],
        xs:   ["clamp(11px, 11px + 0.12vw, 13px)", { lineHeight: "1.5" }],
        sm:   ["clamp(12px, 12px + 0.13vw, 14px)", { lineHeight: "1.55" }],
        base: ["clamp(13px, 13px + 0.15vw, 15px)", { lineHeight: "1.55" }],
        lg:   ["clamp(15px, 15px + 0.22vw, 18px)", { lineHeight: "1.5" }],
        xl:   ["clamp(17px, 17px + 0.28vw, 21px)", { lineHeight: "1.45" }],
        "2xl":["clamp(20px, 20px + 0.35vw, 26px)", { lineHeight: "1.35" }],
        "3xl":["clamp(24px, 24px + 0.50vw, 34px)", { lineHeight: "1.25" }],
        "4xl":["clamp(30px, 30px + 0.80vw, 48px)", { lineHeight: "1.2" }],
      },
      borderRadius: {
        lg: "var(--r-lg)",
        md: "var(--r-md)",
        sm: "var(--r-sm)",
        xs: "var(--r-xs)",
        xl: "var(--r-xl)",
        pill: "var(--r-pill)",
      },
      boxShadow: {
        "sh-sm": "var(--sh-sm)",
        "sh-md": "var(--sh-md)",
        "sh-lg": "var(--sh-lg)",
        "sh-focus": "var(--sh-focus)",
      },
      spacing: {
        sidebar: "var(--sidebar-w)",
        "sidebar-collapsed": "var(--sidebar-w-collapsed)",
        topbar: "var(--topbar-h)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in-up": {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "zoom-in": {
          "0%": { transform: "scale(0.97)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        // 로그인 히어로 aurora-background (docs/aurora-background-설치정의서.md §4)
        aurora: {
          from: { backgroundPosition: "50% 50%, 50% 50%" },
          to: { backgroundPosition: "350% 50%, 350% 50%" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in-up": "fade-in-up 0.45s cubic-bezier(0.16, 1, 0.3, 1)",
        "zoom-in": "zoom-in 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        // 주기(60s) 변경 시 aurora-background.tsx 의 AURORA_CYCLE_SECONDS 도 동기화할 것
        aurora: "aurora 60s linear infinite",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
