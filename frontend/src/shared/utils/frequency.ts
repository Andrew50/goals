export function formatFrequency(frequency: string | undefined): string {
    if (!frequency) return 'Not set';
    const match = frequency.match(/^(\d+)([DWMY])(?::(.+))?$/);
    if (!match) return frequency;

    const [_, interval, unit, days] = match;
    let text = `Every ${interval} `;

    switch (unit) {
        case 'D':
            text += interval === '1' ? 'day' : 'days';
            break;
        case 'W':
            text += interval === '1' ? 'week' : 'weeks';
            if (days) {
                const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const selectedDays = days.split(',').map(d => dayNames[Number(d)]);
                text += ` on ${selectedDays.join(', ')}`;
            }
            break;
        case 'M':
            text += interval === '1' ? 'month' : 'months';
            break;
        case 'Y':
            text += interval === '1' ? 'year' : 'years';
            break;
    }

    return text;
} 