import { themeConfigs, ThemeName } from './themeConfig';

const STORAGE_KEY = 'goals_theme_cache';

// Helper to convert hex to RGB values
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

export function injectThemeVariables(themeName: ThemeName): void {
  const colors = themeConfigs[themeName];
  const isDark = colors.mode === 'dark';

  // Get RGB values for rgba() CSS functions
  const primaryRgb = hexToRgb(colors.primary.main);
  const secondaryRgb = hexToRgb(colors.secondary.main);
  const bgPaperRgb = hexToRgb(colors.background.paper);
  const priorityHighRgb = hexToRgb(colors.priority.high);
  const priorityMediumRgb = hexToRgb(colors.priority.medium);
  const priorityLowRgb = hexToRgb(colors.priority.low);
  const statusCompletedRgb = hexToRgb(colors.status.completed);
  const statusFailedRgb = hexToRgb(colors.status.failed);
  const statusInProgressRgb = hexToRgb(colors.status.inProgress);
  
  const cssVariables = `
    :root {
      /* Primary */
      --color-primary-main: ${colors.primary.main};
      --color-primary-main-rgb: ${primaryRgb ? `${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}` : '66, 153, 225'};
      --color-primary-light: ${colors.primary.light};
      --color-primary-dark: ${colors.primary.dark};
      
      /* Secondary */
      --color-secondary-main: ${colors.secondary.main};
      --color-secondary-main-rgb: ${secondaryRgb ? `${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b}` : '113, 128, 150'};
      --color-secondary-light: ${colors.secondary.light};
      --color-secondary-dark: ${colors.secondary.dark};
      
      /* Background */
      --color-bg-default: ${colors.background.default};
      --color-bg-paper: ${colors.background.paper};
      --color-bg-paper-rgb: ${bgPaperRgb ? `${bgPaperRgb.r}, ${bgPaperRgb.g}, ${bgPaperRgb.b}` : '255, 255, 255'};
      --color-bg-elevated: ${colors.background.elevated};
      --color-bg-input: ${colors.background.input};
      
      /* Text */
      --color-text-primary: ${colors.text.primary};
      --color-text-secondary: ${colors.text.secondary};
      --color-text-muted: ${colors.text.muted};
      --color-text-inverse: ${colors.text.inverse};
      
      /* Borders */
      --color-border-light: ${colors.border.light};
      --color-border-main: ${colors.border.main};
      --color-border-dark: ${colors.border.dark};
      
      /* Priority */
      --color-priority-high: ${colors.priority.high};
      --color-priority-high-rgb: ${priorityHighRgb ? `${priorityHighRgb.r}, ${priorityHighRgb.g}, ${priorityHighRgb.b}` : '229, 62, 62'};
      --color-priority-medium: ${colors.priority.medium};
      --color-priority-medium-rgb: ${priorityMediumRgb ? `${priorityMediumRgb.r}, ${priorityMediumRgb.g}, ${priorityMediumRgb.b}` : '221, 107, 32'};
      --color-priority-low: ${colors.priority.low};
      --color-priority-low-rgb: ${priorityLowRgb ? `${priorityLowRgb.r}, ${priorityLowRgb.g}, ${priorityLowRgb.b}` : '113, 128, 150'};
      
      /* Status */
      --color-status-completed: ${colors.status.completed};
      --color-status-completed-rgb: ${statusCompletedRgb ? `${statusCompletedRgb.r}, ${statusCompletedRgb.g}, ${statusCompletedRgb.b}` : '72, 187, 120'};
      --color-status-failed: ${colors.status.failed};
      --color-status-failed-rgb: ${statusFailedRgb ? `${statusFailedRgb.r}, ${statusFailedRgb.g}, ${statusFailedRgb.b}` : '229, 62, 62'};
      --color-status-skipped: ${colors.status.skipped};
      --color-status-inprogress: ${colors.status.inProgress};
      --color-status-inprogress-rgb: ${statusInProgressRgb ? `${statusInProgressRgb.r}, ${statusInProgressRgb.g}, ${statusInProgressRgb.b}` : '237, 137, 54'};
      
      /* Shadows (opacity-based for theming) */
      --shadow-color: 0, 0, 0;
      --shadow-opacity-low: ${isDark ? '0.3' : '0.1'};
      --shadow-opacity-medium: ${isDark ? '0.4' : '0.15'};
      
      /* Mode for CSS logic */
      --theme-mode: ${colors.mode};
    }
  `;

  // Remove any existing theme style tag
  const existing = document.getElementById('theme-variables');
  if (existing) {
    existing.remove();
  }

  // Inject new CSS variables
  const styleTag = document.createElement('style');
  styleTag.id = 'theme-variables';
  styleTag.textContent = cssVariables;
  document.head.appendChild(styleTag);

  // Apply data attribute for CSS selectors
  document.documentElement.setAttribute('data-theme', themeName);
}

export function cacheTheme(themeName: ThemeName): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: themeName,
      timestamp: Date.now(),
    }));
  } catch {
    // Ignore storage errors
  }
}

export function getCachedTheme(): ThemeName | null {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      const validThemes: ThemeName[] = ['light', 'dark', 'green', 'blue', 'orange', 'purple'];
      if (validThemes.includes(parsed.theme)) {
        return parsed.theme as ThemeName;
      }
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

// Quick cache for flash prevention (minimal data, runs before React)
export function getThemeCacheForInlineScript(): { theme: ThemeName; colors: { bg: string; text: string; primary: string } } | null {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      const theme = parsed.theme as ThemeName;
      const config = themeConfigs[theme];
      if (config) {
        return {
          theme,
          colors: {
            bg: config.background.default,
            text: config.text.primary,
            primary: config.primary.main,
          }
        };
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}
