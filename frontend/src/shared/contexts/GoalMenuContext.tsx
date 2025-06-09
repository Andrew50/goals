import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import GoalMenu from '../components/GoalMenu';
import { Goal } from '../../types/goals';

type Mode = 'create' | 'edit' | 'view';

interface GoalMenuContextType {
    openGoalMenu: (goal: Goal, initialMode: Mode, onSuccess?: (goal: Goal) => void) => void;
    closeGoalMenu: () => void;
}

const GoalMenuContext = createContext<GoalMenuContextType | undefined>(undefined);

export const useGoalMenu = () => {
    const context = useContext(GoalMenuContext);
    if (!context) {
        throw new Error('useGoalMenu must be used within a GoalMenuProvider');
    }
    return context;
};

interface GoalMenuProviderProps {
    children: ReactNode;
}

export const GoalMenuProvider: React.FC<GoalMenuProviderProps> = ({ children }) => {
    const [goalMenuState, setGoalMenuState] = useState<{
        isOpen: boolean;
        goal: Goal | null;
        mode: Mode;
        onSuccess?: (goal: Goal) => void;
    }>({
        isOpen: false,
        goal: null,
        mode: 'view',
    });

    const openGoalMenu = useCallback((goal: Goal, initialMode: Mode, onSuccess?: (goal: Goal) => void) => {
        setGoalMenuState({
            isOpen: true,
            goal,
            mode: initialMode,
            onSuccess,
        });
    }, []);

    const closeGoalMenu = useCallback(() => {
        setGoalMenuState(prevState => ({ ...prevState, isOpen: false }));
    }, []);

    return (
        <GoalMenuContext.Provider value={{ openGoalMenu, closeGoalMenu }}>
            {children}
            {goalMenuState.isOpen && goalMenuState.goal && (
                <GoalMenu
                    goal={goalMenuState.goal}
                    mode={goalMenuState.mode}
                    onClose={closeGoalMenu}
                    onSuccess={(updatedGoal: Goal) => {
                        if (goalMenuState.onSuccess) {
                            goalMenuState.onSuccess(updatedGoal);
                        }
                        closeGoalMenu();
                    }}
                />
            )}
        </GoalMenuContext.Provider>
    );
}; 