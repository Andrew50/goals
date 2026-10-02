import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material';
import { createAppTheme } from '../styles/theme';
import { themeConfigs, ThemeName } from '../styles/themeConfig';
import { 
  injectThemeVariables, 
  cacheTheme, 
  getCachedTheme 
} from '../styles/injectThemeVariables';
import { getAccessToken, onAccessTokenChange, privateRequest } from '../utils/api';

interface ThemeSettings {
  theme_name: ThemeName;
}

interface ThemeContextType {
  themeName: ThemeName;
  setTheme: (name: ThemeName) => Promise<void>;
  isLoading: boolean;
  availableThemes: { name: ThemeName; label: string; preview: string }[];
}

const availableThemes = [
  { name: 'light' as ThemeName, label: 'Light', preview: themeConfigs.light.primary.main },
  { name: 'dark' as ThemeName, label: 'Dark', preview: themeConfigs.dark.primary.main },
  { name: 'green' as ThemeName, label: 'Green', preview: themeConfigs.green.primary.main },
  { name: 'blue' as ThemeName, label: 'Blue', preview: themeConfigs.blue.primary.main },
  { name: 'orange' as ThemeName, label: 'Orange', preview: themeConfigs.orange.primary.main },
  { name: 'purple' as ThemeName, label: 'Purple', preview: themeConfigs.purple.primary.main },
];

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Initialize from cache immediately to prevent flash
  const cached = getCachedTheme();
  const [themeName, setThemeName] = useState<ThemeName>(cached || 'light');
  const [isLoading, setIsLoading] = useState(true);

  // Apply theme whenever it changes
  useEffect(() => {
    injectThemeVariables(themeName);
  }, [themeName]);

  // Load theme once an access token exists. The token arrives after the refresh cookie is exchanged.
  useEffect(() => {
    let cancelled = false;

    const loadTheme = async (token: string | null) => {
      if (!token) {
        if (!cancelled) {
          setIsLoading(false);
        }
        return;
      }

      try {
        const settings = await privateRequest<ThemeSettings>('theme/settings', 'GET');
        if (!cancelled && settings.theme_name && themeConfigs[settings.theme_name]) {
          setThemeName(settings.theme_name);
          cacheTheme(settings.theme_name);
        }
      } catch (err) {
        console.log('Failed to load theme settings, using default');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadTheme(getAccessToken());
    const unsubscribe = onAccessTokenChange((token) => {
      if (token) {
        loadTheme(token);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const setTheme = useCallback(async (name: ThemeName) => {
    setThemeName(name);
    cacheTheme(name);
    
    try {
      await privateRequest('theme/settings', 'PUT', { theme_name: name });
    } catch (err) {
      console.error('Failed to save theme preference:', err);
      // Don't revert - user experience is better with local persistence
    }
  }, []);

  const theme = createAppTheme(themeName);

  return (
    <ThemeContext.Provider value={{ 
      themeName, 
      setTheme, 
      isLoading, 
      availableThemes 
    }}>
      <MuiThemeProvider theme={theme}>
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
