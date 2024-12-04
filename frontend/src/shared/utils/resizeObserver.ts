export const createResizeObserver = (callback: () => void) => {
    let timeoutId: NodeJS.Timeout;

    const resizeObserver = new ResizeObserver(() => {
        // Clear any existing timeout
        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        // Debounce the callback
        timeoutId = setTimeout(() => {
            callback();
        }, 100);
    });

    return {
        observe: (element: Element) => {
            resizeObserver.observe(element);
        },
        disconnect: () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            resizeObserver.disconnect();
        }
    };
}; 