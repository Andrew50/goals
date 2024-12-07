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
import { createGoal, updateGoal, deleteGoal, createRelationship, updateRoutines, completeGoal } from '../utils/api';
import { Goal, GoalType, RelationshipType } from '../../types/goals';
//let singletonInstance: { open: Function; close: Function } | null = null;
type Mode = 'create' | 'edit' | 'view';

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
    const [relationshipMode, setRelationshipMode] = useState<{ type: 'child' | 'queue', parentId: number } | null>(null);
    const open = (goal: Goal, initialMode: Mode, onSuccess?: (goal: Goal) => void) => {
        if (goal._tz === undefined) {
            goal._tz = 'user';
        }
        console.log('open', goal);
        if (initialMode === 'create' && !goal.start_timestamp) {
            goal.start_timestamp = Date.now();
        }

        //queue relationships can only between achievements, default to achievement and force achievemnt in ui
        if (relationshipMode?.type === 'queue') {
            goal.goal_type = 'achievement';
        }

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
        setIsOpen(false);
        setTimeout(() => {
            setGoal({} as Goal);
            setError('');
            setOnSuccess(undefined);
            setTitle('');
            setMode('view');
            setRelationshipMode(null);
        }, 100);
    }


    const isViewOnly = mode === 'view';

    useEffect(() => {
        GoalMenu.open = open;
        GoalMenu.close = close;
    }, []);

    const handleChange = (newGoal: Goal) => {
        // If in view mode and completion status changed, update it on the server
        if (mode === 'view' && newGoal.completed !== goal.completed) {
            handleCompletionToggle(newGoal.completed || false);
            return; // Don't call setGoal here as handleCompletionToggle will do it
        }

        // For all other changes, update the local state
        setGoal(newGoal);
    };

    const handleSubmit = async (another: boolean = false) => {
        if (another && mode !== 'create') {
            throw new Error('Cannot create another goal in non-create mode');
        }

        // Validation checks
        const validationErrors: string[] = [];
        if (!goal.goal_type) {
            validationErrors.push('Goal type is required');
        }
        if (!goal.name) {
            validationErrors.push('Name is required');
        }
        if (goal.goal_type) {
            switch (goal.goal_type) {
                case 'routine':
                    if (!goal.frequency) {
                        validationErrors.push('Frequency is required');
                    }
                    if (!goal.start_timestamp) {
                        validationErrors.push('Start Date is required');
                    }
                    if (!goal.routine_type) {
                        validationErrors.push('Routine type is required');
                    }
                    if (goal.routine_type === "task" && !goal.duration) {
                        validationErrors.push('Duration is required')
                    }
                    break;
                case 'task':
                    if (!goal.duration) {
                        validationErrors.push('Duration is required');
                    }
                    break;
                case 'project':
                case 'achievement':
                    if (!goal.start_timestamp) {
                        validationErrors.push('Start Date is required');
                    }
                    break;
            }
        }
        if (validationErrors.length > 0) {
            setError(validationErrors.join('\n'));
            return;
        }

        try {
            let updatedGoal: Goal;

            if (mode === 'create') {
                updatedGoal = await createGoal(goal);

                if (relationshipMode) {
                    await createRelationship(
                        relationshipMode.parentId,
                        updatedGoal.id!,
                        relationshipMode.type
                    );
                }
            } else if (mode === 'edit' && goal.id) {
                updatedGoal = await updateGoal(goal.id, goal);
            } else {
                throw new Error('Invalid mode or missing goal ID');
            }

            // Update the local state with the response
            setGoal(updatedGoal);

            if (goal.goal_type === 'routine') {
                await updateRoutines();
            }

            if (onSuccess) {
                onSuccess(updatedGoal);
            }

            if (another) {
                const { id, ...restGoal } = updatedGoal;
                const newGoal: Goal = { ...restGoal, name: '', description: '' } as Goal;
                close();
                setTimeout(() => {
                    open(newGoal, 'create', onSuccess);
                }, 300);
            } else {
                close();
            }
        } catch (error) {
            console.error('Failed to submit goal:', error);
            setError(error instanceof Error ? error.message : 'Failed to submit goal');
        }
    };

    const handleDelete = async () => {
        if (!goal.id) {
            setError('Cannot delete goal without ID');
            return;
        }

        try {
            await deleteGoal(goal.id);
            if (onSuccess) {
                onSuccess(goal);
            }
            close();
        } catch (error) {
            console.error('Failed to delete goal:', error);
            setError(error instanceof Error ? error.message : 'Failed to delete goal');
        }
    };

    const handleCreateChild = () => {
        const parentGoal = goal;
        const newGoal: Goal = {} as Goal;

        close();
        setTimeout(() => {
            open(newGoal, 'create', async (createdGoal: Goal) => {
                try {
                    await createRelationship(parentGoal.id!, createdGoal.id!, 'child');
                    if (onSuccess) {
                        onSuccess(parentGoal);
                    }
                } catch (error) {
                    console.error('Failed to create child relationship:', error);
                    setError('Failed to create child relationship');
                }
            });
            setRelationshipMode({ type: 'child', parentId: parentGoal.id! });
        }, 100);
    };

    const handleCreateQueue = () => {
        const previousGoal = goal;
        const newGoal: Goal = { goal_type: 'achievement' } as Goal;

        close();
        setTimeout(() => {
            open(newGoal, 'create', async (createdGoal: Goal) => {
                try {
                    await createRelationship(previousGoal.id!, createdGoal.id!, 'queue');
                    if (onSuccess) {
                        onSuccess(previousGoal);
                    }
                } catch (error) {
                    console.error('Failed to create queue relationship:', error);
                    setError('Failed to create queue relationship');
                }
            });
            setRelationshipMode({ type: 'queue', parentId: previousGoal.id! });
        }, 100);
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
    const durationField = isViewOnly ? (
        <Box sx={{ mb: 2 }}>
            <strong>Duration:</strong> {(() => {
                const duration = goal.duration;
                if (!duration) return 'Not set';
                return duration === 1440 ? 'All Day' : `${(duration / 60).toFixed(2)}h`;
            })()}
        </Box>
    ) : (
        <Box>
            <FormControlLabel
                control={
                    <Checkbox
                        checked={goal.duration === 1440}
                        onChange={(e) => {
                            handleChange({
                                ...goal,
                                duration: e.target.checked ? 1440 : 60 // Default to 1 hour when unchecking
                            });
                        }}
                    />
                }
                label="All Day"
            />

            {goal.duration !== 1440 && (
                <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                    <TextField
                        label="Hours"
                        type="number"
                        value={(() => {
                            const hours = goal.duration ? Math.floor(goal.duration / 60) : '';
                            return hours;
                        })()}
                        onChange={(e) => {
                            const hours = e.target.value ? parseInt(e.target.value) : 0;
                            const minutes = goal.duration ? goal.duration % 60 : 0;
                            const newDuration = hours * 60 + minutes;
                            handleChange({
                                ...goal,
                                duration: newDuration
                            });
                        }}
                        margin="dense"
                        InputLabelProps={{ shrink: true }}
                        inputProps={{
                            min: 0,
                            step: 1
                        }}
                        disabled={isViewOnly}
                        sx={{ width: '50%' }}
                    />
                    <TextField
                        label="Minutes"
                        type="number"
                        value={(() => {
                            const minutes = goal.duration ? goal.duration % 60 : '';
                            return minutes;
                        })()}
                        onChange={(e) => {
                            const minutes = e.target.value ? parseInt(e.target.value) : 0;
                            const hours = goal.duration ? Math.floor(goal.duration / 60) : 0;
                            const newDuration = hours * 60 + minutes;
                            handleChange({
                                ...goal,
                                duration: newDuration
                            });
                        }}
                        margin="dense"
                        InputLabelProps={{ shrink: true }}
                        inputProps={{
                            min: 0,
                            max: 59,
                            step: 1
                        }}
                        disabled={isViewOnly}
                        sx={{ width: '50%' }}
                    />
                </Box>
            )}
        </Box>
    );
    const scheduleField = isViewOnly ? (
        <Box sx={{ mb: 2 }}>
            <strong>Schedule Time:</strong> {goal.scheduled_timestamp ? new Date(goal.scheduled_timestamp).toISOString().slice(0, 16).replace('T', ' ') : 'Not set'}
        </Box>
    ) : (
        <TextField
            label="Schedule Date"
            type="datetime-local"
            value={formatDateForInput(goal.scheduled_timestamp)}
            onChange={(e) => {
                const timestamp = e.target.value
                    ? new Date(e.target.value).getTime()
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
    );

    const dateFields = isViewOnly ? (
        <>
            <Box sx={{ mb: 2 }}>
                <strong>Start Date:</strong> {goal.start_timestamp ? new Date(goal.start_timestamp).toLocaleDateString() : 'Not set'}
            </Box>
            <Box sx={{ mb: 2 }}>
                <strong>End Date:</strong> {goal.end_timestamp ? new Date(goal.end_timestamp).toLocaleDateString() : 'Not set'}
            </Box>
        </>
    ) : (
        <>
            <TextField
                label="Start Date"
                type="date"
                value={formatDateForInput(goal.start_timestamp)}
                onChange={(e) => {
                    const timestamp = e.target.value
                        ? new Date(e.target.value + 'T00:00:00').getTime()
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
                type="date"
                value={formatDateForInput(goal.end_timestamp)}
                onChange={(e) => {
                    const timestamp = e.target.value
                        ? new Date(e.target.value).setHours(23, 59, 59, 999)
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
                //disabled={isViewOnly}
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
                {/*relationshipMode?.type === 'queue' ? (
                    <MenuItem value="achievement">Achievement</MenuItem>
                ) : (
                    <>*/}
                <MenuItem value="directive">Directive</MenuItem>
                <MenuItem value="project">Project</MenuItem>
                <MenuItem value="achievement">Achievement</MenuItem>
                <MenuItem value="routine">Routine</MenuItem>
                <MenuItem value="task">Task</MenuItem>
                {/*</>
                )*/}
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
            {goal.routine_type === 'task' && (
                <>
                    {durationField}
                    {goal.duration !== 1440 && (
                        <Box sx={{ mb: 2 }}>
                            <strong>Scheduled Time:</strong> {goal.routine_time ?
                                new Intl.DateTimeFormat('default', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hour12: true,
                                    timeZone: 'UTC'
                                }).format(goal.routine_time)
                                : 'Not set'}
                        </Box>
                    )}
                </>
            )}
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
            {goal.routine_type === 'task' && (
                <>
                    {durationField}
                    {goal.duration !== 1440 && (
                        <TextField
                            label="Scheduled Time"
                            type="time"
                            value={goal.routine_time ? new Date(goal.routine_time).toISOString().substr(11, 5) : ''}
                            onChange={(e) => {
                                console.log(e.target.value);
                                const [hours, minutes] = e.target.value.split(':').map(Number);
                                const timeInMs = ((hours * 60 * 60) + (minutes * 60)) * 1000;
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
                    )}
                </>
            )}
        </>
    );

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
                        {dateFields}
                        {frequencyField}
                        {routineFields}
                    </>
                );
            case 'task':
                return (
                    <>
                        {priorityField}
                        {dateFields}
                        {scheduleField}
                        {durationField}
                        {completedField}
                    </>
                );
        }
    };

    const handleEdit = () => {
        setMode('edit');
        setTitle('Edit Goal');
    };
    const handleCompletionToggle = async (completed: boolean) => {
        try {
            const completion = await completeGoal(goal.id!, completed);
            // Only update the completion status
            setGoal(prev => ({
                ...prev,
                completed: completion
            }));

            if (onSuccess) {
                onSuccess({
                    ...goal,
                    completed: completion
                });
            }
        } catch (error) {
            console.error('Failed to update completion status:', error);
            setError('Failed to update completion status');
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
                <Box sx={{ display: 'flex', gap: 1 }}>
                    {mode === 'view' && (
                        <>

                            <Button onClick={handleCreateChild} color="secondary">
                                Create Child
                            </Button>
                            {goal.goal_type === 'achievement' && (
                                <Button onClick={handleCreateQueue} color="secondary">
                                    Create Queue
                                </Button>
                            )}
                            <Button onClick={handleEdit} color="primary">
                                Edit
                            </Button>
                        </>
                    )}
                    {mode === 'edit' && (
                        <Button onClick={handleDelete} color="error">
                            Delete
                        </Button>
                    )}
                </Box>
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
