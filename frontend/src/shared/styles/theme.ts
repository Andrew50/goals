import { createTheme } from '@mui/material';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#4299e1',
      light: '#63b3ed',
      dark: '#3182ce',
    },
    secondary: {
      main: '#718096',
      light: '#a0aec0',
      dark: '#4a5568',
    },
    background: {
      default: '#f5f7fa',
      paper: '#ffffff',
    },
    text: {
      primary: '#2d3748',
      secondary: '#718096',
    },
    error: {
      main: '#e53e3e',
    },
    warning: {
      main: '#ed8936',
    },
    success: {
      main: '#48bb78',
    },
  },
  zIndex: {
    // Keep AppBar above page content/overlays but below modals
    appBar: 1200,
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          borderRadius: '0.75rem',
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#ffffff',
          backgroundImage: 'none',
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
          borderBottom: '1px solid #e2e8f0',
          color: '#2d3748',
        },
      },
    },
    MuiToolbar: {
      styleOverrides: {
        root: {
          '& .MuiButton-root': {
            color: '#4a5568',
            '&:hover': {
              backgroundColor: '#f7fafc',
              color: '#2d3748',
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
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          },
        },
        containedPrimary: {
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
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
          },
          '& .MuiOutlinedInput-root': {
            borderRadius: '0.5rem',
            '& fieldset': {
              borderColor: '#e2e8f0',
            },
            '&:hover fieldset': {
              borderColor: '#cbd5e0',
            },
            '&.Mui-focused fieldset': {
              borderColor: '#4299e1',
              borderWidth: '2px',
            },
          },
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