import React, { useState, useEffect, useCallback, ChangeEvent, useMemo } from 'react';
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
    Typography,
    Autocomplete,
    Chip
} from '@mui/material';
import { createGoal, updateGoal, deleteGoal, createRelationship, updateRoutines, completeGoal, completeEvent, deleteEvent, splitEvent, createEvent } from '../utils/api';
import { Goal, GoalType, NetworkEdge, ApiGoal } from '../../types/goals';
import {
    timestampToInputString,
    inputStringToTimestamp,
    timestampToDisplayString
} from '../utils/time';
import { validateGoal, validateRelationship } from '../utils/goalValidation'
import { formatFrequency } from '../utils/frequency';
import GoalRelations from "./GoalRelations";
import { getGoalColor } from '../styles/colors';
import { goalToLocal } from '../utils/time';
import { privateRequest } from '../utils/api';
import Fuse from 'fuse.js';
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
    const [relationsOpen, setRelationsOpen] = useState(false);
    const [parentGoals, setParentGoals] = useState<Goal[]>([]);
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
    const [allGoals, setAllGoals] = useState<Goal[]>([]);
    const [selectedParent, setSelectedParent] = useState<Goal | null>(null);
    const [parentSearchQuery, setParentSearchQuery] = useState('');

    const open = useCallback((goal: Goal, initialMode: Mode, onSuccess?: (goal: Goal) => void) => {
        //create copy, might need to be date.
        const goalCopy = { ...goal }

        if (goalCopy._tz === undefined) {
            goalCopy._tz = 'user';
        }

        // Force view mode for events - they should not be directly edited
        const actualMode = goal.goal_type === 'event' ? 'view' : initialMode;

        if (actualMode === 'create' && !goalCopy.start_timestamp) {
            goalCopy.start_timestamp = new Date();
        }

        //queue relationships can only between achievements, default to achievement and force achievemnt in ui
        if (relationshipMode?.type === 'queue') {
            goalCopy.goal_type = 'achievement';
        }

        setState({
            goal: goalCopy,
            mode: actualMode,
            error: ''
        });
        setOnSuccess(() => onSuccess);
        setTitle({
            'create': 'Create New Goal',
            'edit': 'Edit Goal',
            'view': 'View Goal'
        }[actualMode]);
        setIsOpen(true);

        // If in relationship mode, set the parent
        if (relationshipMode) {
            // Find the parent goal from allGoals
            const parent = allGoals.find(g => g.id === relationshipMode.parentId);
            setSelectedParent(parent || null);
        } else {
            setSelectedParent(null);
        }

        // Fetch parent goals if we have a goal ID
        if (goal.id) {
            fetchParentGoals(goal.id);
        } else {
            setParentGoals([]);
        }
    }, [relationshipMode, setState, allGoals]);

    const close = useCallback(() => {
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
            setParentGoals([]);
            setSelectedParent(null);
            setParentSearchQuery('');
        }, 100);
    }, [setState]);

    const isViewOnly = state.mode === 'view';

    useEffect(() => {
        GoalMenu.open = open;
        GoalMenu.close = close;
    }, [open, close]);

    // Fetch all goals when dialog opens
    useEffect(() => {
        if (isOpen) {
            privateRequest<ApiGoal[]>('list').then(res => {
                setAllGoals(res.map(goalToLocal));
            }).catch(error => {
                console.error('Failed to fetch goals:', error);
            });
        }
    }, [isOpen]);

    // Create fuzzy search instance
    const fuse = useMemo(() => {
        return new Fuse(allGoals, {
            keys: ['name', 'description'],
            threshold: 0.3
        });
    }, [allGoals]);

    // Get filtered parent options based on search and validation
    const getParentOptions = useCallback(() => {
        if (!state.goal.goal_type) return [];

        // Filter out invalid parent options based on goal type
        let validGoals = allGoals.filter(g => {
            // Can't be parent of itself
            if (g.id === state.goal.id) return false;

            // Special handling for events - only tasks and routines can be parents
            if (state.goal.goal_type === 'event') {
                return g.goal_type === 'task' || g.goal_type === 'routine';
            }

            // For non-events, validate the relationship
            const error = validateRelationship(g, state.goal, 'child');
            return !error;
        });

        // Apply fuzzy search if there's a query
        if (parentSearchQuery) {
            const results = fuse.search(parentSearchQuery);
            const resultIds = new Set(results.map(r => r.item.id));
            validGoals = validGoals.filter(g => resultIds.has(g.id));
        }

        return validGoals.slice(0, 10); // Limit to 10 results
    }, [allGoals, state.goal, parentSearchQuery, fuse]);

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

        // Validate parent relationship if selected
        if (selectedParent && state.mode === 'create' && state.goal.goal_type !== 'event') {
            const relationshipError = validateRelationship(selectedParent, state.goal, 'child');
            if (relationshipError) {
                setState({
                    ...state,
                    error: relationshipError
                });
                return;
            }
        }

        // Special validation for events
        if (state.goal.goal_type === 'event' && state.mode === 'create') {
            if (!selectedParent) {
                setState({
                    ...state,
                    error: 'Events must have a parent task or routine'
                });
                return;
            }
            if (selectedParent.goal_type !== 'task' && selectedParent.goal_type !== 'routine') {
                setState({
                    ...state,
                    error: 'Events can only be created for tasks or routines'
                });
                return;
            }
        }

        try {
            let updatedGoal: Goal;
            if (state.mode === 'create') {
                if (state.goal.goal_type === 'event' && selectedParent) {
                    // Use createEvent API for events
                    updatedGoal = await createEvent({
                        parent_id: selectedParent.id!,
                        parent_type: selectedParent.goal_type,
                        scheduled_timestamp: state.goal.scheduled_timestamp || new Date(),
                        duration: state.goal.duration || 60
                    });
                } else {
                    // Use createGoal for non-events
                    updatedGoal = await createGoal(state.goal);

                    // Create parent relationship if selected (prioritize selectedParent over relationshipMode)
                    if (selectedParent) {
                        await createRelationship(
                            selectedParent.id!,
                            updatedGoal.id!,
                            'child'
                        );
                    } else if (relationshipMode) {
                        await createRelationship(
                            relationshipMode.parentId,
                            updatedGoal.id!,
                            relationshipMode.type
                        );
                    }
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
            // Special handling for events
            if (state.goal.goal_type === 'event') {
                if (state.goal.parent_type === 'routine') {
                    // For routine events, ask about deleting future occurrences
                    const deleteFuture = window.confirm('Delete only this occurrence or this and all future occurrences?\n\nOK = This and all future\nCancel = Only this occurrence');
                    await deleteEvent(state.goal.id, deleteFuture);
                } else {
                    // For regular events, just delete the single event
                    await deleteEvent(state.goal.id, false);
                }
            } else {
                // For non-events, use regular delete
                await deleteGoal(state.goal.id);
            }

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

    const handleSplitEvent = async () => {
        if (!state.goal.id || state.goal.goal_type !== 'event') {
            setState({
                ...state,
                error: 'Can only split events'
            });
            return;
        }

        try {
            const splitEvents = await splitEvent(state.goal.id);

            if (onSuccess) {
                onSuccess(state.goal);
            }

            close();

            // Optionally show a success message
            console.log(`Event split into ${splitEvents.length} parts`);
        } catch (error) {
            console.error('Failed to split event:', error);
            setState({
                ...state,
                error: error instanceof Error ? error.message : 'Failed to split event'
            });
        }
    };

    // Fetch parent goals using traversal API
    const fetchParentGoals = async (goalId: number) => {
        try {
            const hierarchyResponse = await privateRequest<ApiGoal[]>(`traversal/${goalId}`);
            // Filter to only get parent goals (those that have a child relationship to current goal)
            const networkData = await privateRequest<{ nodes: ApiGoal[]; edges: NetworkEdge[] }>('network');
            const parentIds = networkData.edges
                .filter(e => e.relationship_type === 'child' && e.to === goalId)
                .map(e => e.from);

            const parents = hierarchyResponse
                .filter(g => parentIds.includes(g.id!))
                .map(goalToLocal);

            // Sort by hierarchy level (furthest parents first)
            setParentGoals(parents);
        } catch (error) {
            console.error('Failed to fetch parent goals:', error);
            setParentGoals([]);
        }
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
            onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => handleChange({
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
                        onChange={(e: ChangeEvent<HTMLInputElement>) => {
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
                        onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
                        onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
                const rawTimestamp = state.goal.scheduled_timestamp;
                console.log(`[GoalMenu.tsx] scheduleField render: Raw timestamp=${rawTimestamp}, _tz=${state.goal._tz}`);
                const converted = timestampToInputString(rawTimestamp, 'datetime');
                console.log(`[GoalMenu.tsx] scheduleField render: Converted to input string=${converted}`);
                return converted;
            })()}
            onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
                onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
                onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange({
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
                    onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
                    onChange={(e: ChangeEvent<{ value: unknown }>) => {
                        const interval = state.goal.frequency?.match(/^\d+/)?.[0] || '1';

                        // If changing to weekly and we have a scheduled date, use its day of week
                        if (e.target.value === 'W' && state.goal.scheduled_timestamp) {
                            const date = new Date(state.goal.scheduled_timestamp);
                            const dayOfWeek = date.getDay(); // 0-6, where 0 is Sunday
                            const newFreq = `${interval}W:${dayOfWeek}`;
                            handleChange({
                                ...state.goal,
                                frequency: newFreq
                            });
                            return;
                        }

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
                                        let currentDays = state.goal.frequency?.split(':')?.[1]?.split(',').map(Number) || [];

                                        if (isSelected) {
                                            currentDays = currentDays.filter((d: number) => d !== index);
                                        } else {
                                            currentDays.push(index);
                                        }

                                        const newFreq = `${interval}W${currentDays.length ? ':' + currentDays.sort((a, b) => a - b).join(',') : ''}`;
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
                onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => handleChange({ ...state.goal, name: e.target.value })}
                fullWidth
                margin="dense"
                required={state.goal.goal_type !== 'event'}
                disabled={isViewOnly}
                placeholder={state.goal.goal_type === 'event' && selectedParent ? `Event: ${selectedParent.name}` : ''}
                helperText={state.goal.goal_type === 'event' ? 'Name will be auto-generated from parent goal' : ''}
                inputProps={{
                    spellCheck: 'false',
                    // Explicitly allow all characters
                    autoComplete: 'off'
                }}
            />
            <TextField
                label="Goal Type"
                value={state.goal.goal_type || ''}
                onChange={(e: ChangeEvent<{ value: unknown }>) => {
                    const newGoalType = e.target.value as GoalType;
                    const updates: Partial<Goal> = {
                        goal_type: newGoalType
                    };

                    // Set defaults based on goal type
                    if (newGoalType === 'event') {
                        // Events need duration and scheduled timestamp
                        if (!state.goal.duration) updates.duration = 60;
                        if (!state.goal.scheduled_timestamp) updates.scheduled_timestamp = new Date();
                    }

                    handleChange({
                        ...state.goal,
                        ...updates
                    });
                }}
                select
                fullWidth
                margin="dense"
                required
                disabled={isViewOnly || state.goal.goal_type === 'event'}
            >
                <MenuItem value="directive">Directive</MenuItem>
                <MenuItem value="project">Project</MenuItem>
                <MenuItem value="achievement">Achievement</MenuItem>
                <MenuItem value="routine">Routine</MenuItem>
                <MenuItem value="task">Task</MenuItem>
                <MenuItem value="event">Event</MenuItem>
            </TextField>
            <TextField
                label="Description"
                value={state.goal.description || ''}
                onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => handleChange({ ...state.goal, description: e.target.value })}
                fullWidth
                margin="dense"
                multiline
                disabled={isViewOnly}
                inputProps={{
                    spellCheck: 'false',
                    // Explicitly allow all characters
                    autoComplete: 'off'
                }}
            />
        </>
    );

    // Parent selector field (only in create mode, not shown for events in view mode as they have special display)
    const parentSelectorField = state.mode === 'create' ? (
        <Box sx={{ mt: 2, mb: 2 }}>
            <Autocomplete
                value={selectedParent}
                onChange={(event, newValue) => {
                    setSelectedParent(newValue);
                }}
                inputValue={parentSearchQuery}
                onInputChange={(event, newInputValue) => {
                    setParentSearchQuery(newInputValue);
                }}
                options={getParentOptions()}
                getOptionLabel={(option) => option.name}
                renderOption={(props, option) => (
                    <Box component="li" {...props}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                            <Chip
                                label={option.goal_type}
                                size="small"
                                sx={{
                                    backgroundColor: getGoalColor(option),
                                    color: 'white',
                                    fontSize: '0.75rem'
                                }}
                            />
                            <Typography variant="body2" sx={{ flexGrow: 1 }}>
                                {option.name}
                            </Typography>
                        </Box>
                    </Box>
                )}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        label={state.goal.goal_type === 'event' ? "Parent Goal (Required)" : "Parent Goal (Optional)"}
                        placeholder="Search for a parent goal..."
                        helperText={
                            state.goal.goal_type === 'event'
                                ? "Events must be associated with a task or routine"
                                : "Select a parent goal to create a relationship"
                        }
                        required={state.goal.goal_type === 'event'}
                        error={state.goal.goal_type === 'event' && !selectedParent}
                    />
                )}
                fullWidth
                clearOnBlur={false}
                selectOnFocus
                handleHomeEndKeys
                freeSolo={false}
            />
        </Box>
    ) : null;

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
                onChange={(e: ChangeEvent<{ value: unknown }>) => handleChange({
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
                            onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
            case 'event':
                // Events should display their scheduled time and duration
                return (
                    <>
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
    const handleRelations = () => { setRelationsOpen(true); };

    const handleCompletionToggle = async (completed: boolean) => {
        try {
            if (state.goal.goal_type === 'event' && !state.goal.completed && completed) {
                // For events being completed, use the event-specific completion API
                const response = await completeEvent(state.goal.id!);

                // Update the completion status
                setState({
                    ...state,
                    goal: {
                        ...state.goal,
                        completed: true
                    }
                });

                // Check if we should prompt for task completion
                if (response.should_prompt_task_completion && response.parent_task_id) {
                    if (window.confirm(`You've completed the last scheduled event for "${response.parent_task_name}". Is this task complete?`)) {
                        // Complete the parent task
                        await completeGoal(response.parent_task_id, true);
                    }
                }

                if (onSuccess) {
                    onSuccess({
                        ...state.goal,
                        completed: true
                    });
                }
            } else {
                // For all other cases (non-events or uncompleting), use regular completion
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
        <>
            <Dialog
                open={isOpen}
                onClose={close}
                maxWidth="sm"
                fullWidth
                onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
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
                    {/* Parent Goals Display */}
                    {parentGoals.length > 0 && (
                        <Box sx={{ mb: 3 }}>
                            <Typography
                                variant="subtitle2"
                                sx={{
                                    mb: 1,
                                    color: 'text.secondary',
                                    fontSize: '0.875rem'
                                }}
                            >
                                Why should I do this?
                            </Typography>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                {parentGoals.map((parent) => (
                                    <Box
                                        key={parent.id}
                                        sx={{
                                            backgroundColor: getGoalColor(parent),
                                            color: 'white',
                                            padding: '6px 12px',
                                            borderRadius: '16px',
                                            fontSize: '0.875rem',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s',
                                            '&:hover': {
                                                transform: 'translateY(-2px)',
                                                boxShadow: 2,
                                            }
                                        }}
                                        onClick={() => {
                                            close();
                                            setTimeout(() => {
                                                GoalMenu.open(parent, 'view');
                                            }, 100);
                                        }}
                                    >
                                        {parent.name}
                                    </Box>
                                ))}
                            </Box>
                        </Box>
                    )}
                    {/* Event Parent Display */}
                    {state.goal.goal_type === 'event' && state.goal.parent_type && state.goal.parent_id && (
                        <Box sx={{ mb: 3 }}>
                            <Typography
                                variant="subtitle2"
                                sx={{
                                    mb: 1,
                                    color: 'text.secondary',
                                    fontSize: '0.875rem'
                                }}
                            >
                                Event for {state.goal.parent_type}:
                            </Typography>
                            <Box sx={{
                                display: 'inline-block',
                                backgroundColor: 'action.selected',
                                padding: '6px 12px',
                                borderRadius: '16px',
                                fontSize: '0.875rem'
                            }}>
                                {state.goal.name?.replace(/^(Task|Routine): /, '')}
                            </Box>
                        </Box>
                    )}
                    {commonFields}
                    {parentSelectorField}
                    {renderTypeSpecificFields()}
                </DialogContent>
                <DialogActions sx={{ justifyContent: 'space-between', px: 2 }}>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        {state.mode === 'view' && (
                            <>
                                {state.goal.goal_type !== 'event' && (
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
                                        <Button onClick={handleRelations} color="secondary">
                                            Relationships
                                        </Button>
                                    </>
                                )}
                                {state.goal.goal_type === 'event' && (
                                    <Button onClick={handleSplitEvent} color="secondary">
                                        Split Event
                                    </Button>
                                )}
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
            {relationsOpen && <GoalRelations goal={state.goal} onClose={() => setRelationsOpen(false)} />}
        </>
    );
}

GoalMenu.open = (goal: Goal, initialMode: Mode, onSuccess?: (goal: Goal) => void) => {
    console.warn('GoalMenu not yet initialized');
}

GoalMenu.close = () => {
    console.warn('GoalMenu not yet initialized');
}

export default GoalMenu; 
