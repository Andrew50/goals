import { createTheme, Theme } from '@mui/material';
import { themeConfigs, ThemeName } from './themeConfig';

// Extend the MUI TypeText interface to include custom text properties
declare module '@mui/material/styles/createPalette' {
  interface TypeText {
    muted?: string;
    inverse?: string;
  }
}

// Extend the MUI Palette interface to include custom border property
declare module '@mui/material/styles' {
  interface Palette {
    border: {
      light: string;
      main: string;
      dark: string;
    };
  }
  interface PaletteOptions {
    border?: {
      light?: string;
      main?: string;
      dark?: string;
    };
  }
}

export function createAppTheme(themeName: ThemeName): Theme {
  const colors = themeConfigs[themeName];
  const isDark = colors.mode === 'dark';

  return createTheme({
    palette: {
      mode: colors.mode,
      primary: colors.primary,
      secondary: colors.secondary,
      background: {
        default: colors.background.default,
        paper: colors.background.paper,
      },
      text: {
        primary: colors.text.primary,
        secondary: colors.text.secondary,
        muted: colors.text.muted,
        inverse: colors.text.inverse,
      },
      border: {
        light: colors.border.light,
        main: colors.border.main,
        dark: colors.border.dark,
      },
      error: { main: colors.status.failed },
      warning: { main: colors.priority.medium },
      success: { main: colors.status.completed },
      grey: {
        50: isDark ? '#2d3748' : '#f7fafc',
        100: isDark ? '#4a5568' : '#edf2f7',
        200: isDark ? '#718096' : '#e2e8f0',
        300: isDark ? '#a0aec0' : '#cbd5e0',
        400: isDark ? '#cbd5e0' : '#a0aec0',
        500: isDark ? '#e2e8f0' : '#718096',
        600: isDark ? '#edf2f7' : '#4a5568',
        700: isDark ? '#f7fafc' : '#2d3748',
        800: isDark ? '#ffffff' : '#1a202c',
        900: isDark ? '#ffffff' : '#101f33',
      },
      info: {
        main: colors.primary.main,
        light: colors.primary.light,
        dark: colors.primary.dark,
      },
    },
    zIndex: {
      appBar: 1200,
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            borderRadius: '0.75rem',
            boxShadow: `0 1px 3px 0 rgba(${isDark ? '0,0,0' : '0,0,0'}, ${isDark ? '0.3' : '0.1'})`,
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: colors.background.paper,
            backgroundImage: 'none',
            boxShadow: `0 1px 3px 0 rgba(${isDark ? '0,0,0' : '0,0,0'}, ${isDark ? '0.3' : '0.1'})`,
            borderBottom: `1px solid ${colors.border.main}`,
            color: colors.text.primary,
          },
        },
      },
      MuiToolbar: {
        styleOverrides: {
          root: {
            '& .MuiButton-root': {
              minWidth: 0,
              padding: '6px 12px',
              color: colors.text.secondary,
              '&:hover': {
                backgroundColor: colors.background.elevated,
                color: colors.text.primary,
              },
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            borderRadius: '0.5rem',
            fontWeight: 600,
            transition: 'all 0.2s',
            '&:hover': {
              transform: 'translateY(-1px)',
              boxShadow: `0 4px 6px -1px rgba(${isDark ? '0,0,0' : '0,0,0'}, ${isDark ? '0.3' : '0.1'})`,
            },
          },
          containedPrimary: {
            boxShadow: `0 1px 3px 0 rgba(${isDark ? '0,0,0' : '0,0,0'}, ${isDark ? '0.3' : '0.1'})`,
          },
        },
      },
      MuiTextField: {
        defaultProps: {
          InputProps: {
            inputProps: {
              pattern: undefined,
            }
          }
        },
        styleOverrides: {
          root: {
            '& .MuiInputBase-input': {
              fontFamily: 'inherit',
              color: colors.text.primary,
            },
            '& .MuiOutlinedInput-root': {
              borderRadius: '0.5rem',
              backgroundColor: colors.background.input,
              '& fieldset': {
                borderColor: colors.border.main,
              },
              '&:hover fieldset': {
                borderColor: colors.border.dark,
              },
              '&.Mui-focused fieldset': {
                borderColor: colors.primary.main,
                borderWidth: '2px',
              },
            },
            '& .MuiInputLabel-root': {
              color: colors.text.secondary,
            },
            '& .MuiInputLabel-root.Mui-focused': {
              color: colors.primary.main,
            },
          }
        }
      },
      MuiInput: {
        styleOverrides: {
          root: {
            color: colors.text.primary,
          },
          input: {
            fontFamily: 'inherit',
          }
        }
      },
    },
    shape: {
      borderRadius: 8,
    },
    typography: {
      fontFamily: [
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
      ].join(','),
    },
  });
}

// Legacy static theme export for backward compatibility during migration
// This is the 'light' theme by default - new code should use createAppTheme()
export const theme = createAppTheme('light');
