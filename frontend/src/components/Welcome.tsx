import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Container,
    Paper,
    Typography,
    Box,
    Button,
    List,
    ListItem,
    ListItemIcon,
    ListItemText
} from '@mui/material';
import {
    CalendarMonth,
    AccountTree,
    FormatListBulleted,
    Today,
} from '@mui/icons-material';

const Welcome: React.FC = () => {
    const navigate = useNavigate();

    return (
        <Container component="main" maxWidth="md">
            <Box
                sx={{
                    marginTop: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                }}
            >
                <Paper elevation={3} sx={{ p: 4, width: '100%' }}>
                    <Typography component="h1" variant="h4" sx={{ mb: 4, textAlign: 'center' }}>
                        Welcome to Goals!
                    </Typography>

                    <Typography variant="body1" sx={{ mb: 4 }}>
                        Thank you for signing up! Here's a quick overview of how to use the application:
                    </Typography>

                    <List sx={{ mb: 4 }}>
                        <ListItem>
                            <ListItemIcon>
                                <AccountTree color="primary" />
                            </ListItemIcon>
                            <ListItemText
                                primary="Network View"
                                secondary="Visualize and manage your goals in a hierarchical network. Create relationships between goals and see how they connect."
                            />
                        </ListItem>

                        <ListItem>
                            <ListItemIcon>
                                <CalendarMonth color="primary" />
                            </ListItemIcon>
                            <ListItemText
                                primary="Calendar View"
                                secondary="Plan and schedule your tasks and goals across time. Drag and drop to reschedule items."
                            />
                        </ListItem>

                        <ListItem>
                            <ListItemIcon>
                                <FormatListBulleted color="primary" />
                            </ListItemIcon>
                            <ListItemText
                                primary="List View"
                                secondary="See all your goals in a simple list format. Great for quick overview and management."
                            />
                        </ListItem>
                    </List>

                    <Button
                        type="button"
                        fullWidth
                        variant="contained"
                        sx={{ mt: 3, mb: 2 }}
                        onClick={() => navigate('/signin')}
                    >
                        Sign In
                    </Button>
                </Paper>
            </Box>
        </Container>
    );
};

export default Welcome; 