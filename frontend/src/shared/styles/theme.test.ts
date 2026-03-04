import { createAppTheme, theme as legacyTheme } from './theme';
import { themeConfigs, ThemeName, getValidThemeName } from './themeConfig';
import { 
  injectThemeVariables, 
  cacheTheme, 
  getCachedTheme,
  getThemeCacheForInlineScript 
} from './injectThemeVariables';

describe('theme system', () => {
  beforeEach(() => {
    // Clean up DOM
    const existing = document.getElementById('theme-variables');
    if (existing) {
      existing.remove();
    }
    // Clean up localStorage
    localStorage.removeItem('goals_theme_cache');
    document.documentElement.removeAttribute('data-theme');
  });

  describe('themeConfigs', () => {
    const themes: ThemeName[] = ['light', 'dark', 'green', 'blue', 'orange', 'purple'];
    
    themes.forEach(themeName => {
      test(`${themeName} has all required color definitions`, () => {
        const config = themeConfigs[themeName];
        expect(config.primary.main).toBeDefined();
        expect(config.primary.light).toBeDefined();
        expect(config.primary.dark).toBeDefined();
        expect(config.background.default).toBeDefined();
        expect(config.background.paper).toBeDefined();
        expect(config.background.elevated).toBeDefined();
        expect(config.background.input).toBeDefined();
        expect(config.text.primary).toBeDefined();
        expect(config.text.secondary).toBeDefined();
        expect(config.text.muted).toBeDefined();
        expect(config.text.inverse).toBeDefined();
        expect(config.border.light).toBeDefined();
        expect(config.border.main).toBeDefined();
        expect(config.border.dark).toBeDefined();
        expect(config.priority.high).toBeDefined();
        expect(config.priority.medium).toBeDefined();
        expect(config.priority.low).toBeDefined();
        expect(config.status.completed).toBeDefined();
        expect(config.status.failed).toBeDefined();
        expect(config.status.skipped).toBeDefined();
        expect(config.status.inProgress).toBeDefined();
        expect(config.mode).toMatch(/^(light|dark)$/);
      });
    });

    test('all themes have valid hex colors', () => {
      const hexRegex = /^#[0-9A-Fa-f]{6}$/;
      Object.values(themeConfigs).forEach(config => {
        expect(config.primary.main).toMatch(hexRegex);
        expect(config.background.default).toMatch(hexRegex);
        expect(config.text.primary).toMatch(hexRegex);
      });
    });
  });

  describe('createAppTheme', () => {
    test('creates valid MUI theme for all themes', () => {
      const themes: ThemeName[] = ['light', 'dark', 'green', 'blue', 'orange', 'purple'];
      themes.forEach(themeName => {
        const theme = createAppTheme(themeName);
        expect(theme.palette.primary.main).toBe(themeConfigs[themeName].primary.main);
        expect(theme.palette.mode).toBe(themeConfigs[themeName].mode);
        expect(theme.palette.background.default).toBe(themeConfigs[themeName].background.default);
        expect(theme.palette.background.paper).toBe(themeConfigs[themeName].background.paper);
      });
    });

    test('dark theme has mode set to dark', () => {
      const darkTheme = createAppTheme('dark');
      expect(darkTheme.palette.mode).toBe('dark');
    });

    test('light theme has mode set to light', () => {
      const lightTheme = createAppTheme('light');
      expect(lightTheme.palette.mode).toBe('light');
    });

    test('theme has component overrides defined', () => {
      const theme = createAppTheme('light');
      expect(theme.components?.MuiPaper).toBeDefined();
      expect(theme.components?.MuiAppBar).toBeDefined();
      expect(theme.components?.MuiButton).toBeDefined();
      expect(theme.components?.MuiTextField).toBeDefined();
    });

    test('theme has correct z-index for appBar', () => {
      const theme = createAppTheme('light');
      expect(theme.zIndex.appBar).toBe(1200);
    });

    test('theme has correct shape borderRadius', () => {
      const theme = createAppTheme('light');
      expect(theme.shape.borderRadius).toBe(8);
    });
  });

  describe('legacy theme export', () => {
    test('exports a valid MUI theme', () => {
      expect(legacyTheme).toBeDefined();
      expect(legacyTheme.palette).toBeDefined();
      expect(legacyTheme.typography).toBeDefined();
      expect(legacyTheme.components).toBeDefined();
    });

    test('legacy theme is the light theme', () => {
      expect(legacyTheme.palette.primary.main).toBe(themeConfigs.light.primary.main);
      expect(legacyTheme.palette.mode).toBe('light');
    });
  });

  describe('getValidThemeName', () => {
    test('returns valid theme names unchanged', () => {
      expect(getValidThemeName('dark')).toBe('dark');
      expect(getValidThemeName('green')).toBe('green');
      expect(getValidThemeName('purple')).toBe('purple');
    });

    test('returns light for invalid theme names', () => {
      expect(getValidThemeName('invalid')).toBe('light');
      expect(getValidThemeName('')).toBe('light');
      expect(getValidThemeName(null)).toBe('light');
    });
  });

  describe('injectThemeVariables', () => {
    test('injects CSS variables into document', () => {
      injectThemeVariables('dark');
      const styleTag = document.getElementById('theme-variables');
      expect(styleTag).toBeTruthy();
      expect(styleTag?.textContent).toContain('--color-bg-default');
      expect(styleTag?.textContent).toContain('--color-primary-main');
    });

    test('sets data-theme attribute on html element', () => {
      injectThemeVariables('green');
      expect(document.documentElement.getAttribute('data-theme')).toBe('green');
    });

    test('replaces existing theme style tag', () => {
      injectThemeVariables('light');
      injectThemeVariables('dark');
      const styleTags = document.querySelectorAll('style#theme-variables');
      expect(styleTags.length).toBe(1);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    test('includes RGB values for rgba() support', () => {
      injectThemeVariables('light');
      const styleTag = document.getElementById('theme-variables');
      expect(styleTag?.textContent).toContain('--color-primary-main-rgb');
      expect(styleTag?.textContent).toContain('--color-priority-high-rgb');
    });
  });

  describe('cacheTheme', () => {
    test('saves theme to localStorage', () => {
      cacheTheme('dark');
      const cached = localStorage.getItem('goals_theme_cache');
      expect(cached).toBeTruthy();
      const parsed = JSON.parse(cached!);
      expect(parsed.theme).toBe('dark');
      expect(parsed.timestamp).toBeDefined();
    });

    test('handles localStorage errors gracefully', () => {
      // Mock localStorage to throw
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = jest.fn(() => {
        throw new Error('Storage error');
      });
      
      // Should not throw
      expect(() => cacheTheme('light')).not.toThrow();
      
      // Restore
      localStorage.setItem = originalSetItem;
    });
  });

  describe('getCachedTheme', () => {
    test('returns cached theme name', () => {
      cacheTheme('purple');
      expect(getCachedTheme()).toBe('purple');
    });

    test('returns null for invalid cached theme', () => {
      localStorage.setItem('goals_theme_cache', JSON.stringify({ theme: 'invalid' }));
      expect(getCachedTheme()).toBeNull();
    });

    test('returns null when nothing cached', () => {
      expect(getCachedTheme()).toBeNull();
    });

    test('handles localStorage errors gracefully', () => {
      // Mock localStorage to throw
      const originalGetItem = localStorage.getItem;
      localStorage.getItem = jest.fn(() => {
        throw new Error('Storage error');
      });
      
      // Should return null, not throw
      expect(getCachedTheme()).toBeNull();
      
      // Restore
      localStorage.getItem = originalGetItem;
    });
  });

  describe('getThemeCacheForInlineScript', () => {
    test('returns theme and colors for cached theme', () => {
      cacheTheme('blue');
      const result = getThemeCacheForInlineScript();
      expect(result).toBeTruthy();
      expect(result?.theme).toBe('blue');
      expect(result?.colors.bg).toBe(themeConfigs.blue.background.default);
      expect(result?.colors.text).toBe(themeConfigs.blue.text.primary);
      expect(result?.colors.primary).toBe(themeConfigs.blue.primary.main);
    });

    test('returns null when nothing cached', () => {
      expect(getThemeCacheForInlineScript()).toBeNull();
    });
  });
});
