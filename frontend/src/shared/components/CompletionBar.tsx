import React from 'react';

interface CompletionBarProps {
    value: number; // 0..1
    hasTasks: boolean;
    width?: number; // px
    height?: number; // px
    minNonZeroWidth?: number; // px
    className?: string;
    style?: React.CSSProperties;
    title?: string;
}

const getColorForScore = (score: number, hasTasks: boolean): string => {
    if (!hasTasks) return 'transparent';
    if (score === 0) return 'rgb(255, 0, 0)';
    if (score <= 0.5) {
        const ratio = score * 2;
        const r = 255;
        const g = Math.round(255 * ratio);
        const b = 0;
        return `rgb(${r}, ${g}, ${b})`;
    } else {
        const ratio = (score - 0.5) * 2;
        const r = Math.round(255 * (1 - ratio));
        const g = 255;
        const b = 0;
        return `rgb(${r}, ${g}, ${b})`;
    }
};

const CompletionBar: React.FC<CompletionBarProps> = ({
    value,
    hasTasks,
    width = 60,
    height = 8,
    minNonZeroWidth = 4,
    className,
    style,
    title
}) => {
    const normalized = Math.max(0, Math.min(1, value || 0));
    let innerWidth = Math.round(width * normalized);
    if (!hasTasks) {
        innerWidth = 0;
    } else if (innerWidth === 0) {
        // Ensure a visible sliver whenever there are tasks but the bar would be 0px
        innerWidth = minNonZeroWidth;
    }

    return (
        <span style={{ display: 'inline-block', ...style }} className={className} title={title}>
            <span
                style={{
                    display: 'inline-block',
                    width: `${width}px`,
                    height: `${height}px`,
                    borderRadius: '4px',
                    backgroundColor: '#f3f4f6',
                    border: '1px solid #e5e7eb',
                    position: 'relative',
                    overflow: 'hidden',
                    verticalAlign: 'middle'
                }}
            >
                <span
                    style={{
                        display: 'block',
                        width: `${innerWidth}px`,
                        height: '100%',
                        backgroundColor: getColorForScore(normalized, hasTasks),
                        borderRadius: '4px'
                    }}
                />
            </span>
        </span>
    );
};

export default CompletionBar;


