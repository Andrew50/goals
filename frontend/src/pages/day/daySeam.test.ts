import {
    buildTimeline,
    cardAlignActions,
    getEventEndMs,
    TimedEvent,
} from './daySeam';

const MIN = 60_000;

const event = (id: number, start: number, duration: number): TimedEvent => ({
    id,
    scheduled_timestamp: start,
    duration,
});

describe('card align arrows', () => {
    const start = 1_700_000_000_000;

    test('bottom arrow grows the end across a gap and top arrow pulls the start back', () => {
        const upper = event(1, start, 60);
        const lower = event(2, start + 120 * MIN, 60);
        const timeline = buildTimeline([upper, lower], null);
        const eventsById = new Map<number, TimedEvent>([[1, upper], [2, lower]]);

        expect(cardAlignActions(upper, timeline, eventsById, null)?.bottom).toEqual({
            edge: 'end',
            points: 'down',
            duration: 120,
            boundaryMs: lower.scheduled_timestamp,
        });
        expect(cardAlignActions(upper, timeline, eventsById, null)?.top).toBeNull();
        expect(cardAlignActions(lower, timeline, eventsById, null)?.top).toEqual({
            edge: 'start',
            points: 'up',
            duration: 120,
            scheduledMs: getEventEndMs(upper),
            boundaryMs: getEventEndMs(upper),
        });
        expect(cardAlignActions(lower, timeline, eventsById, null)?.bottom).toBeNull();
    });

    test('an overlap puts an up arrow on the bottom of the earlier block and a down arrow on the top of the later block', () => {
        const upper = event(1, start, 120);
        const lower = event(2, start + 60 * MIN, 120);
        const timeline = buildTimeline([upper, lower], null);
        const eventsById = new Map<number, TimedEvent>([[1, upper], [2, lower]]);

        expect(cardAlignActions(upper, timeline, eventsById, null)?.bottom).toEqual({
            edge: 'end',
            points: 'up',
            duration: 60,
            boundaryMs: lower.scheduled_timestamp,
        });
        expect(cardAlignActions(upper, timeline, eventsById, null)?.top).toBeNull();
        expect(cardAlignActions(lower, timeline, eventsById, null)?.top).toEqual({
            edge: 'start',
            points: 'down',
            duration: 60,
            scheduledMs: getEventEndMs(upper),
            boundaryMs: getEventEndMs(upper),
        });
        expect(cardAlignActions(lower, timeline, eventsById, null)?.bottom).toBeNull();
    });

    test('offers nothing when the edges already meet', () => {
        const upper = event(1, start, 60);
        const lower = event(2, getEventEndMs(upper), 60);
        const timeline = buildTimeline([upper, lower], null);
        const eventsById = new Map<number, TimedEvent>([[1, upper], [2, lower]]);

        expect(cardAlignActions(upper, timeline, eventsById, null)).toBeNull();
        expect(cardAlignActions(lower, timeline, eventsById, null)).toBeNull();
    });

    test('a block that runs past now gets an up arrow on the bottom that ends it at now', () => {
        const earlier = event(1, start, 30);
        const current = event(2, start + 60 * MIN, 120);
        const now = start + 90 * MIN;
        const timeline = buildTimeline([earlier, current], now);
        const eventsById = new Map<number, TimedEvent>([[1, earlier], [2, current]]);

        expect(timeline).toEqual([
            { type: 'event', id: 1 },
            { type: 'event', id: 2 },
            { type: 'now' },
        ]);
        expect(cardAlignActions(current, timeline, eventsById, now)?.bottom).toEqual({
            edge: 'end',
            points: 'up',
            duration: 30,
            boundaryMs: now,
        });
        expect(cardAlignActions(current, timeline, eventsById, now)?.top).toEqual({
            edge: 'start',
            points: 'up',
            duration: 150,
            scheduledMs: getEventEndMs(earlier),
            boundaryMs: getEventEndMs(earlier),
        });
    });
});
