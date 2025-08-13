import React from 'react';
import { List, ListItem, ListItemText, Chip, Stack } from '@mui/material';

const ListPreview: React.FC = () => {
    return (
        <List dense>
            <ListItem>
                <ListItemText primary="Finish weekly plan" secondary="Task" />
                <Stack direction="row" spacing={1}>
                    <Chip size="small" color="error" label="High" variant="outlined" />
                </Stack>
            </ListItem>
            <ListItem>
                <ListItemText primary="Read 30 minutes" secondary="Habit" />
                <Stack direction="row" spacing={1}>
                    <Chip size="small" color="warning" label="Medium" variant="outlined" />
                </Stack>
            </ListItem>
            <ListItem>
                <ListItemText primary="Inbox zero" secondary="Workflow" />
                <Stack direction="row" spacing={1}>
                    <Chip size="small" color="default" label="Low" variant="outlined" />
                </Stack>
            </ListItem>
            <ListItem>
                <ListItemText primary="Call John" secondary="Task" />
                <Stack direction="row" spacing={1}>
                    <Chip size="small" color="warning" label="Medium" variant="outlined" />
                </Stack>
            </ListItem>
        </List>
    );
};

export default ListPreview;


