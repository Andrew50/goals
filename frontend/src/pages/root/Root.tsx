import React from "react";
import { Link } from "react-router-dom";
import {
    Container,
    Typography,
    Box,
    Button,
    Stack
} from '@mui/material';

const RootPage: React.FC = () => {
    return (
        <Container maxWidth="sm">
            <Box
                sx={{
                    marginTop: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4
                }}
            >
                <Typography component="h1" variant="h3" sx={{ fontWeight: 500 }}>
                    Goals
                </Typography>
                <Stack direction="row" spacing={2}>
                    <Button
                        component={Link}
                        to="/signin"
                        variant="contained"
                        size="large"
                    >
                        Sign In
                    </Button>
                    <Button
                        component={Link}
                        to="/signup"
                        variant="outlined"
                        size="large"
                    >
                        Sign Up
                    </Button>
                </Stack>
            </Box>
        </Container>
    );
};

export default RootPage;

