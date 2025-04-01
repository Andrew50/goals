import React, { useState, useEffect, useRef } from 'react';
import { useHistoryState } from '../hooks/useHistoryState';
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
import { formatFrequency } from '../utils/frequency';
//let singletonInstance: { open: Function; close: Function } | null = null;
type Mode = 'create' | 'edit' | 'view';

interface GoalMenuComponent extends React.FC {
    open: (goal: Goal, initialMode: Mode, onSuccess?: (goal: Goal) => void) => void;
    close: () => void;
}

interface GoalMenuState {
    goal: Goal;
    error: string;
    mode: Mode;
}

const GoalMenu: GoalMenuComponent = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [state, setState] = useHistoryState<GoalMenuState>(
        {
            goal: {} as Goal,
            error: '',
            mode: 'view'
        },
        {
            hotkeyScope: 'goalMenu',
            onUndo: (newState) => {
                //console.log('Undid goal menu change');
            },
            onRedo: (newState) => {
                //console.log('Redid goal menu change');
            }
        }
    );
    const [onSuccess, setOnSuccess] = useState<((goal: Goal) => void) | undefined>();
    const [title, setTitle] = useState<string>('');
    const [relationshipMode, setRelationshipMode] = useState<{ type: 'child' | 'queue', parentId: number } | null>(null);
    const open = (goal: Goal, initialMode: Mode, onSuccess?: (goal: Goal) => void) => {
        // Create a deep copy of the goal to prevent accidental modification of the original
        const goalCopy = JSON.parse(JSON.stringify(goal));

        if (goalCopy._tz === undefined) {
            goalCopy._tz = 'user';
        }
        //console.log('GoalMenu opening with goal:', JSON.stringify(goalCopy));
        //console.log('Initial scheduled_timestamp:', goalCopy.scheduled_timestamp,
        //  'formatted:', timestampToDisplayString(goalCopy.scheduled_timestamp));

        if (initialMode === 'create' && !goalCopy.start_timestamp) {
            goalCopy.start_timestamp = Date.now();
        }

        //queue relationships can only between achievements, default to achievement and force achievemnt in ui
        if (relationshipMode?.type === 'queue') {
            goalCopy.goal_type = 'achievement';
        }

        setState({
            goal: goalCopy,
            mode: initialMode,
            error: ''
        });
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
            setState({
                goal: {} as Goal,
                error: '',
                mode: 'view'
            });
            setOnSuccess(undefined);
            setTitle('');
            setRelationshipMode(null);
        }, 100);
    }

    const isViewOnly = state.mode === 'view';

    useEffect(() => {
        GoalMenu.open = open;
        GoalMenu.close = close;
    }, []);

    const handleChange = (newGoal: Goal) => {
        // If in view mode and completion status changed, update it on the server
        if (state.mode === 'view' && newGoal.completed !== state.goal.completed) {
            handleCompletionToggle(newGoal.completed || false);
            return;
        }

        // Set default frequency if goal type is 'routine' and frequency is undefined
        if (newGoal.goal_type === 'routine' && newGoal.frequency === undefined) {
            newGoal.frequency = '1D';
        }

        // For timestamp debugging
        if (newGoal.scheduled_timestamp !== state.goal.scheduled_timestamp) {
            //console.log('Scheduled timestamp changed:',
            //  'Old:', state.goal.scheduled_timestamp,
            //  'New:', newGoal.scheduled_timestamp);
        }

        // For all other changes, update the local state
        setState({
            ...state,
            goal: newGoal
        });
    };

    const handleSubmit = async (another: boolean = false) => {
        if (another && state.mode !== 'create') {
            throw new Error('Cannot create another goal in non-create mode');
        }

        // Validation checks
        const validationErrors = validateGoal(state.goal);
        if (validationErrors.length > 0) {
            setState({
                ...state,
                error: validationErrors.join('\n')
            });
            return;
        }
        try {
            let updatedGoal: Goal;
            if (state.mode === 'create') {
                updatedGoal = await createGoal(state.goal);

                if (relationshipMode) {
                    await createRelationship(
                        relationshipMode.parentId,
                        updatedGoal.id!,
                        relationshipMode.type
                    );
                }
            } else if (state.mode === 'edit' && state.goal.id) {
                updatedGoal = await updateGoal(state.goal.id, state.goal);
            } else {
                throw new Error('Invalid mode or missing goal ID');
            }
            setState({
                ...state,
                goal: updatedGoal
            });
            if (state.goal.goal_type === 'routine') {
                await updateRoutines(); //update routines to make sure new one is good
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
            setState({
                ...state,
                error: error instanceof Error ? error.message : 'Failed to submit goal'
            });
        }
    };

    const handleDelete = async () => {
        if (!state.goal.id) {
            setState({
                ...state,
                error: 'Cannot delete goal without ID'
            });
            return;
        }
        try {
            await deleteGoal(state.goal.id);
            if (onSuccess) {
                onSuccess(state.goal);
            }
            close();
        } catch (error) {
            console.error('Failed to delete goal:', error);
            setState({
                ...state,
                error: error instanceof Error ? error.message : 'Failed to delete goal'
            });
        }
    };

    const handleCreateChild = () => {
        const parentGoal = state.goal;
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
                    setState({
                        ...state,
                        error: 'Failed to create child relationship'
                    });
                }
            });
            setRelationshipMode({ type: 'child', parentId: parentGoal.id! });
        }, 100);
    };

    const handleCreateQueue = () => {
        const previousGoal = state.goal;
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
                    setState({
                        ...state,
                        error: 'Failed to create queue relationship'
                    });
                }
            });
            setRelationshipMode({ type: 'queue', parentId: previousGoal.id! });
        }, 100);
    };

    const priorityField = isViewOnly ? (
        <Box sx={{ mb: 2 }}>
            <strong>Priority:</strong> {state.goal.priority ? state.goal.priority.charAt(0).toUpperCase() + state.goal.priority.slice(1) : 'Not set'}
        </Box>
    ) : (
        <TextField
            label="Priority"
            select
            value={state.goal.priority || ''}
            onChange={(e) => handleChange({
                ...state.goal,
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
                const duration = state.goal.duration;
                if (!duration) return 'Not set';
                if (duration === 1440) return 'All Day';
                const hours = Math.floor(duration / 60);
                const minutes = duration % 60;
                return `${hours}h ${minutes}m`;
            })()}
        </Box>
    ) : (
        <Box>
            <FormControlLabel
                control={
                    <Checkbox
                        checked={state.goal.duration === 1440}
                        onChange={(e) => {
                            handleChange({
                                ...state.goal,
                                duration: e.target.checked ? 1440 : 60 // Default to 1 hour when unchecking
                            });
                        }}
                    />
                }
                label="All Day"
            />
            {state.goal.duration !== 1440 && (
                <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                    <TextField
                        label="Hours"
                        type="number"
                        value={(() => {
                            const hours = state.goal.duration ? Math.floor(state.goal.duration / 60) : '';
                            return hours;
                        })()}
                        onChange={(e) => {
                            const hours = e.target.value ? parseInt(e.target.value) : 0;
                            const minutes = state.goal.duration ? state.goal.duration % 60 : 0;
                            const newDuration = hours * 60 + minutes;
                            handleChange({
                                ...state.goal,
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
                            const minutes = state.goal.duration ? state.goal.duration % 60 : '';
                            return minutes;
                        })()}
                        onChange={(e) => {
                            const minutes = e.target.value ? parseInt(e.target.value) : 0;
                            const hours = state.goal.duration ? Math.floor(state.goal.duration / 60) : 0;
                            const newDuration = hours * 60 + minutes;
                            handleChange({
                                ...state.goal,
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
            <strong>Scheduled Date:</strong> {timestampToDisplayString(state.goal.scheduled_timestamp)}
        </Box>
    ) : (
        <TextField
            label="Schedule Date"
            type="datetime-local"
            value={(() => {
                const converted = timestampToInputString(state.goal.scheduled_timestamp, 'datetime');
                //console.log('Rendering scheduled field:',
                //  'Raw timestamp:', state.goal.scheduled_timestamp,
                //  'Converted to input:', converted);
                return converted;
            })()}
            onChange={(e) => {
                const inputValue = e.target.value;
                const newTimestamp = inputStringToTimestamp(inputValue, 'datetime');
                //console.log('Schedule date changed:',
                //  'Input value:', inputValue,
                //  'Converted timestamp:', newTimestamp);
                handleChange({
                    ...state.goal,
                    scheduled_timestamp: newTimestamp
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
                <strong>Start Date:</strong> {timestampToDisplayString(state.goal.start_timestamp, 'date')}
            </Box>
            <Box sx={{ mb: 2 }}>
                <strong>End Date:</strong> {timestampToDisplayString(state.goal.end_timestamp, 'date')}
            </Box>
        </>
    ) : (
        <>
            <TextField
                label="Start Date"
                type="date"
                value={timestampToInputString(state.goal.start_timestamp, 'date')}
                onChange={(e) => {
                    handleChange({
                        ...state.goal,
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
                value={timestampToInputString(state.goal.end_timestamp, 'date')}
                onChange={(e) => {
                    handleChange({
                        ...state.goal,
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
                    checked={state.goal.completed || false}
                    onChange={(e) => handleChange({
                        ...state.goal,
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
            <strong>Frequency:</strong> {formatFrequency(state.goal.frequency)}
        </Box>
    ) : (
        <Box sx={{ mb: 2 }}>
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                mb: state.goal.frequency?.includes('W') ? 2 : 0
            }}>
                <Typography>Repeat every</Typography>
                <TextField
                    value={(() => {
                        const match = state.goal.frequency?.match(/^(\d+)[DWMY]/);
                        return match ? match[1] : '1';
                    })()}
                    onChange={(e) => {
                        const value = e.target.value;
                        const unit = state.goal.frequency?.match(/[DWMY]/)?.[0] || 'W';
                        const days = state.goal.frequency?.split(':')?.[1] || '';
                        const newFreq = `${value}${unit}${days ? ':' + days : ''}`;
                        //console.log(newFreq);
                        handleChange({
                            ...state.goal,
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
                    value={state.goal.frequency?.match(/[DWMY]/)?.[0] || 'D'}
                    onChange={(e) => {
                        const interval = state.goal.frequency?.match(/^\d+/)?.[0] || '1';
                        const days = e.target.value === 'W' && state.goal.frequency?.includes('W')
                            ? (state.goal.frequency?.split(':')?.[1] ? ':' + state.goal.frequency.split(':')[1] : '')
                            : '';
                        const newFreq = `${interval}${e.target.value}${days}`;
                        //console.log(newFreq);
                        handleChange({
                            ...state.goal,
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

            {state.goal.frequency?.includes('W') && (
                <Box>
                    <Typography sx={{ mb: 1 }}>Repeat on</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => {
                            const days = state.goal.frequency?.split(':')?.[1]?.split(',').map(Number) || [];
                            const isSelected = days.includes(index);

                            return (
                                <Box
                                    key={index}
                                    onClick={() => {
                                        const interval = state.goal.frequency?.match(/^\d+/)?.[0] || '1';
                                        let days = state.goal.frequency?.split(':')?.[1]?.split(',').map(Number) || [];

                                        if (isSelected) {
                                            days = days.filter(d => d !== index);
                                        } else {
                                            days.push(index);
                                        }

                                        const newFreq = `${interval}W${days.length ? ':' + days.sort().join(',') : ''}`;
                                        //console.log(newFreq);
                                        handleChange({
                                            ...state.goal,
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
                <strong>Name:</strong> {state.goal.name || 'Not set'}
            </Box>
            <Box sx={{ mb: 2 }}>
                <strong>Goal Type:</strong> {state.goal.goal_type ? state.goal.goal_type.charAt(0).toUpperCase() + state.goal.goal_type.slice(1) : 'Not set'}
            </Box>
            <Box sx={{ mb: 2 }}>
                <strong>Description:</strong> {state.goal.description || 'Not set'}
            </Box>
        </>
    ) : (
        <>
            <TextField
                label="Name"
                value={state.goal.name || ''}
                onChange={(e) => handleChange({ ...state.goal, name: e.target.value })}
                fullWidth
                margin="dense"
                required
                disabled={isViewOnly}
            />
            <TextField
                label="Goal Type"
                value={state.goal.goal_type || ''}
                onChange={(e) => handleChange({
                    ...state.goal,
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
                label="Description"
                value={state.goal.description || ''}
                onChange={(e) => handleChange({ ...state.goal, description: e.target.value })}
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
                <strong>Routine Type:</strong> {state.goal.routine_type ? state.goal.routine_type.charAt(0).toUpperCase() + state.goal.routine_type.slice(1) : 'Not set'}
            </Box>
            {state.goal.routine_type === 'task' && (
                <>
                    {durationField}
                    {state.goal.duration !== 1440 && (
                        <Box sx={{ mb: 2 }}>
                            <strong>Scheduled Time:</strong> {timestampToDisplayString(state.goal.routine_time, 'time')}
                        </Box>
                    )}
                </>
            )}
        </>
    ) : (
        <>
            <TextField
                label="Routine Type"
                value={state.goal.routine_type || ''}
                onChange={(e) => handleChange({
                    ...state.goal,
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
            {state.goal.routine_type === 'task' && (
                <>
                    {durationField}
                    {state.goal.duration !== 1440 && (
                        <TextField
                            label="Scheduled Time"
                            type="time"
                            value={timestampToInputString(state.goal.routine_time, 'time')}
                            onChange={(e) => {
                                handleChange({
                                    ...state.goal,
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
        if (!state.goal.goal_type) return null;
        const project_and_achievement_fields = (
            <>
                {priorityField}
                {dateFields}
                {completedField}
            </>
        );
        switch (state.goal.goal_type) {
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
        setState({
            ...state,
            mode: 'edit'
        });
        setTitle('Edit Goal');
    };
    const handleCompletionToggle = async (completed: boolean) => {
        try {
            const completion = await completeGoal(state.goal.id!, completed);
            // Only update the completion status
            setState({
                ...state,
                goal: {
                    ...state.goal,
                    completed: completion
                }
            });

            if (onSuccess) {
                onSuccess({
                    ...state.goal,
                    completed: completion
                });
            }
        } catch (error) {
            console.error('Failed to update completion status:', error);
            setState({
                ...state,
                error: 'Failed to update completion status'
            });
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
                {state.error && (
                    <Box sx={{ color: 'error.main', mb: 2 }}>
                        {state.error}
                    </Box>
                )}
                {commonFields}
                {renderTypeSpecificFields()}
            </DialogContent>
            <DialogActions sx={{ justifyContent: 'space-between', px: 2 }}>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    {state.mode === 'view' && (
                        <>

                            <Button onClick={handleCreateChild} color="secondary">
                                Create Child
                            </Button>
                            {state.goal.goal_type === 'achievement' && (
                                <Button onClick={handleCreateQueue} color="secondary">
                                    Create Queue
                                </Button>
                            )}
                            <Button onClick={handleEdit} color="primary">
                                Edit
                            </Button>
                        </>
                    )}
                    {state.mode === 'edit' && (
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
                            {state.mode === 'create' ? 'Create' : 'Save'}
                        </Button>
                    )}
                    {state.mode === 'create' && (
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
