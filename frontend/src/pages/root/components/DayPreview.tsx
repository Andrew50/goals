import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import '../../day/Day.css';

const DayPreview: React.FC = () => {
    // Static sample tasks
    const todo = [
        { id: 1, name: 'Deep Work: Project X', time: '9:00 AM', color: '#4299e1' },
        { id: 2, name: 'Review PRs', time: '1:00 PM', color: '#48bb78' }
    ];
    const completed = [
        { id: 3, name: 'Morning Routine', time: 'All day', color: '#ed8936' }
    ];

    return (
        <Box sx={{ p: 2, height: 420, display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, flex: 1, overflow: 'hidden' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary' }}>To Do</Typography>
                        <Box component="span" className="column-count">{todo.length}</Box>
                    </Box>
                    {todo.map(item => (
                        <Paper key={item.id} className="task-card" sx={{ p: 1 }} style={{ borderLeft: `4px solid ${item.color}` }}>
                            <div className="task-content">
                                <div className="task-header">
                                    <Typography variant="body2" className="task-name" sx={{ fontSize: '0.95rem' }}>
                                        {item.name}
                                    </Typography>
                                    <span className="task-time">{item.time}</span>
                                </div>
                            </div>
                        </Paper>
                    ))}
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>Completed</Typography>
                        <Box component="span" className="column-count">{completed.length}</Box>
                    </Box>
                    {completed.map(item => (
                        <Paper key={item.id} className="task-card completed" sx={{ p: 1 }} style={{ borderLeft: `4px solid ${item.color}` }}>
                            <div className="task-content">
                                <div className="task-header">
                                    <Typography variant="body2" className="task-name completed" sx={{ fontSize: '0.95rem' }}>
                                        {item.name}
                                    </Typography>
                                    <span className="task-time">{item.time}</span>
                                </div>
                            </div>
                        </Paper>
                    ))}
                </Box>
            </Box>
        </Box>
    );
};

export default DayPreview;


