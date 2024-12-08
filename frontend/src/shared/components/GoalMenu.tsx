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
    Box,
    Switch,
    Typography,
    Chip
} from '@mui/material';
import { createGoal, updateGoal, deleteGoal, createRelationship, updateRoutines, completeGoal } from '../utils/api';
import { Goal, GoalType, RelationshipType } from '../../types/goals';
import {
    timestampToInputString,
    inputStringToTimestamp,
    timestampToDisplayString
} from '../utils/time';
import { validateGoal } from '../utils/goalValidation'
//let singletonInstance: { open: Function; close: Function } | null = null;
type Mode = 'create' | 'edit' | 'view';

interface GoalMenuComponent extends React.FC {
    open: (goal: Goal, initialMode: Mode, onSuccess?: (goal: Goal) => void) => void;
    close: () => void;
}


const GoalMenu: GoalMenuComponent = () => {
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
        const validationErrors = validateGoal(goal);
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
            <strong>Schedule Time:</strong> {timestampToDisplayString(goal.scheduled_timestamp)}
        </Box>
    ) : (
        <TextField
            label="Schedule Date"
            type="datetime-local"
            value={timestampToInputString(goal.scheduled_timestamp, 'datetime')}
            onChange={(e) => {
                handleChange({
                    ...goal,
                    scheduled_timestamp: inputStringToTimestamp(e.target.value, 'datetime')
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
                <strong>Start Date:</strong> {timestampToDisplayString(goal.start_timestamp, 'date')}
            </Box>
            <Box sx={{ mb: 2 }}>
                <strong>End Date:</strong> {timestampToDisplayString(goal.end_timestamp, 'date')}
            </Box>
        </>
    ) : (
        <>
            <TextField
                label="Start Date"
                type="date"
                value={timestampToInputString(goal.start_timestamp, 'date')}
                onChange={(e) => {
                    handleChange({
                        ...goal,
                        start_timestamp: inputStringToTimestamp(e.target.value, "date")
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
                value={timestampToInputString(goal.end_timestamp, 'date')}
                onChange={(e) => {
                    handleChange({
                        ...goal,
                        end_timestamp: inputStringToTimestamp(e.target.value, 'end-date')
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
    const frequencyField = isViewOnly ? (
        <Box sx={{ mb: 2 }}>
            <strong>Frequency:</strong> {(() => {
                if (!goal.frequency) return 'Not set';
                const match = goal.frequency.match(/^(\d+)([DWMY])(?::(.+))?$/);
                if (!match) return goal.frequency;

                const [_, interval, unit, days] = match;
                let text = `Every ${interval} `;

                switch (unit) {
                    case 'D': text += interval === '1' ? 'day' : 'days'; break;
                    case 'W':
                        text += interval === '1' ? 'week' : 'weeks';
                        if (days) {
                            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                            const selectedDays = days.split(',').map(d => dayNames[Number(d)]);
                            text += ` on ${selectedDays.join(', ')}`;
                        }
                        break;
                    case 'M': text += interval === '1' ? 'month' : 'months'; break;
                    case 'Y': text += interval === '1' ? 'year' : 'years'; break;
                }

                return text;
            })()}
        </Box>
    ) : (
        <Box sx={{ mb: 2 }}>
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                mb: goal.frequency?.includes('W') ? 2 : 0
            }}>
                <Typography>Repeat every</Typography>
                <TextField
                    value={(() => {
                        const match = goal.frequency?.match(/^(\d+)[DWMY]/);
                        return match ? match[1] : '1';
                    })()}
                    onChange={(e) => {
                        const value = e.target.value;
                        const unit = goal.frequency?.match(/[DWMY]/)?.[0] || 'W';
                        const days = goal.frequency?.split(':')?.[1] || '';
                        const newFreq = `${value}${unit}${days ? ':' + days : ''}`;
                        console.log(newFreq);
                        handleChange({
                            ...goal,
                            frequency: newFreq
                        });
                    }}
                    type="number"
                    inputProps={{
                        min: 1,
                        style: {
                            width: '60px',
                            padding: '8px',
                            textAlign: 'center'
                        }
                    }}
                    variant="outlined"
                    size="small"
                />
                <TextField
                    select
                    value={goal.frequency?.match(/[DWMY]/)?.[0] || 'D'}
                    onChange={(e) => {
                        const interval = goal.frequency?.match(/^\d+/)?.[0] || '1';
                        const days = e.target.value === 'W' && goal.frequency?.includes('W')
                            ? (goal.frequency?.split(':')?.[1] ? ':' + goal.frequency.split(':')[1] : '')
                            : '';
                        const newFreq = `${interval}${e.target.value}${days}`;
                        console.log(newFreq);
                        handleChange({
                            ...goal,
                            frequency: newFreq
                        });
                    }}
                    sx={{ minWidth: 120 }}
                    size="small"
                >
                    <MenuItem value="D">day</MenuItem>
                    <MenuItem value="W">week</MenuItem>
                    <MenuItem value="M">month</MenuItem>
                    <MenuItem value="Y">year</MenuItem>
                </TextField>
            </Box>

            {goal.frequency?.includes('W') && (
                <Box>
                    <Typography sx={{ mb: 1 }}>Repeat on</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => {
                            const days = goal.frequency?.split(':')?.[1]?.split(',').map(Number) || [];
                            const isSelected = days.includes(index);

                            return (
                                <Box
                                    key={index}
                                    onClick={() => {
                                        const interval = goal.frequency?.match(/^\d+/)?.[0] || '1';
                                        let days = goal.frequency?.split(':')?.[1]?.split(',').map(Number) || [];

                                        if (isSelected) {
                                            days = days.filter(d => d !== index);
                                        } else {
                                            days.push(index);
                                        }

                                        const newFreq = `${interval}W${days.length ? ':' + days.sort().join(',') : ''}`;
                                        console.log(newFreq);
                                        handleChange({
                                            ...goal,
                                            frequency: newFreq
                                        });
                                    }}
                                    sx={{
                                        width: 36,
                                        height: 36,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        borderRadius: '50%',
                                        cursor: 'pointer',
                                        bgcolor: isSelected ? 'primary.main' : 'action.selected',
                                        color: isSelected ? 'primary.contrastText' : 'text.primary',
                                        '&:hover': {
                                            bgcolor: isSelected ? 'primary.dark' : 'action.selected',
                                        }
                                    }}
                                >
                                    {day}
                                </Box>
                            );
                        })}
                    </Box>
                </Box>
            )}
        </Box>
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
                            <strong>Scheduled Time:</strong> {timestampToDisplayString(goal.routine_time, 'time')}
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
                            value={timestampToInputString(goal.routine_time, 'time')}
                            onChange={(e) => {
                                handleChange({
                                    ...goal,
                                    routine_time: inputStringToTimestamp(e.target.value, 'time')
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
