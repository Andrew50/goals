import React, { useState } from 'react';
import {
    Card,
    CardContent,
    Typography,
    Button,
    Box,
    Checkbox,
    IconButton,
    Chip,
    Dialog
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import CloseIcon from '@mui/icons-material/Close';
import { Goal, GoalType } from './frontend/src/types';
import GoalDialog from './frontend/src/components/GoalMenu';
import { privateRequest } from './frontend/src/utils/api';

interface GoalViewProps {
    goal: Goal;
    onClose: () => void;
    onUpdate?: (updatedGoal: Goal) => void;
}

const GoalView: React.FC<GoalViewProps> = ({ goal, onClose, onUpdate }) => {
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [currentGoal, setCurrentGoal] = useState<Goal>(goal);

    const handleCompletionToggle = async () => {
        const updatedGoal = await privateRequest<Goal>(`goals/${goal.id}`, 'PUT', { ...currentGoal, completed: !currentGoal.completed });
        setCurrentGoal(updatedGoal);
        onUpdate?.(updatedGoal);
    };

    const formatDate = (timestamp: number | undefined): string => {
        if (!timestamp) return 'Not set';
        try {
            return new Date(timestamp).toLocaleString();
        } catch {
            return 'Invalid date';
        }
    };

    const renderGoalInfo = () => {
        return (
            <>
                {currentGoal.priority && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Typography variant="body2" color="textSecondary" component="span">
                            Priority:
                        </Typography>
                        <Chip size="small" label={currentGoal.priority} />
                    </Box>
                )}
                {currentGoal.start_timestamp && (
                    <Typography variant="body2" color="textSecondary">
                        Start: {formatDate(currentGoal.start_timestamp)}
                    </Typography>
                )}
                {currentGoal.end_timestamp && (
                    <Typography variant="body2" color="textSecondary">
                        End: {formatDate(currentGoal.end_timestamp)}
                    </Typography>
                )}
                {currentGoal.frequency && (
                    <Typography variant="body2" color="textSecondary">
                        Frequency: {currentGoal.frequency}
                    </Typography>
                )}
                {currentGoal.next_timestamp && (
                    <Typography variant="body2" color="textSecondary">
                        Next Due: {formatDate(currentGoal.next_timestamp)}
                    </Typography>
                )}
                {currentGoal.routine_name && (
                    <Typography variant="body2" color="textSecondary">
                        Routine Name: {currentGoal.routine_name}
                    </Typography>
                )}
                {currentGoal.routine_description && (
                    <Typography variant="body2" color="textSecondary">
                        Routine Description: {currentGoal.routine_description}
                    </Typography>
                )}
                {currentGoal.routine_type && (
                    <Typography variant="body2" color="textSecondary">
                        Routine Type: {currentGoal.routine_type}
                    </Typography>
                )}
                {currentGoal.routine_duration && (
                    <Typography variant="body2" color="textSecondary">
                        Routine Duration: {currentGoal.routine_duration}
                    </Typography>
                )}
                {currentGoal.routine_time && (
                    <Typography variant="body2" color="textSecondary">
                        Routine Time: {currentGoal.routine_time}
                    </Typography>
                )}
                {currentGoal.scheduled_timestamp && (
                    <Typography variant="body2" color="textSecondary">
                        Scheduled: {formatDate(currentGoal.scheduled_timestamp)}
                    </Typography>
                )}
                {currentGoal.duration && (
                    <Typography variant="body2" color="textSecondary">
                        Duration: {currentGoal.duration}
                    </Typography>
                )}
            </>
        );
    };

    return (
        <Dialog open={true} onClose={onClose} maxWidth="sm" fullWidth>
            <Card>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
                    <IconButton onClick={() => setEditDialogOpen(true)} sx={{ mr: 1 }}>
                        <EditIcon />
                    </IconButton>
                    <IconButton onClick={onClose}>
                        <CloseIcon />
                    </IconButton>
                </Box>
                <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                        <Typography variant="h5" component="div">
                            {currentGoal.name}
                        </Typography>
                        {currentGoal.goal_type === 'achievement' || currentGoal.goal_type === 'task' && (
                            <Checkbox
                                checked={currentGoal.completed || false}
                                onChange={handleCompletionToggle}
                                sx={{ ml: 'auto' }}
                            />
                        )}
                    </Box>

                    <Typography variant="body2" color="textSecondary" gutterBottom>
                        Type: <Chip size="small" label={currentGoal.goal_type} />
                    </Typography>

                    {currentGoal.description && (
                        <Typography variant="body1" sx={{ mb: 2 }}>
                            {currentGoal.description}
                        </Typography>
                    )}

                    <Box sx={{ mt: 2 }}>
                        {renderGoalInfo()}
                    </Box>
                </CardContent>
            </Card>

            {editDialogOpen && (
                <GoalDialog
                    open={editDialogOpen}
                    onClose={() => setEditDialogOpen(false)}
                    goal={currentGoal}
                    onChange={(updatedGoal: Partial<Goal>) =>
                        setCurrentGoal({ ...currentGoal, ...updatedGoal } as Goal)}
                    mode="edit"
                    error=""
                    onSuccess={() => {
                        setEditDialogOpen(false);
                        onUpdate?.(currentGoal);
                    }}
                />
            )}
        </Dialog>
    );
};

export default GoalView;
