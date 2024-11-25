import React, { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    MenuItem,
    FormControlLabel,
    Checkbox,
    Box
} from '@mui/material';

import { privateRequest } from '../utils/api';
import { Goal, GoalType } from '../types';
interface GoalDialogProps {
    open: boolean;
    onClose: () => void;
    goal: Partial<Goal>;
    onChange: (goal: Partial<Goal>) => void;
    mode: 'create' | 'edit' | 'view';
    error: string;
    onSuccess?: () => void;
}

// Export the relationship creation function
export const createRelationship = async (fromId: number, toId: number, relationshipType: string) => {
    return await privateRequest('goals/relationships', 'POST', {
        from_id: fromId,
        to_id: toId,
        relationship_type: relationshipType
    });
};

const RoutineSpecificFields = ({ goal, onChange, isViewOnly }: {
    goal: Partial<Goal>;
    onChange: (goal: Partial<Goal>) => void;
    isViewOnly: boolean;
}) => {
    return (
        <>
            <TextField
                label="Routine Type"
                value={goal.routine_type || ''}
                onChange={(e) => {
                    onChange({
                        ...goal,
                        routine_type: e.target.value as 'task' | 'achievement'
                    } as Goal);
                }}
                select
                fullWidth
                margin="dense"
                disabled={isViewOnly}
            >
                <MenuItem value="task">Task</MenuItem>
                <MenuItem value="achievement">Achievement</MenuItem>
            </TextField>
            <TextField
                label="Routine Name"
                value={goal.routine_name || ''}
                onChange={(e) => onChange({
                    ...goal,
                    routine_name: e.target.value
                } as Goal)}
                fullWidth
                margin="dense"
                disabled={isViewOnly}
                inputProps={{
                    autoComplete: 'off'
                }}
            />
            <TextField
                label="Routine Description"
                value={goal.routine_description || ''}
                onChange={(e) => onChange({
                    ...goal,
                    routine_description: e.target.value
                } as Goal)}
                fullWidth
                margin="dense"
                multiline
                rows={4}
                disabled={isViewOnly}
                inputProps={{
                    autoComplete: 'off'
                }}
            />
            <TextField
                label="Routine Duration (minutes)"
                type="number"
                value={goal.routine_duration || ''}
                onChange={(e) => onChange({
                    ...goal,
                    routine_duration: parseInt(e.target.value) || undefined
                })}
                fullWidth
                margin="dense"
                disabled={isViewOnly}
            />
            <TextField
                label="Routine Time (24-hour format)"
                type="time"
                value={goal.routine_time ? new Date(goal.routine_time).toISOString().substr(11, 5) : ''}
                onChange={(e) => {
                    const [hours, minutes] = e.target.value.split(':').map(Number);
                    const timeInMs = (hours * 60 + minutes) * 60 * 1000;
                    onChange({
                        ...goal,
                        routine_time: timeInMs
                    });
                }}
                fullWidth
                margin="dense"
                InputLabelProps={{ shrink: true }}
                inputProps={{ step: 300 }}
                disabled={isViewOnly}
            />
        </>
    );
};

const GoalDialog: React.FC<GoalDialogProps> = ({
    open,
    onClose,
    goal,
    onChange,
    mode,
    error,
    onSuccess
}) => {
    const isViewOnly = mode === 'view';
    const title = {
        'create': 'Create New Goal',
        'edit': 'Edit Goal',
        'view': 'View Goal'
    }[mode];

    const [errorState, setErrorState] = useState<string>('');
    const token = localStorage.getItem('authToken');

    const config = {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    };

    const handleSubmit = async () => {
        try {
            if (mode === 'create') {
                await createGoal(goal);
            } else if (mode === 'edit' && goal.id) {
                await updateGoal(goal.id, goal as Goal);
            }
            onSuccess?.();
            onClose();
        } catch (err) {
            // Error is handled in the respective functions
        }
    };

    const createGoal = async (goal: Partial<Goal>) => {
        console.log('Attempting to create goal with data:', goal);
        const response = await privateRequest<Goal>('goals/create', 'POST', goal);
        Object.assign(goal, response);
        return response;
    };

    const updateGoal = async (goalId: number, goal: Goal) => {
        try {
            const response = await privateRequest<Goal>(`goals/${goalId}`, 'PUT', goal);
            return response;
        } catch (err) {
            setErrorState(err instanceof Error ? err.message : 'Failed to update goal');
            throw err;
        }
    };

    const handleDelete = async () => {
        try {
            if (goal.id) {
                await deleteGoal(goal.id);
                onSuccess?.();
                onClose();
            }
        } catch (err) {
            // Error is handled in deleteGoal
        }
    };

    const deleteGoal = async (goalId: number) => {
        try {
            await privateRequest(`goals/${goalId}`, 'DELETE');
        } catch (err) {
            setErrorState(err instanceof Error ? err.message : 'Failed to delete goal');
            throw err;
        }
    };
    const formatDateForInput = (timestamp: number | string | undefined): string => {
        if (!timestamp) return '';
        try {
            const timestampNum = typeof timestamp === 'string' ? parseInt(timestamp) : timestamp;
            const date = new Date(timestampNum);
            return date.toISOString().slice(0, 16);
        } catch {
            return '';
        }
    };

    const PriorityField = () => {
        return (
            <TextField
                label="Priority"
                select
                value={goal.priority || ''}
                onChange={(e) => onChange({
                    ...goal,
                    priority: e.target.value as 'high' | 'medium' | 'low'
                })}
                fullWidth
                margin="dense"
                disabled={isViewOnly}
            >
                <MenuItem value="high">High</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="low">Low</MenuItem>
            </TextField>
        );
    };

    const ScheduleField = () => {
        if (goal.goal_type !== 'task') return null;
        return (
            <>
                <TextField
                    label="Schedule Date"
                    type="time"
                    value={formatDateForInput(goal.scheduled_timestamp)}
                    onChange={(e) => {
                        const [hours, minutes] = e.target.value.split(':').map(Number);
                        const timeInMs = (hours * 60 + minutes) * 60 * 1000;
                        onChange({
                            ...goal,
                            scheduled_timestamp: timeInMs
                        });
                    }}
                    fullWidth
                    margin="dense"
                    InputLabelProps={{ shrink: true }}
                    inputProps={{
                        step: 300 // 5 min intervals
                    }}
                    disabled={isViewOnly}
                />
                <TextField
                    label="Duration (hours)"
                    type="number"
                    value={goal.duration || ''}
                    onChange={(e) => {
                        const duration = e.target.value ? parseFloat(e.target.value) : undefined;
                        onChange({
                            ...goal,
                            duration
                        });
                    }}
                    fullWidth
                    margin="dense"
                    InputLabelProps={{ shrink: true }}
                    inputProps={{
                        min: 0.25,
                        max: 24,
                        step: 0.25
                    }}
                    disabled={isViewOnly}
                />
            </>
        );
    };

    const DateFields = () => {


        return (
            <>
                <TextField
                    label="Start Date"
                    type="datetime-local"
                    value={formatDateForInput(goal.start_timestamp)}
                    onChange={(e) => {
                        const timestamp = e.target.value
                            ? parseInt(String(new Date(e.target.value).getTime()))
                            : undefined;
                        onChange({
                            ...goal,
                            start_timestamp: timestamp
                        });
                    }}
                    fullWidth
                    margin="dense"
                    InputLabelProps={{ shrink: true }}
                    disabled={isViewOnly}
                />
                <TextField
                    label="End Date"
                    type="datetime-local"
                    value={formatDateForInput(goal.end_timestamp)}
                    onChange={(e) => {
                        const timestamp = e.target.value
                            ? parseInt(String(new Date(e.target.value).getTime()))
                            : undefined;
                        onChange({
                            ...goal,
                            end_timestamp: timestamp
                        });
                    }}
                    fullWidth
                    margin="dense"
                    InputLabelProps={{ shrink: true }}
                    disabled={isViewOnly}
                />
            </>
        );
    };

    const CompletedField = () => {
        // Only show completed field for achievement goals
        if (goal.goal_type !== 'achievement') return null;

        return (
            <FormControlLabel
                control={
                    <Checkbox
                        checked={goal.completed || false}
                        onChange={(e) => onChange({
                            ...goal,
                            completed: e.target.checked
                        })}
                        disabled={isViewOnly}
                    />
                }
                label="Completed"
            />
        );
    };

    const FrequencyField = () => {
        if (goal.goal_type !== 'routine') return null;

        return (
            <TextField
                label="Frequency"
                value={goal.frequency || ''}
                onChange={(e) => onChange({
                    ...goal,
                    frequency: e.target.value
                })}
                select
                fullWidth
                margin="dense"
                disabled={isViewOnly}
            >
                <MenuItem value="P1D">Daily</MenuItem>
                <MenuItem value="P7D">Weekly</MenuItem>
                <MenuItem value="P14D">Bi-weekly</MenuItem>
                <MenuItem value="P1M">Monthly</MenuItem>
                <MenuItem value="P3M">Quarterly</MenuItem>
                <MenuItem value="P1Y">Yearly</MenuItem>
            </TextField>
        );
    };

    const renderTypeSpecificFields = () => {
        if (!goal.goal_type) return null;

        const project_and_achievement_fields = (
            <>
                <PriorityField />
                <DateFields />
                <CompletedField />
            </>
        );
        switch (goal.goal_type) {
            case 'project':
                return project_and_achievement_fields;
            case 'achievement':
                return project_and_achievement_fields;
            case 'directive':
                return null;
            case 'routine':
                return (
                    <>
                        <PriorityField />
                        <FrequencyField />
                        <DateFields />
                        <RoutineSpecificFields goal={goal} onChange={onChange} isViewOnly={isViewOnly} />
                    </>
                );
            case 'task':
                return (
                    <>
                        <PriorityField />
                        <ScheduleField />
                    </>
                );
        }
    };

    // Goal type selection field
    const goalTypeField = (
        <TextField
            label="Goal Type"
            value={goal.goal_type || ''}
            onChange={(e) => onChange({
                ...goal,
                goal_type: e.target.value as GoalType
            })}
            select
            fullWidth
            margin="dense"
            required
            disabled={isViewOnly}
        >
            <MenuItem value="directive">Directive</MenuItem>
            <MenuItem value="project">Project</MenuItem>
            <MenuItem value="achievement">Achievement</MenuItem>
            <MenuItem value="routine">Routine</MenuItem>
            <MenuItem value="task">Task</MenuItem>
        </TextField>
    );

    // Common fields
    const commonFields = (
        <>
            {goalTypeField}
            <TextField
                label="Name"
                value={goal.name || ''}
                onChange={(e) => onChange({ ...goal, name: e.target.value })}
                fullWidth
                margin="dense"
                required
                disabled={isViewOnly}
            />
            <TextField
                label="Description"
                value={goal.description || ''}
                onChange={(e) => onChange({ ...goal, description: e.target.value })}
                fullWidth
                margin="dense"
                multiline
                disabled={isViewOnly}
            />
        </>
    );

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                {errorState && (
                    <Box sx={{ color: 'error.main', mb: 2 }}>
                        {errorState}
                    </Box>
                )}
                {commonFields}
                {renderTypeSpecificFields()}
            </DialogContent>
            <DialogActions sx={{ justifyContent: 'space-between', px: 2 }}>
                {mode === 'edit' && (
                    <Button onClick={handleDelete} color="error">
                        Delete
                    </Button>
                )}
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button onClick={onClose}>
                        {isViewOnly ? 'Close' : 'Cancel'}
                    </Button>
                    {!isViewOnly && (
                        <Button onClick={handleSubmit} color="primary">
                            {mode === 'create' ? 'Create' : 'Save'}
                        </Button>
                    )}
                </Box>
            </DialogActions>
        </Dialog>
    );
};

export default GoalDialog; 