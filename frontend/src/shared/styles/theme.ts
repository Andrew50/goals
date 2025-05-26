import { createTheme } from '@mui/material';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
      light: '#64b5f6',
      dark: '#115293',
    },
    secondary: {
      main: '#90caf9',
      light: '#e3f2fd',
      dark: '#42a5f5',
    },
    background: {
      default: '#fafafa',
      paper: '#ffffff',
    },
    text: {
      primary: '#333333',
      secondary: '#666666',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
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
          backgroundColor: '#ffffff',
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