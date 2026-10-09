import { defineConfig, presetUno, presetTypography, transformerDirectives } from 'unocss'

export default defineConfig({
  presets: [
    presetUno(),
    presetTypography()
  ],
  transformers: [transformerDirectives()],
  theme: {
    colors: {
      // NAVALIVAY brand colors
      brand: {
        primary: '#d32f2f',    // красный акцент
        dark: '#1a1a1a',       // темно-серый основной
        gray: '#6b6b6b',       // серый для карточек
        lightGray: '#c0c0c0',  // светло-серый для текста
        bgGray: '#e8e8e8',     // фоновый серый
        white: '#f0f0f0',      // не чисто белый
        red: '#d32f2f',        // основной красный
        redDark: '#c62828',    // темно-красный
        redLight: '#ef5350',   // светло-красный
        burgundy: '#3d1f1f',   // бордовый для текста
        black: '#1a1a1a'       // темно-серый вместо черного
      },
      // Telegram theme colors (will be overridden by CSS variables)
      tg: {
        bg: 'var(--tg-bg-color, #ffffff)',
        text: 'var(--tg-text-color, #000000)',
        hint: 'var(--tg-hint-color, #999999)',
        link: 'var(--tg-link-color, #3390ec)',
        button: 'var(--tg-button-color, #3390ec)',
        buttonText: 'var(--tg-button-text-color, #ffffff)'
      }
    },
    fontFamily: {
      // NAVALIVAY Typography System
      'primary': ['Roboto', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      'display': ['Bebas Neue', 'Impact', 'Arial Black', 'system-ui', 'sans-serif'],
      'accent': ['Bebas Neue', 'Roboto', 'sans-serif'],
      // Fallbacks
      'sans': ['Roboto', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      'mono': ['Menlo', 'Monaco', 'Consolas', 'monospace']
    },
    fontSize: {
      'xs': ['0.75rem', '1rem'],
      'sm': ['0.875rem', '1.25rem'],
      'base': ['1rem', '1.5rem'],
      'lg': ['1.125rem', '1.75rem'],
      'xl': ['1.25rem', '1.875rem'],
      '2xl': ['1.5rem', '2rem'],
      '3xl': ['1.875rem', '2.25rem'],
      '4xl': ['2.25rem', '2.75rem']
    },
    spacing: {
      'safe-top': 'env(safe-area-inset-top)',
      'safe-bottom': 'env(safe-area-inset-bottom)',
      'safe-left': 'env(safe-area-inset-left)',
      'safe-right': 'env(safe-area-inset-right)',
      // Telegram safe area insets
      'tg-safe-top': 'var(--tg-safe-area-inset-top, env(safe-area-inset-top, 0))',
      'tg-safe-bottom': 'var(--tg-safe-area-inset-bottom, env(safe-area-inset-bottom, 0))',
      'tg-safe-left': 'var(--tg-safe-area-inset-left, env(safe-area-inset-left, 0))',
      'tg-safe-right': 'var(--tg-safe-area-inset-right, env(safe-area-inset-right, 0))'
    },
    aspectRatio: {
      'banner': '12/5',      // баннеры 12:5
      'product': '3/4',      // карточки товаров 3:4  
      'square': '1/1'
    },
    animation: {
      'fade-in': 'fade-in 0.3s ease-out',
      'slide-up': 'slide-up 0.3s ease-out',
      'skeleton': 'skeleton 1s ease-in-out infinite alternate'
    },
    keyframes: {
      'fade-in': {
        '0%': { opacity: '0' },
        '100%': { opacity: '1' }
      },
      'slide-up': {
        '0%': { transform: 'translateY(20px)', opacity: '0' },
        '100%': { transform: 'translateY(0)', opacity: '1' }
      },
      'skeleton': {
        '0%': { opacity: '0.4' },
        '100%': { opacity: '1' }
      }
    }
  },
  shortcuts: {
    // Layout shortcuts
    'container-safe': 'mx-auto px-4 max-w-7xl',
    'flex-center': 'flex items-center justify-center',
    'flex-between': 'flex items-center justify-between',
    
    // Button variants (brutal style: жесткие, контрастные)
    'btn-base': 'px-6 py-3 font-bold uppercase tracking-widest transition-all duration-300 active:translate-x-0.5 active:translate-y-0.5',
    'btn-primary': 'btn-base bg-brand-dark text-brand-white shadow-[8px_8px_0_rgba(26,26,26,0.3)] hover:shadow-[12px_12px_0_rgba(211,47,47,0.4)] hover:-translate-x-1 hover:-translate-y-1',
    'btn-secondary': 'btn-base bg-brand-red text-white shadow-[8px_8px_0_rgba(26,26,26,0.3)] hover:shadow-[12px_12px_0_rgba(26,26,26,0.5)] hover:-translate-x-1 hover:-translate-y-1',
    'btn-ghost': 'btn-base bg-transparent text-brand-dark border-4 border-brand-dark hover:bg-brand-red hover:text-white hover:border-brand-dark',

    // Filter chip buttons (brutal style)
    'chip': 'inline-flex items-center gap-2 px-4 py-2 border-4 text-sm font-bold uppercase tracking-wide transition-all duration-200 focus:(outline-none ring-2 ring-brand-red/30) active:scale-95',
    'chip-active': 'bg-brand-red text-white border-brand-dark shadow-[4px_4px_0_rgba(26,26,26,0.3)]',
    'chip-inactive': 'bg-brand-white text-brand-dark border-brand-dark hover:(bg-brand-red text-white)',
    
    // Card styles (brutal бордеры)
    'card-base': 'bg-brand-white border-4 border-brand-dark shadow-[8px_8px_0_rgba(26,26,26,0.3)]',
    'card-hover': 'card-base hover:shadow-[12px_12px_0_rgba(211,47,47,0.4)] hover:-translate-x-1 hover:-translate-y-1 transition-all duration-300',
    
    // Product card (квадратнее, плотнее)
    'product-card': 'card-hover overflow-hidden aspect-[1/1]',
    'product-image': 'w-full h-full object-cover',
    
    // Badges (brutal style)
    'badge': 'inline-flex items-center px-3 py-1.5 text-xs font-black uppercase tracking-widest',
    'badge-new': 'badge bg-brand-red text-white clip-path-polygon-[0_0,100%_0,90%_100%,0%_100%]',

    // Skeleton loading
    'skeleton-base': 'bg-gray-300 animate-pulse rounded',
    
    // Telegram safe area (обновленные с поддержкой Telegram safe area insets)
    'safe-area': 'pb-safe-bottom pt-safe-top pl-safe-left pr-safe-right',
    'tg-safe-area': 'pb-tg-safe-bottom pt-tg-safe-top pl-tg-safe-left pr-tg-safe-right',
    
    // NAVALIVAY Typography Shortcuts
    'text-brand-primary': 'font-primary text-brand-burgundy',
    'text-brand-display': 'font-display text-brand-burgundy font-black uppercase tracking-widest',
    'text-brand-accent': 'font-accent text-brand-red font-black uppercase tracking-widest',
    'text-brand-price': 'font-primary text-brand-red font-black tabular-nums text-xl',
    
    // Product card typography
    'product-title': 'font-primary text-base font-medium text-white leading-tight',
    'product-price': 'font-primary text-xl font-black text-brand-red tabular-nums',
    'product-category': 'font-primary text-sm text-brand-lightGray uppercase tracking-widest',
    
    // UI element typography
    'button-text': 'font-display font-black uppercase tracking-widest',
    'section-header': 'font-display text-lg font-black text-brand-burgundy uppercase tracking-widest',
    'admin-title': 'font-display text-2xl font-black text-brand-burgundy uppercase tracking-widest',
    
    // Responsive typography
    'heading-mobile': 'font-display text-2xl font-medium leading-tight',
    'heading-large': 'font-display text-3xl font-medium leading-tight',
    'body-mobile': 'font-primary text-base leading-relaxed',
    'caption-mobile': 'font-primary text-sm leading-normal'
  },
  rules: [
    // Custom scale values
    ['scale-102', { transform: 'scale(1.02)' }],
    
    // Custom backdrop blur
    ['backdrop-blur-telegram', { 'backdrop-filter': 'blur(20px)' }],
    
    // Telegram-specific rules
    ['tg-safe-area', {
      'padding-top': 'var(--tg-safe-area-inset-top, env(safe-area-inset-top, 0))',
      'padding-bottom': 'var(--tg-safe-area-inset-bottom, env(safe-area-inset-bottom, 0))',
      'padding-left': 'var(--tg-safe-area-inset-left, env(safe-area-inset-left, 0))',
      'padding-right': 'var(--tg-safe-area-inset-right, env(safe-area-inset-right, 0))'
    }],
    
    // Touch optimization
    ['touch-none', { 'touch-action': 'none' }],
    ['touch-pan-x', { 'touch-action': 'pan-x' }],
    ['touch-pan-y', { 'touch-action': 'pan-y' }],
    
    // Scrollbar hiding
    ['scrollbar-hide', {
      'scrollbar-width': 'none',
      '&::-webkit-scrollbar': {
        display: 'none'
      }
    }]
  ]
})