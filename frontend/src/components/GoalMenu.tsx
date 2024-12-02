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
    console.log('Component Initial Goal Duration:', goal.duration);
    const [relationshipMode, setRelationshipMode] = useState<{ type: 'child' | 'queue', parentId: number } | null>(null);
    const open = (goal: Goal, initialMode: Mode, onSuccess?: (goal: Goal) => void) => {
        console.log('Open Function Duration:', goal.duration);
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
            setRelationshipMode(null);
        }, 100);
    }


    const isViewOnly = mode === 'view';

    useEffect(() => {
        GoalMenu.open = open;
        GoalMenu.close = close;
    }, []);

    const handleChange = (newGoal: Goal) => {
        console.log('HandleChange Duration:', newGoal.duration);
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
        const submissionGoal = { ...goal };
        const timestampFields = [
            'start_timestamp',
            'end_timestamp',
            'scheduled_timestamp',
            'routine_time',
            'next_timestamp'
        ] as const;

        type TimestampField = typeof timestampFields[number];

        timestampFields.forEach((field: TimestampField) => {
            const value = submissionGoal[field];
            if (value !== undefined && value !== null) {
                // Ensure the timestamp is a number
                submissionGoal[field] = typeof value === 'string'
                    ? parseInt(value)
                    : value;
            } else {
                // If the field is undefined or null, delete it so it won't be sent
                delete submissionGoal[field];
            }
        });

        console.log('Duration before conversion:', submissionGoal.duration);

        // Convert duration from hours.minutes to total minutes before submission
        if (submissionGoal.duration) {
            // REMOVE THIS CONVERSION - it's causing the issue
            // const hours = Math.floor(submissionGoal.duration);
            // const minutes = Math.round((submissionGoal.duration % 1) * 60);
            // submissionGoal.duration = hours * 60 + minutes;

            // The duration is already in minutes, no need to convert
        } else {
            delete submissionGoal.duration;
        }

        console.log('Duration after conversion:', submissionGoal.duration);

        // Remove any undefined or null fields
        (Object.keys(submissionGoal) as Array<keyof Goal>).forEach(key => {
            if (submissionGoal[key] === undefined || submissionGoal[key] === null) {
                delete submissionGoal[key];
            }
        });

        // Add this log to see what's being sent
        console.log('Submitting goal data:', submissionGoal);

        // Existing submission logic with the cleaned goal object
        try {
            if (mode === 'create') {
                const response = await privateRequest<Goal>('goals/create', 'POST', submissionGoal);
                Object.assign(goal, response);

                if (relationshipMode) {
                    await createRelationship(
                        relationshipMode.parentId,
                        response.id!,
                        relationshipMode.type
                    );
                }
            } else if (mode === 'edit' && goal.id) {
                const response = await privateRequest<Goal>(`goals/${goal.id}`, 'PUT', submissionGoal);
            }

            if (onSuccess) {
                onSuccess(goal);
            }

            if (another) {
                const { id, ...restGoal } = goal;
                const newGoal: Goal = { ...restGoal, name: '', description: '' } as Goal;
                close();
                setTimeout(() => {
                    open(newGoal, 'create', onSuccess);
                }, 300);
            } else {
                close();
            }
        } catch (error) {
            // ... error handling ...
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
            return date.toISOString().slice(0, 10);
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
    console.log('Duration:', goal.duration);
    console.log('Duration Type:', !(!goal.duration));

    console.log('Pre-render Duration:', {
        value: goal.duration,
        type: typeof goal.duration,
        truthyCheck: !!goal.duration,
        directCheck: goal.duration ? true : false
    });

    const durationField = isViewOnly ? (
        <Box sx={{ mb: 2 }}>
            <strong>Duration:</strong> {(() => {
                const duration = goal.duration;
                console.log('Duration Field Render:', {
                    value: duration,
                    type: typeof duration,
                    truthyCheck: !!duration,
                    directCheck: duration ? true : false
                });
                return duration ? `${(duration / 60).toFixed(2)}h` : 'Not set';
            })()}
        </Box>
    ) : (
        <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
                label="Hours"
                type="number"
                value={(() => {
                    const hours = goal.duration ? Math.floor(goal.duration / 60) : '';
                    console.log('Displaying Hours:', {
                        rawDuration: goal.duration,
                        calculatedHours: hours
                    });
                    return hours;
                })()}
                onChange={(e) => {
                    const hours = e.target.value ? parseInt(e.target.value) : 0;
                    const minutes = goal.duration ? goal.duration % 60 : 0;
                    const newDuration = hours * 60 + minutes;
                    console.log('Setting Hours:', {
                        inputHours: hours,
                        existingMinutes: minutes,
                        newTotalMinutes: newDuration
                    });
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
                    console.log('Displaying Minutes:', {
                        rawDuration: goal.duration,
                        calculatedMinutes: minutes
                    });
                    return minutes;
                })()}
                onChange={(e) => {
                    const minutes = e.target.value ? parseInt(e.target.value) : 0;
                    const hours = goal.duration ? Math.floor(goal.duration / 60) : 0;
                    const newDuration = hours * 60 + minutes;
                    console.log('Setting Minutes:', {
                        existingHours: hours,
                        inputMinutes: minutes,
                        newTotalMinutes: newDuration
                    });
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
    );
    const scheduleField = isViewOnly ? (
        <>
            <Box sx={{ mb: 2 }}>
                <strong>Schedule Time:</strong> {goal.scheduled_timestamp ? new Date(goal.scheduled_timestamp).toLocaleString() : 'Not set'}
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
        </>
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
                        ? new Date(e.target.value).setHours(0, 0, 0, 0)
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
            {goal.routine_type === 'task' && (
                <>
                    {durationField}
                    <Box sx={{ mb: 2 }}>
                        <strong>Scheduled Time:</strong> {goal.routine_time ? new Date(goal.routine_time).toLocaleTimeString() : 'Not set'}
                    </Box>
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

                    <TextField
                        label="Scheduled Time"
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
                        {durationField}
                    </>
                );
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
            // Set relationship mode
            setRelationshipMode({ type: 'child', parentId: parentGoal.id! });
        }, 100);
    };

    const handleCreateQueue = () => {
        const previousGoal = goal;
        const newGoal: Goal = {} as Goal;

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
            // Set relationship mode
            setRelationshipMode({ type: 'queue', parentId: previousGoal.id! });
        }, 100);
    };

    // Add this handler function
    const handleEdit = () => {
        setMode('edit');
        setTitle('Edit Goal');
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
                            <Button onClick={handleCreateQueue} color="secondary">
                                Create Queue
                            </Button>
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
