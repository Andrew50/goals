import { useState, useCallback, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

interface HistoryState<T> {
    data: T;
    timestamp: number;
    undoFunction?: () => Promise<void>;
    redoFunction?: () => Promise<void>;
}

class HistoryManager<T> {
    private history: HistoryState<T>[] = [];
    private currentIndex: number = -1;
    private maxHistory: number;

    constructor(maxHistory: number = 100) {
        this.maxHistory = maxHistory;
    }

    pushState(data: T, undoFunction?: () => Promise<void>, redoFunction?: () => Promise<void>) {
        // Remove any future states if we're not at the end
        if (this.currentIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.currentIndex + 1);
        }

        // Add new state
        this.history.push({
            data: structuredClone(data), // Deep clone the data
            timestamp: Date.now(),
            undoFunction,
            redoFunction
        });

        // Remove oldest states if we exceed maxHistory
        if (this.history.length > this.maxHistory) {
            this.history = this.history.slice(this.history.length - this.maxHistory);
        }

        this.currentIndex = this.history.length - 1;
    }

    async undo(): Promise<T | null> {
        if (this.currentIndex > 0) {
            const currentState = this.history[this.currentIndex];
            if (currentState.undoFunction) {
                await currentState.undoFunction();
            }
            this.currentIndex--;
            return this.history[this.currentIndex].data;
        }
        return null;
    }

    async redo(): Promise<T | null> {
        if (this.currentIndex < this.history.length - 1) {
            this.currentIndex++;
            const currentState = this.history[this.currentIndex];
            if (currentState.redoFunction) {
                await currentState.redoFunction();
            }
            return currentState.data;
        }
        return null;
    }

    canUndo(): boolean {
        return this.currentIndex > 0;
    }

    canRedo(): boolean {
        return this.currentIndex < this.history.length - 1;
    }

    clear() {
        this.history = [];
        this.currentIndex = -1;
    }
}

export function useHistoryState<T>(
    initialState: T,
    options: {
        maxHistory?: number;
        hotkeyScope?: string;
        onUndo?: (state: T) => void;
        onRedo?: (state: T) => void;
    } = {}
) {
    const [state, setState] = useState<T>(initialState);
    const historyManager = useRef<HistoryManager<T>>(new HistoryManager(options.maxHistory));

    // Setup hotkeys
    useHotkeys(
        'ctrl+z, cmd+z',
        async (event) => {
            event.preventDefault();
            const previousState = await historyManager.current.undo();
            if (previousState) {
                setState(previousState);
                options.onUndo?.(previousState);
            }
        },
        { scopes: options.hotkeyScope ? [options.hotkeyScope] : undefined }
    );

    useHotkeys(
        'ctrl+shift+z, cmd+shift+z',
        async (event) => {
            event.preventDefault();
            const nextState = await historyManager.current.redo();
            if (nextState) {
                setState(nextState);
                options.onRedo?.(nextState);
            }
        },
        { scopes: options.hotkeyScope ? [options.hotkeyScope] : undefined }
    );

    const setStateWithHistory = useCallback((newState: T, undoFunction?: () => Promise<void>, redoFunction?: () => Promise<void>) => {
        historyManager.current.pushState(newState, undoFunction, redoFunction);
        setState(newState);
    }, []);

    return [state, setStateWithHistory] as const;
} 
