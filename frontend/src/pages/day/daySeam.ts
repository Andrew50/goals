export const DEFAULT_DURATION_MINUTES = 60;

export interface TimedEvent {
    id: number;
    scheduled_timestamp: number;
    duration?: number;
}

export type SeamAnchor = { type: 'event'; id: number } | { type: 'now' };

export const isAllDay = (event: { duration?: number }) => event.duration === 1440;

export const getEventStartMs = (event: { scheduled_timestamp: number }) => event.scheduled_timestamp;

export const getEventDurationMinutes = (event: { duration?: number }) => event.duration ?? DEFAULT_DURATION_MINUTES;

export const getEventDurationMs = (event: { duration?: number }) => getEventDurationMinutes(event) * 60_000;

export const getEventEndMs = (event: TimedEvent) => getEventStartMs(event) + getEventDurationMs(event);

/** Timed events in start order, with the now marker inserted the same way the day list inserts it. */
export function buildTimeline(events: TimedEvent[], nowMs: number | null): SeamAnchor[] {
    const timed = events
        .filter((event) => !isAllDay(event))
        .slice()
        .sort((a, b) => getEventStartMs(a) - getEventStartMs(b) || a.id - b.id);

    const items: SeamAnchor[] = timed.map((event) => ({ type: 'event', id: event.id }));
    if (nowMs == null) return items;

    const insertAt = timed.findIndex((event) => nowMs < getEventStartMs(event));
    items.splice(insertAt === -1 ? items.length : insertAt, 0, { type: 'now' });
    return items;
}

export interface DownPlan {
    duration: number;
}

export interface UpPlan {
    scheduledMs: number;
    duration: number;
}

/** Keep the start. Move the end onto the boundary. */
export function planMeetDown(event: TimedEvent, boundaryMs: number): DownPlan | null {
    const minutes = Math.round((boundaryMs - getEventStartMs(event)) / 60_000);
    if (minutes <= 0) return null;
    if (minutes === getEventDurationMinutes(event)) return null;
    return { duration: minutes };
}

/** Keep the end. Move the start onto the boundary. */
export function planMeetUp(event: TimedEvent, boundaryMs: number): UpPlan | null {
    const end = getEventEndMs(event);
    const minutes = Math.round((end - boundaryMs) / 60_000);
    if (minutes <= 0) return null;
    const scheduledMs = end - minutes * 60_000;
    if (scheduledMs === getEventStartMs(event) && minutes === getEventDurationMinutes(event)) return null;
    return { scheduledMs, duration: minutes };
}

export type AlignUpdate =
    | { edge: 'end'; points: 'up' | 'down'; duration: number; boundaryMs: number }
    | { edge: 'start'; points: 'up' | 'down'; scheduledMs: number; duration: number; boundaryMs: number };

export interface CardAlignActions {
    top: AlignUpdate | null;
    bottom: AlignUpdate | null;
}

function neighborBoundary(
    anchor: SeamAnchor,
    edge: 'start' | 'end',
    eventsById: { get(id: number): TimedEvent | undefined },
    nowMs: number | null,
): number | null {
    if (anchor.type === 'now') return nowMs;
    const neighbor = eventsById.get(anchor.id);
    if (!neighbor) return null;
    return edge === 'start' ? getEventStartMs(neighbor) : getEventEndMs(neighbor);
}

/**
 * The top arrow changes the start. The bottom arrow changes the end.
 * The icon points the way that time moves: up is earlier, down is later.
 * Now is a zero-length neighbor in the same timeline.
 */
export function cardAlignActions(
    event: TimedEvent,
    timeline: SeamAnchor[],
    eventsById: { get(id: number): TimedEvent | undefined },
    nowMs: number | null,
): CardAlignActions | null {
    if (isAllDay(event)) return null;
    const index = timeline.findIndex((item) => item.type === 'event' && item.id === event.id);
    if (index === -1) return null;

    const previous = index > 0 ? timeline[index - 1] : null;
    const next = index < timeline.length - 1 ? timeline[index + 1] : null;
    const previousBoundary = previous ? neighborBoundary(previous, 'end', eventsById, nowMs) : null;
    const nextBoundary = next ? neighborBoundary(next, 'start', eventsById, nowMs) : null;
    const start = getEventStartMs(event);
    const end = getEventEndMs(event);

    let top: AlignUpdate | null = null;
    let bottom: AlignUpdate | null = null;

    if (previousBoundary != null) {
        const plan = planMeetUp(event, previousBoundary);
        if (plan && plan.scheduledMs !== start) {
            top = {
                edge: 'start',
                points: plan.scheduledMs < start ? 'up' : 'down',
                scheduledMs: plan.scheduledMs,
                duration: plan.duration,
                boundaryMs: previousBoundary,
            };
        }
    }

    if (nextBoundary != null) {
        const plan = planMeetDown(event, nextBoundary);
        if (plan) {
            const newEnd = start + plan.duration * 60_000;
            if (newEnd !== end) {
                bottom = {
                    edge: 'end',
                    points: newEnd < end ? 'up' : 'down',
                    duration: plan.duration,
                    boundaryMs: nextBoundary,
                };
            }
        }
    }

    if (!top && !bottom) return null;
    return { top, bottom };
}
