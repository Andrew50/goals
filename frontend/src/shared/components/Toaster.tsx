import React, { useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import Snackbar from '@mui/material/Snackbar';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';

type SnackbarOptions = {
    message: string;
    actionLabel?: string;
    onAction?: () => void;
    severity?: 'info' | 'success' | 'warning' | 'error';
    duration?: number;
};

let activeRoot: Root | null = null;
let hostEl: HTMLDivElement | null = null;

export function showSnackbar(options: SnackbarOptions) {
    const { message, actionLabel, onAction, severity = 'info', duration = 4000 } = options;

    if (activeRoot && hostEl) {
        activeRoot.unmount();
        // Tests sometimes wipe `document.body.innerHTML`, so hostEl may already be detached.
        if (hostEl.parentNode) {
            hostEl.parentNode.removeChild(hostEl);
        }
        activeRoot = null;
        hostEl = null;
    }

    hostEl = document.createElement('div');
    document.body.appendChild(hostEl);
    activeRoot = createRoot(hostEl);

    const Toast: React.FC = () => {
        const [open, setOpen] = useState(true);

        const cleanup = () => {
            if (activeRoot && hostEl) {
                activeRoot.unmount();
                if (hostEl.parentNode) {
                    hostEl.parentNode.removeChild(hostEl);
                }
                activeRoot = null;
                hostEl = null;
            }
        };

        const handleClose = () => {
            setOpen(false);
            setTimeout(() => cleanup(), 200);
        };

        return (
            <Snackbar
                open={open}
                autoHideDuration={duration}
                onClose={handleClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    severity={severity}
                    variant="filled"
                    onClose={handleClose}
                    action={
                        onAction && actionLabel ? (
                            <Button color="inherit" size="small" onClick={() => { onAction(); handleClose(); }}>
                                {actionLabel}
                            </Button>
                        ) : null
                    }
                >
                    {message}
                </Alert>
            </Snackbar>
        );
    };

    activeRoot.render(<Toast />);
}
