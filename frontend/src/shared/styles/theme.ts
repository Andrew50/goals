import { createTheme } from '@mui/material';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#2196f3',
      light: '#64b5f6',
      dark: '#1976d2',
    },
    secondary: {
      main: '#90caf9',
      light: '#bbdefb',
      dark: '#42a5f5',
    },
    background: {
      default: '#0a1929',
      paper: '#101f33',
    },
    text: {
      primary: '#ffffff',
      secondary: 'rgba(255, 255, 255, 0.7)',
    },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#101f33',
          backgroundImage: 'none',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: '4px',
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        InputProps: {
          inputProps: {
            // Ensure no pattern restrictions for text fields
            pattern: undefined,
          }
        }
      },
      styleOverrides: {
        root: {
          '& .MuiInputBase-input': {
            // Adding custom styles to ensure all characters are properly handled
            fontFamily: 'inherit',
          }
        }
      }
    },
    MuiInput: {
      styleOverrides: {
        input: {
          // Ensure special characters are properly handled
          fontFamily: 'inherit',
        }
      }
    }
  },
}); 