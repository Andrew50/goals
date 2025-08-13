import React from 'react';
import { Box, Typography } from '@mui/material';
import { Goal } from '../../../types/goals';
import { getGoalStyle } from '../../../shared/styles/colors';

const NodeBox: React.FC<{ goal: Goal; sx?: any }> = ({ goal, sx }) => {
    const { backgroundColor, border, textColor } = getGoalStyle(goal);
    return (
        <Box sx={{
            px: 1,
            py: 0.5,
            border,
            borderRadius: 1,
            bgcolor: backgroundColor,
            color: textColor,
            fontSize: 12,
            maxWidth: 160,
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
            ...sx
        }}>
            {goal.name}
        </Box>
    );
};

const NetworkPreview: React.FC = () => {
    // Single focused cluster, minimal children for clarity
    const parent: Goal = { id: 1, name: 'Project Alpha', goal_type: 'project' } as Goal;
    const children: Goal[] = [
        { id: 2, name: 'Design Spec', goal_type: 'task', priority: 'high' } as Goal,
        { id: 3, name: 'Weekly Standup', goal_type: 'routine', priority: 'medium' } as Goal
    ];

    return (
        <Box sx={{ p: 2, height: 420, position: 'relative' }}>
            <Box sx={{ position: 'relative', height: '100%' }}>
                <NodeBox goal={parent} sx={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)' }} />

                {/* Children nodes (kept minimal to avoid clutter) */}
                <NodeBox goal={children[0]} sx={{ position: 'absolute', bottom: 32, left: '38%', transform: 'translateX(-50%)' }} />
                <NodeBox goal={children[1]} sx={{ position: 'absolute', bottom: 32, left: '62%', transform: 'translateX(-50%)' }} />

                {/* Connectors */}
                <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
                    <line x1="50%" y1="52" x2="38%" y2="188" stroke="#94a3b8" strokeWidth="2" />
                    <line x1="50%" y1="52" x2="62%" y2="188" stroke="#94a3b8" strokeWidth="2" />
                </svg>

                <Typography variant="caption" color="text.secondary" sx={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)' }}>
                    Preview of relationships (colors match goal types)
                </Typography>
            </Box>
        </Box>
    );
};

export default NetworkPreview;


