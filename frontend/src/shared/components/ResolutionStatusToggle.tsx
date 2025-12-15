import React from 'react';
import { ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BlockIcon from '@mui/icons-material/Block';
import CancelIcon from '@mui/icons-material/Cancel';
import { ResolutionStatus } from '../../types/goals';

export interface ResolutionStatusToggleProps {
  value: ResolutionStatus;
  onChange: (value: ResolutionStatus) => void;
  disabled?: boolean;
  size?: 'small' | 'medium';
  ariaLabel?: string;
  dense?: boolean;
}

const ResolutionStatusToggle: React.FC<ResolutionStatusToggleProps> = ({
  value,
  onChange,
  disabled = false,
  size = 'small',
  ariaLabel = 'Set status',
  dense = true,
}) => {
  const theme = useTheme();

  const colorFor = (status: ResolutionStatus): string => {
    switch (status) {
      case 'completed':
        return theme.palette.success.main;
      case 'failed':
        return theme.palette.error.main;
      case 'skipped':
        return theme.palette.warning.main;
      case 'pending':
      default:
        return theme.palette.text.secondary;
    }
  };

  const buttonSx = (status: ResolutionStatus) => {
    const c = colorFor(status);
    return {
      minWidth: 0,
      px: dense ? 0.75 : 1,
      py: dense ? 0.25 : 0.5,
      borderColor: 'divider',
      color: theme.palette.text.secondary,
      '& .MuiSvgIcon-root': { fontSize: 18 },
      '&.Mui-selected': {
        color: c,
        bgcolor: alpha(c, 0.14),
      },
      '&.Mui-selected:hover': {
        bgcolor: alpha(c, 0.2),
      },
    } as const;
  };

  return (
    <ToggleButtonGroup
      exclusive
      size={size}
      value={value}
      onChange={(_, next) => {
        if (!next) return;
        onChange(next as ResolutionStatus);
      }}
      aria-label={ariaLabel}
      disabled={disabled}
      sx={{
        borderRadius: 999,
        overflow: 'hidden',
        '& .MuiToggleButtonGroup-grouped': {
          m: 0,
          borderRadius: 0,
          '&:not(:first-of-type)': {
            borderLeft: '1px solid',
            borderLeftColor: 'divider',
          },
        },
      }}
    >
      <Tooltip title="Pending" arrow>
        <ToggleButton value="pending" aria-label="Mark as pending" sx={buttonSx('pending')}>
          <RadioButtonUncheckedIcon />
        </ToggleButton>
      </Tooltip>
      <Tooltip title="Completed" arrow>
        <ToggleButton value="completed" aria-label="Mark as completed" sx={buttonSx('completed')}>
          <CheckCircleIcon />
        </ToggleButton>
      </Tooltip>
      <Tooltip title="Skipped" arrow>
        <ToggleButton value="skipped" aria-label="Mark as skipped" sx={buttonSx('skipped')}>
          <BlockIcon />
        </ToggleButton>
      </Tooltip>
      <Tooltip title="Failed" arrow>
        <ToggleButton value="failed" aria-label="Mark as failed" sx={buttonSx('failed')}>
          <CancelIcon />
        </ToggleButton>
      </Tooltip>
    </ToggleButtonGroup>
  );
};

export default ResolutionStatusToggle;


