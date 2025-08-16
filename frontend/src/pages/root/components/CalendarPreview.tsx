import React from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import '../../calendar/Calendar.css';

const CalendarPreview: React.FC = () => {
    const initialDate = '2025-05-01';
    const events = [
        { title: 'Deep Work', start: `${initialDate}T08:00:00`, end: `${initialDate}T10:00:00` },
        { title: 'Lunch', start: `${initialDate}T12:00:00`, end: `${initialDate}T13:00:00` },
        { title: 'Workout', start: `${initialDate}T18:00:00`, end: `${initialDate}T19:00:00` },
    ];

    return (
        <div style={{ height: 420 }}>
            <FullCalendar
                plugins={[timeGridPlugin]}
                initialView="timeGridDay"
                initialDate={initialDate}
                headerToolbar={false}
                allDaySlot={false}
                editable={false}
                events={events}
                height="100%"
                nowIndicator={false}
                weekNumbers={false}
                selectable={false}
                slotMinTime="06:00:00"
                slotMaxTime="22:00:00"
            />
        </div>
    );
};

export default CalendarPreview;


