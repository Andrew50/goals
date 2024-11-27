import React, { useState, useEffect, useRef } from 'react';
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
import { Goal, GoalType, RelationshipType } from '../types';
//let singletonInstance: { open: Function; close: Function } | null = null;
type Mode = 'create' | 'edit' | 'view';
export const createRelationship = async (fromId: number, toId: number, relationshipType: RelationshipType) => {
    try {
        return await privateRequest('goals/relationship', 'POST', {
            from_id: fromId,
            to_id: toId,
            relationship_type: relationshipType
        });
    } catch (error: any) {
        if (error.response && error.response.status === 500) {
            console.error('Error creating relationship:', error.response.data);
        } else {
            console.error('Error creating relationship:', error);
        }
        throw error;
    }
};

interface GoalMenuComponent extends React.FC {
    open: (goal: Goal, initialMode: Mode, onSuccess?: (goal: Goal) => void) => void;
    close: () => void;
}


const GoalMenu: GoalMenuComponent = () => {
    //const singletonInstanceRef = useRef<{ open: Function; close: Function } | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [goal, setGoal] = useState<Goal>({} as Goal);
    const [mode, setMode] = useState<Mode>('view');
    const [error, setError] = useState<string>('');
    const [onSuccess, setOnSuccess] = useState<((goal: Goal) => void) | undefined>();
    const [title, setTitle] = useState<string>('');
    const open = (goal: Goal, initialMode: Mode, onSuccess?: (goal: Goal) => void) => {
        if (initialMode === 'create' && !goal.start_timestamp) {
            goal.start_timestamp = Date.now();
        }
        console.log('GoalMenu open called', goal);
        setGoal(goal);
        setMode(initialMode);
        setOnSuccess(() => onSuccess);
        setTitle({
            'create': 'Create New Goal',
            'edit': 'Edit Goal',
            'view': 'View Goal'
        }[initialMode]);
        setIsOpen(true);
    }
    const close = () => {
        console.log('GoalMenu close called');
        setIsOpen(false);
        setTimeout(() => {
            setGoal({} as Goal);
            setError('');
            setOnSuccess(undefined);
            setTitle('');
            setMode('view');
        }, 100);
    }


    const isViewOnly = mode === 'view';

    useEffect(() => {
        GoalMenu.open = open;
        GoalMenu.close = close;
    }, []);

    const handleChange = (newGoal: Goal) => {
        setGoal(newGoal);
    }

    const handleSubmit = async (another: boolean = false) => {
        if (another && mode !== 'create') {
            throw new Error('Cannot create another goal in non-create mode');
        }
        const validationErrors: string[] = [];

        if (!goal.goal_type) {
            validationErrors.push('Goal type is required');
        }

        if (!goal.name) {
            validationErrors.push('Name is required');
        }

        // Additional type-specific validations
        if (goal.goal_type) {
            switch (goal.goal_type) {
                case 'routine':
                    if (!goal.frequency) {
                        validationErrors.push('Frequency is required for routine goals');
                    }
                    break;
                case 'task':
                    if (!goal.duration) {
                        validationErrors.push('Duration is required for task goals');
                    }
                    break;
                case 'project':
                case 'achievement':
                    if (!goal.start_timestamp) {
                        validationErrors.push('Start timestamp is required for project and achievement goals');
                    }
                    break;
            }
        }

        if (validationErrors.length > 0) {
            setError(validationErrors.join('\n'));
            return;
        }

        // Existing submission logic
        if (mode === 'create') {
            console.log('Attempting to create goal with data:', goal);
            const response = await privateRequest<Goal>('goals/create', 'POST', goal);
            Object.assign(goal, response);
        } else if (mode === 'edit' && goal.id) {
            const response = await privateRequest<Goal>(`goals/${goal.id}`, 'PUT', goal);
        }

        if (onSuccess) {
            onSuccess(goal);
        }
        if (!another) {
            close();
        }
    };

    const handleDelete = async () => {
        if (goal.id) {
            try {
                await privateRequest(`goals/${goal.id}`, 'DELETE');
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to delete goal');
                throw err;
            }
            if (onSuccess) {
                onSuccess(goal);
            }
            close();
        }
    };
    ;
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


    //const PriorityField = () => {
    //return
    const priorityField = isViewOnly ? (
        <Box sx={{ mb: 2 }}>
            <strong>Priority:</strong> {goal.priority ? goal.priority.charAt(0).toUpperCase() + goal.priority.slice(1) : 'Not set'}
        </Box>
    ) : (
        <TextField
            label="Priority"
            select
            value={goal.priority || ''}
            onChange={(e) => handleChange({
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
    //};

    //const ScheduleField = () => {
    const scheduleField = isViewOnly ? (
        <>
            <Box sx={{ mb: 2 }}>
                <strong>Schedule Time:</strong> {goal.scheduled_timestamp ? new Date(goal.scheduled_timestamp).toLocaleString() : 'Not set'}
            </Box>
            <Box sx={{ mb: 2 }}>
                <strong>Duration:</strong> {goal.duration ? `${goal.duration} hours` : 'Not set'}
            </Box>
        </>
    ) : (
        <>
            <TextField
                label="Schedule Date"
                type="datetime-local"
                value={formatDateForInput(goal.scheduled_timestamp)}
                onChange={(e) => {
                    const timestamp = e.target.value
                        ? parseInt(String(new Date(e.target.value).getTime()))
                        : undefined;
                    handleChange({
                        ...goal,
                        scheduled_timestamp: timestamp
                    });
                }}
                fullWidth
                margin="dense"
                InputLabelProps={{ shrink: true }}
                disabled={isViewOnly}
            />
            <TextField
                label="Duration (hours)"
                type="number"
                value={goal.duration || ''}
                onChange={(e) => {
                    const duration = e.target.value ? parseFloat(e.target.value) : undefined;
                    handleChange({
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

    const dateFields = isViewOnly ? (
        <>
            <Box sx={{ mb: 2 }}>
                <strong>Start Date:</strong> {goal.start_timestamp ? new Date(goal.start_timestamp).toLocaleString() : 'Not set'}
            </Box>
            <Box sx={{ mb: 2 }}>
                <strong>End Date:</strong> {goal.end_timestamp ? new Date(goal.end_timestamp).toLocaleString() : 'Not set'}
            </Box>
        </>
    ) : (
        <>
            <TextField
                label="Start Date"
                type="datetime-local"
                value={formatDateForInput(goal.start_timestamp)}
                onChange={(e) => {
                    const timestamp = e.target.value
                        ? parseInt(String(new Date(e.target.value).getTime()))
                        : undefined;
                    handleChange({
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
                    handleChange({
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

    const completedField = (
        <FormControlLabel
            control={
                <Checkbox
                    checked={goal.completed || false}
                    onChange={(e) => handleChange({
                        ...goal,
                        completed: e.target.checked
                    })}
                    disabled={isViewOnly}
                />
            }
            label="Completed"
        />
    );
    const frequencyMap: { [key: string]: string } = {
        'P1D': 'Daily',
        'P7D': 'Weekly',
        'P14D': 'Bi-weekly',
        'P1M': 'Monthly',
        'P3M': 'Quarterly',
        'P1Y': 'Yearly'
    };

    const frequencyField = isViewOnly ? (
        <Box sx={{ mb: 2 }}>
            <strong>Frequency:</strong> {goal.frequency ? frequencyMap[goal.frequency] : 'Not set'}
        </Box>
    ) : (
        <TextField
            label="Frequency"
            value={goal.frequency || ''}
            onChange={(e) => handleChange({
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

    const commonFields = isViewOnly ? (
        <>
            <Box sx={{ mb: 2 }}>
                <strong>Goal Type:</strong> {goal.goal_type ? goal.goal_type.charAt(0).toUpperCase() + goal.goal_type.slice(1) : 'Not set'}
            </Box>
            <Box sx={{ mb: 2 }}>
                <strong>Name:</strong> {goal.name || 'Not set'}
            </Box>
            <Box sx={{ mb: 2 }}>
                <strong>Description:</strong> {goal.description || 'Not set'}
            </Box>
        </>
    ) : (
        <>
            <TextField
                label="Goal Type"
                value={goal.goal_type || ''}
                onChange={(e) => handleChange({
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
            <TextField
                label="Name"
                value={goal.name || ''}
                onChange={(e) => handleChange({ ...goal, name: e.target.value })}
                fullWidth
                margin="dense"
                required
                disabled={isViewOnly}
            />
            <TextField
                label="Description"
                value={goal.description || ''}
                onChange={(e) => handleChange({ ...goal, description: e.target.value })}
                fullWidth
                margin="dense"
                multiline
                disabled={isViewOnly}
            />
        </>
    );

    const routineFields = isViewOnly ? (
        <>
            <Box sx={{ mb: 2 }}>
                <strong>Routine Type:</strong> {goal.routine_type ? goal.routine_type.charAt(0).toUpperCase() + goal.routine_type.slice(1) : 'Not set'}
            </Box>
            <Box sx={{ mb: 2 }}>
                <strong>Routine Name:</strong> {goal.routine_name || 'Not set'}
            </Box>
            <Box sx={{ mb: 2 }}>
                <strong>Routine Description:</strong> {goal.routine_description || 'Not set'}
            </Box>
            <Box sx={{ mb: 2 }}>
                <strong>Routine Duration:</strong> {goal.routine_duration ? `${goal.routine_duration} minutes` : 'Not set'}
            </Box>
            <Box sx={{ mb: 2 }}>
                <strong>Routine Time:</strong> {goal.routine_time ? new Date(goal.routine_time).toLocaleTimeString() : 'Not set'}
            </Box>
        </>
    ) : (
        <>
            <TextField
                label="Routine Type"
                value={goal.routine_type || ''}
                onChange={(e) => handleChange({
                    ...goal,
                    routine_type: e.target.value as "task" | "achievement"
                })}
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
                onChange={(e) => handleChange({
                    ...goal,
                    routine_name: e.target.value
                })}
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
                onChange={(e) => handleChange({
                    ...goal,
                    routine_description: e.target.value
                })}
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
                onChange={(e) => handleChange({
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
                    handleChange({
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
    )
    const renderTypeSpecificFields = () => {
        if (!goal.goal_type) return null;

        const project_and_achievement_fields = (
            <>
                {priorityField}
                {dateFields}
                {completedField}
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
                        {priorityField}
                        {frequencyField}
                        {dateFields}
                        {routineFields}
                    </>
                );
            case 'task':
                return (
                    <>
                        {priorityField}
                        {dateFields}
                        {scheduleField}
                    </>
                );
        }
    };

    return (
        <Dialog
            open={isOpen}
            onClose={close}
            maxWidth="sm"
            fullWidth
            onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !isViewOnly) {
                    event.preventDefault();
                    handleSubmit();
                }
            }}
        >
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                {error && (
                    <Box sx={{ color: 'error.main', mb: 2 }}>
                        {error}
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
                    <Button onClick={close}>
                        {isViewOnly ? 'Close' : 'Cancel'}
                    </Button>
                    {!isViewOnly && (
                        <Button onClick={() => handleSubmit()} color="primary">
                            {mode === 'create' ? 'Create' : 'Save'}
                        </Button>
                    )}
                    {mode === 'create' && (
                        <Button onClick={() => handleSubmit(true)} color="primary">
                            Create Another
                        </Button>
                    )}
                </Box>
            </DialogActions>
        </Dialog>
    );
};
GoalMenu.open = (goal: Goal, initialMode: Mode, onSuccess?: (goal: Goal) => void) => {
    console.warn('GoalMenu not yet initialized');
}

GoalMenu.close = () => {
    console.warn('GoalMenu not yet initialized');
}

export default GoalMenu; 
