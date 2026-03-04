export type ThemeName = 'light' | 'dark' | 'green' | 'blue' | 'orange' | 'purple';

export interface ThemeColors {
  // Primary brand colors
  primary: {
    main: string;
    light: string;
    dark: string;
    contrastText?: string;
  };
  // Secondary/accent colors
  secondary: {
    main: string;
    light: string;
    dark: string;
  };
  // Background colors
  background: {
    default: string;      // Page background
    paper: string;        // Card/modal backgrounds
    elevated: string;     // Hover states, elevated elements
    input: string;        // Input field backgrounds
  };
  // Text colors
  text: {
    primary: string;      // Headings, important text
    secondary: string;    // Descriptions, metadata
    muted: string;        // Placeholders, disabled text
    inverse: string;      // Text on colored backgrounds
  };
  // Border/divider colors
  border: {
    light: string;
    main: string;
    dark: string;
  };
  // Priority colors (for task priority badges)
  priority: {
    high: string;
    medium: string;
    low: string;
  };
  // Status colors
  status: {
    completed: string;
    failed: string;
    skipped: string;
    inProgress: string;
  };
  // MUI palette mode
  mode: 'light' | 'dark';
}

export const themeConfigs: Record<ThemeName, ThemeColors> = {
  light: {
    primary: { main: '#4299e1', light: '#63b3ed', dark: '#3182ce' },
    secondary: { main: '#718096', light: '#a0aec0', dark: '#4a5568' },
    background: {
      default: '#f5f7fa',
      paper: '#ffffff',
      elevated: '#f7fafc',
      input: '#ffffff',
    },
    text: { primary: '#2d3748', secondary: '#4a5568', muted: '#718096', inverse: '#ffffff' },
    border: { light: '#edf2f7', main: '#e2e8f0', dark: '#cbd5e0' },
    priority: { high: '#C45B5B', medium: '#B8834A', low: '#7A8A9A' },
    status: { completed: '#5B9A6B', failed: '#C45B5B', skipped: '#9AA0A8', inProgress: '#B8834A' },
    mode: 'light',
  },
  dark: {
    primary: { main: '#5a7a9a', light: '#7a9ab8', dark: '#3d5a7a', contrastText: '#050508' },
    secondary: { main: '#6b7a8a', light: '#8a9aa8', dark: '#4a5a6a' },
    background: {
      default: '#050508',
      paper: '#0d0d12',
      elevated: '#1a1a22',
      input: '#0d0d12',
    },
    text: { primary: '#e8e8ed', secondary: '#a0a0a8', muted: '#6a6a75', inverse: '#050508' },
    border: { light: '#1a1a22', main: '#2a2a35', dark: '#3a3a45' },
    priority: { high: '#D48A8A', medium: '#D4A66A', low: '#9AA8B8' },
    status: { completed: '#7AB88A', failed: '#D48A8A', skipped: '#A8A8B0', inProgress: '#D4A66A' },
    mode: 'dark',
  },
  green: {
    primary: { main: '#6b8e6b', light: '#8ebea8', dark: '#4a6b4a', contrastText: '#0d1f16' },
    secondary: { main: '#5e7b5b', light: '#7a9a76', dark: '#3d5a3d' },
    background: {
      default: '#0d1f16',
      paper: '#1a2e22',
      elevated: '#2a4538',
      input: '#1a2e22',
    },
    text: { primary: '#e8f0e8', secondary: '#b8c9b8', muted: '#7a9a7a', inverse: '#0d1f16' },
    border: { light: '#2a4538', main: '#3d5a3d', dark: '#4a6b4a' },
    priority: { high: '#D48A8A', medium: '#D4A66A', low: '#9AA8A8' },
    status: { completed: '#7AB88A', failed: '#D48A8A', skipped: '#A8B0A8', inProgress: '#D4A66A' },
    mode: 'dark',
  },
  blue: {
    primary: { main: '#5a7a9a', light: '#7a9ab8', dark: '#3d5a7a', contrastText: '#0a0f1a' },
    secondary: { main: '#4a6b8a', light: '#6a8aaa', dark: '#3a5a7a' },
    background: {
      default: '#0a0f1a',
      paper: '#111827',
      elevated: '#1e293b',
      input: '#111827',
    },
    text: { primary: '#e2e8f0', secondary: '#94a3b8', muted: '#64748b', inverse: '#0a0f1a' },
    border: { light: '#1e293b', main: '#334155', dark: '#475569' },
    priority: { high: '#D48A8A', medium: '#D4A66A', low: '#9AA8B8' },
    status: { completed: '#7AB88A', failed: '#D48A8A', skipped: '#A8A8B0', inProgress: '#D4A66A' },
    mode: 'dark',
  },
  orange: {
    primary: { main: '#a66b4a', light: '#c48a6a', dark: '#7a4d35', contrastText: '#1a120d' },
    secondary: { main: '#8a5a45', light: '#a87a5a', dark: '#6a4030' },
    background: {
      default: '#1a120d',
      paper: '#2a1d16',
      elevated: '#3d2a20',
      input: '#2a1d16',
    },
    text: { primary: '#f5ebe3', secondary: '#c9b8a8', muted: '#9a8a7a', inverse: '#1a120d' },
    border: { light: '#3d2a20', main: '#4d3a30', dark: '#6a4d3a' },
    priority: { high: '#D48A8A', medium: '#D4A66A', low: '#9AA8A8' },
    status: { completed: '#7AB88A', failed: '#D48A8A', skipped: '#A8A8A8', inProgress: '#D4A66A' },
    mode: 'dark',
  },
  purple: {
    primary: { main: '#8a7aa8', light: '#a89ac0', dark: '#6b5a85', contrastText: '#110d1a' },
    secondary: { main: '#7a6a9a', light: '#9a8ab8', dark: '#5a4a75' },
    background: {
      default: '#110d1a',
      paper: '#1a1525',
      elevated: '#2a2038',
      input: '#1a1525',
    },
    text: { primary: '#e8e3f0', secondary: '#b8b0c8', muted: '#8a8098', inverse: '#110d1a' },
    border: { light: '#2a2038', main: '#3d3050', dark: '#504060' },
    priority: { high: '#D48A8A', medium: '#D4A66A', low: '#9AA8A8' },
    status: { completed: '#7AB88A', failed: '#D48A8A', skipped: '#A8A8B0', inProgress: '#D4A66A' },
    mode: 'dark',
  },
};

// Helper to get valid theme name with fallback
export function getValidThemeName(name: string | null): ThemeName {
  const validThemes: ThemeName[] = ['light', 'dark', 'green', 'blue', 'orange', 'purple'];
  if (name && validThemes.includes(name as ThemeName)) {
    return name as ThemeName;
  }
  return 'light';
}
