import React from 'react';
import { Button, ButtonProps } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

interface NewButtonProps extends Omit<ButtonProps, 'startIcon' | 'children'> {
    label?: string;
}

const NewButton: React.FC<NewButtonProps> = ({ label = 'New', ...props }) => {
    return (
        <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            size="medium"
            {...props}
        >
            {label}
        </Button>
    );
};

export default NewButton;
