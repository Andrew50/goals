import { useState, useEffect, useCallback } from 'react';
import { privateRequest } from '../utils/api';

// Convert VAPID key from base64 to Uint8Array
const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export interface PushNotificationState {
  isSupported: boolean;
  isStandalone: boolean;
  permission: NotificationPermission;
  isSubscribed: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface PushNotificationActions {
  requestPermission: () => Promise<boolean>;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
  sendTestNotification: () => Promise<boolean>;
}

export const usePushNotifications = (): [PushNotificationState, PushNotificationActions] => {
  const [state, setState] = useState<PushNotificationState>({
    isSupported: false,
    isStandalone: false,
    permission: 'default',
    isSubscribed: false,
    isLoading: false,
    error: null,
  });

  // Check if the app is running in standalone mode (installed as PWA)
  const checkStandaloneMode = useCallback(() => {
    const isStandalone = 
      window.matchMedia('(display-mode: standalone)').matches ||
      // @ts-ignore - iOS specific
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://');
    
    return isStandalone;
  }, []);

  // Check if push notifications are supported
  const checkSupport = useCallback(() => {
    return 'serviceWorker' in navigator && 
           'PushManager' in window && 
           'Notification' in window;
  }, []);

  // Check current subscription status
  const checkSubscription = useCallback(async () => {
    if (!checkSupport()) return false;

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      return subscription !== null;
    } catch (error) {
      console.error('Error checking subscription:', error);
      return false;
    }
  }, [checkSupport]);

  // Initialize state
  useEffect(() => {
    const init = async () => {
      const isSupported = checkSupport();
      const isStandalone = checkStandaloneMode();
      
      setState(prev => ({
        ...prev,
        isSupported,
        isStandalone,
        permission: isSupported ? Notification.permission : 'default',
      }));

      if (isSupported) {
        const isSubscribed = await checkSubscription();
        setState(prev => ({
          ...prev,
          isSubscribed,
        }));
      }
    };

    init();
  }, [checkSupport, checkStandaloneMode, checkSubscription]);

  // Request notification permission
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!state.isSupported) {
      setState(prev => ({ ...prev, error: 'Push notifications are not supported' }));
      return false;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const permission = await Notification.requestPermission();
      setState(prev => ({ 
        ...prev, 
        permission,
        isLoading: false 
      }));
      return permission === 'granted';
    } catch (error) {
      setState(prev => ({ 
        ...prev, 
        error: 'Failed to request permission',
        isLoading: false 
      }));
      return false;
    }
  }, [state.isSupported]);

  // Subscribe to push notifications
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!state.isSupported) {
      setState(prev => ({ ...prev, error: 'Push notifications are not supported' }));
      return false;
    }

    if (state.permission !== 'granted') {
      const granted = await requestPermission();
      if (!granted) {
        setState(prev => ({ ...prev, error: 'Permission denied' }));
        return false;
      }
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const registration = await navigator.serviceWorker.ready;
      
      // Get VAPID public key from environment
      const vapidPublicKey = process.env.REACT_APP_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        throw new Error('VAPID public key not configured');
      }

      // Subscribe to push notifications
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      // Send subscription to backend
      await privateRequest('push/subscribe', 'POST', subscription.toJSON());

      setState(prev => ({ 
        ...prev, 
        isSubscribed: true,
        isLoading: false 
      }));

      return true;
    } catch (error: any) {
      console.error('Subscription error:', error);
      setState(prev => ({ 
        ...prev, 
        error: error.message || 'Failed to subscribe',
        isLoading: false 
      }));
      return false;
    }
  }, [state.isSupported, state.permission, requestPermission]);

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!state.isSupported || !state.isSubscribed) {
      return false;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        // Notify backend to remove subscription
        await privateRequest('push/unsubscribe', 'POST', {
          endpoint: subscription.endpoint,
        });

        // Unsubscribe locally
        await subscription.unsubscribe();
      }

      setState(prev => ({ 
        ...prev, 
        isSubscribed: false,
        isLoading: false 
      }));

      return true;
    } catch (error: any) {
      console.error('Unsubscribe error:', error);
      setState(prev => ({ 
        ...prev, 
        error: error.message || 'Failed to unsubscribe',
        isLoading: false 
      }));
      return false;
    }
  }, [state.isSupported, state.isSubscribed]);

  // Send a test notification
  const sendTestNotification = useCallback(async (): Promise<boolean> => {
    if (!state.isSubscribed) {
      setState(prev => ({ ...prev, error: 'Not subscribed to notifications' }));
      return false;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      await privateRequest('push/test', 'POST', {});
      setState(prev => ({ ...prev, isLoading: false }));
      return true;
    } catch (error: any) {
      console.error('Test notification error:', error);
      setState(prev => ({ 
        ...prev, 
        error: error.message || 'Failed to send test notification',
        isLoading: false 
      }));
      return false;
    }
  }, [state.isSubscribed]);

  const actions: PushNotificationActions = {
    requestPermission,
    subscribe,
    unsubscribe,
    sendTestNotification,
  };

  return [state, actions];
};

// Helper hook to show iOS install prompt
export const useInstallPrompt = () => {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // Check if running on iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    
    // Check if not in standalone mode
    const isStandalone = 
      window.matchMedia('(display-mode: standalone)').matches ||
      // @ts-ignore
      window.navigator.standalone === true;

    // Check if user hasn't dismissed the prompt before
    const dismissed = localStorage.getItem('pwa-install-dismissed');

    if (isIOS && !isStandalone && !dismissed) {
      // Show prompt after a short delay
      setTimeout(() => setShowPrompt(true), 2000);
    }
  }, []);

  const dismissPrompt = () => {
    setShowPrompt(false);
    localStorage.setItem('pwa-install-dismissed', 'true');
  };

  const resetPrompt = () => {
    localStorage.removeItem('pwa-install-dismissed');
    setShowPrompt(true);
  };

  return { showPrompt, dismissPrompt, resetPrompt };
};
