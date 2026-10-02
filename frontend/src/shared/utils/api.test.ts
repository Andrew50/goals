import axios from 'axios';
import {
    completeEvent,
    completeGoal,
    createEvent,
    createGoal,
    createRelationship,
    deleteEvent,
    deleteGCalEvent,
    deleteGoal,
    deleteRelationship,
    duplicateGoal,
    expandTaskDateRange,
    getAccessToken,
    getAutofillSuggestions,
    getGCalSettings,
    getGoalRelations,
    getGoalSubgraph,
    getGoogleCalendars,
    getGoogleStatus,
    getNotificationSettings,
    getRescheduleOptions,
    getSmartScheduleOptions,
    getTaskEvents,
    getTelegramSettings,
    getThemeSettings,
    onAccessTokenChange,
    privateRequest,
    publicRequest,
    recomputeRoutineFuture,
    refreshAccessToken,
    resetGCalSyncState,
    resolveGCalConflict,
    resolveGoal,
    sendTelegramTest,
    setAccessToken,
    syncBidirectionalGoogleCalendar,
    syncFromGoogleCalendar,
    syncToGoogleCalendar,
    unlinkGoogleAccount,
    updateEvent,
    updateGCalSettings,
    updateGoal,
    updateNotificationSettings,
    updateRoutineEvent,
    updateRoutineEventProperties,
    updateRoutines,
    updateTelegramSettings,
    updateThemeSettings,
} from './api';
import { forceLogout } from './authEvents';

const API = (process.env.REACT_APP_API_URL || 'http://localhost:8080').replace(/\/+$/, '');

jest.mock('axios', () => {
    const state = {
        request: async () => ({ data: { id: 1, name: 'Goal', goal_type: 'task' } }),
        post: async () => ({ data: { token: 'access-token', username: 'ada' } }),
        handlers: null as { ok: (response: any) => any; err: (error: any) => any } | null,
    };
    const axiosFn: any = (config?: any) => state.request(config);
    axiosFn.post = (...args: any[]) => state.post(...args);
    axiosFn.get = async () => ({ data: {} });
    axiosFn.put = async () => ({ data: {} });
    axiosFn.delete = async () => ({ data: {} });
    axiosFn.defaults = {
        timeout: 0,
        headers: { common: {} as Record<string, string> },
        withCredentials: false,
    };
    axiosFn.interceptors = {
        response: {
            use: (ok: any, err: any) => {
                state.handlers = { ok, err };
                return 0;
            },
        },
    };
    axiosFn.create = () => axiosFn;
    axiosFn.__state = state;
    return { __esModule: true, default: axiosFn };
});

const mockAxiosState = (axios as any).__state as {
    request: (config?: any) => Promise<any>;
    post: (...args: any[]) => Promise<any>;
    handlers: { ok: (response: any) => any; err: (error: any) => any } | null;
};

const apiGoal = {
    id: 7,
    name: 'Alpha',
    goal_type: 'task',
    scheduled_timestamp: 1_700_000_000_000,
    start_timestamp: 1_700_000_000_000,
    end_timestamp: 1_700_000_100_000,
};

function goal() {
    return {
        id: 7,
        name: 'Alpha',
        goal_type: 'task' as const,
        scheduled_timestamp: new Date(1_700_000_000_000),
    };
}

describe('api', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    beforeEach(() => {
        localStorage.clear();
        setAccessToken(null);
        mockAxiosState.request = async () => ({ data: { ...apiGoal } });
        mockAxiosState.post = async () => ({ data: { token: 'access-token', username: 'ada' } });
    });

    test('stores the access token in memory and notifies listeners', () => {
        const seen: Array<string | null> = [];
        const unsubscribe = onAccessTokenChange((token) => seen.push(token));
        setAccessToken('mem');
        expect(getAccessToken()).toBe('mem');
        unsubscribe();
        setAccessToken('later');
        expect(seen).toEqual(['mem']);
        expect(getAccessToken()).toBe('later');
    });

    test('reads a test-mode token and ignores storage failures', () => {
        localStorage.setItem('testMode', 'true');
        localStorage.setItem('authToken', 'stored');
        expect(getAccessToken()).toBe('stored');

        localStorage.removeItem('authToken');
        expect(getAccessToken()).toBeNull();

        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        setAccessToken('fallback');
        expect(getAccessToken()).toBe('fallback');
    });

    test('refreshes a session, shares one in-flight request, and clears a bad response', async () => {
        let resolvePost: (value: any) => void = () => {};
        mockAxiosState.post = () => new Promise((resolve) => {
            resolvePost = resolve;
        });
        const first = refreshAccessToken();
        const second = refreshAccessToken();
        resolvePost({ data: { token: 'fresh', username: 'ada' } });
        await expect(first).resolves.toEqual({ token: 'fresh', username: 'ada' });
        await expect(second).resolves.toEqual({ token: 'fresh', username: 'ada' });
        expect(getAccessToken()).toBe('fresh');
        expect(localStorage.getItem('username')).toBe('ada');

        mockAxiosState.post = async () => ({ data: { token: '' } });
        await expect(refreshAccessToken()).resolves.toBeNull();
        expect(getAccessToken()).toBeNull();

        mockAxiosState.post = async () => ({ data: { token: 'only-token' } });
        await expect(refreshAccessToken()).resolves.toEqual({ token: 'only-token', username: undefined });

        mockAxiosState.post = async () => {
            throw new Error('offline');
        };
        await expect(refreshAccessToken()).resolves.toBeNull();
    });

    test('ignores a username storage failure during refresh', async () => {
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        await expect(refreshAccessToken()).resolves.toEqual({ token: 'access-token', username: 'ada' });
        expect(getAccessToken()).toBe('access-token');
    });

    test('sends a private request with a bearer token and optional timeout', async () => {
        setAccessToken('abc');
        const configs: any[] = [];
        mockAxiosState.request = async (config) => {
            configs.push(config);
            return { data: { ok: true } };
        };
        await expect(privateRequest('goals', 'POST', { a: 1 }, { q: 2 }, 5000)).resolves.toEqual({ ok: true });
        expect(configs[0].headers.Authorization).toBe('Bearer abc');
        expect(configs[0].timeout).toBe(5000);
        expect(configs[0].url).toBe(`${API}/goals`);

        setAccessToken(null);
        await privateRequest('goals');
        expect(configs[1].headers.Authorization).toBeUndefined();
        expect(configs[1].timeout).toBeUndefined();
    });

    test('ends the session on a 401 that was not already retried', async () => {
        localStorage.setItem('username', 'ada');
        localStorage.setItem('authToken', 'old');
        let logouts = 0;
        window.addEventListener('app:force-logout', () => {
            logouts += 1;
        });
        const unauthorized: any = new Error('unauthorized');
        unauthorized.response = { status: 401 };
        unauthorized.config = {};
        mockAxiosState.request = async () => {
            throw unauthorized;
        };
        await expect(privateRequest('goals')).rejects.toThrow('unauthorized');
        expect(logouts).toBe(1);
        expect(getAccessToken()).toBeNull();
        expect(localStorage.getItem('username')).toBeNull();

        unauthorized.config = { _retry: true };
        await expect(privateRequest('goals')).rejects.toThrow('unauthorized');
        expect(logouts).toBe(1);
    });

    test('logs and rethrows other private request failures', async () => {
        mockAxiosState.request = async () => {
            throw new Error('boom');
        };
        await expect(privateRequest('goals')).rejects.toThrow('boom');
    });

    test('retries public requests on network errors and not on other errors', async () => {
        let calls = 0;
        mockAxiosState.request = async () => {
            calls += 1;
            if (calls < 3) {
                const error: any = new Error('net');
                error.code = calls === 1 ? 'ERR_NETWORK' : 'ECONNRESET';
                throw error;
            }
            return { data: { ok: true } };
        };
        await expect(publicRequest('health')).resolves.toEqual({ ok: true });
        expect(calls).toBe(3);

        mockAxiosState.request = async () => {
            const error: any = new Error('bad');
            error.code = 'ERR_BAD_REQUEST';
            throw error;
        };
        await expect(publicRequest('health', 'POST', { a: 1 }, { b: 2 })).rejects.toThrow('bad');
    }, 15000);

    test('refreshes and retries a 401 from the interceptor, then logs out when refresh fails', async () => {
        expect(mockAxiosState.handlers).not.toBeNull();
        const err = mockAxiosState.handlers!.err;
        await expect(err({ response: { status: 500 }, config: { url: `${API}/goals` } })).rejects.toMatchObject({
            response: { status: 500 },
        });
        await expect(err({ response: { status: 401 }, config: { url: 'https://example.com/nope' } })).rejects.toBeTruthy();
        await expect(err({ response: { status: 401 } })).rejects.toBeTruthy();
        await expect(err({
            response: { status: 401 },
            config: { url: `${API}/auth/signin`, headers: {} },
        })).rejects.toBeTruthy();

        const retried: any[] = [];
        mockAxiosState.request = async (config) => {
            retried.push(config);
            return { data: { retried: true } };
        };
        mockAxiosState.post = async () => ({ data: { token: 'next', username: 'ada' } });
        const retryError: any = {
            response: { status: 401 },
            config: { url: `${API}/goals`, headers: {} },
        };
        await expect(err(retryError)).resolves.toEqual({ data: { retried: true } });
        expect(retryError.config._retry).toBe(true);
        expect(retried[0].headers.Authorization).toBe('Bearer next');

        mockAxiosState.post = async () => ({ data: {} });
        let logouts = 0;
        const onLogout = () => {
            logouts += 1;
        };
        window.addEventListener('app:force-logout', onLogout);
        await expect(err({
            response: { status: 401 },
            config: { url: `${API}/goals`, headers: {} },
        })).rejects.toBeTruthy();
        expect(logouts).toBe(1);

        await expect(err({
            response: { status: 401 },
            config: { url: `${API}/goals`, headers: {} },
        })).rejects.toBeTruthy();
        expect(logouts).toBe(1);

        localStorage.setItem('testMode', 'true');
        await expect(err({
            response: { status: 401 },
            config: { url: `${API}/goals`, headers: {}, _retry: false },
        })).rejects.toBeTruthy();
        window.removeEventListener('app:force-logout', onLogout);
        expect(typeof forceLogout).toBe('function');
    });

    test('clears stored auth even when storage throws during logout', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
        mockAxiosState.post = async () => ({ data: {} });
        jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const err = mockAxiosState.handlers!.err;
        await expect(err({
            response: { status: 401 },
            config: { url: `${API}/goals`, headers: {} },
        })).rejects.toBeTruthy();
    });

    test('updates routines, debounces repeats, and surfaces failures', async () => {
        const urls: string[] = [];
        mockAxiosState.request = async (config) => {
            urls.push(config.url);
            return { data: {} };
        };
        await updateRoutines();
        expect(urls[0]).toContain('/routine/');
        await updateRoutines(1234);
        expect(urls).toHaveLength(1);

        localStorage.removeItem('lastRoutineUpdate');
        await updateRoutines(5678);
        expect(urls[1]).toContain('5678');

        localStorage.removeItem('lastRoutineUpdate');
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        await updateRoutines(999);
        expect(urls).toHaveLength(3);

        localStorage.removeItem('lastRoutineUpdate');
        mockAxiosState.request = async () => {
            throw new Error('routine down');
        };
        await expect(updateRoutines(1)).rejects.toThrow('routine down');

        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        await expect(updateRoutines(1)).rejects.toThrow('blocked');
    });

    test('wraps goal, event, calendar, and settings calls', async () => {
        const created = await createGoal(goal());
        expect(created.name).toBe('Alpha');
        expect(created.scheduled_timestamp).toBeInstanceOf(Date);

        const updated = await updateGoal(7, goal());
        expect(updated.id).toBe(7);
        await deleteGoal(7);
        await createRelationship(1, 2, 'child');
        await deleteRelationship(1, 2, 'child');
        await expect(resolveGoal(7, 'completed')).resolves.toMatchObject({ id: 7 });
        mockAxiosState.request = async () => ({ data: { resolution_status: 'pending' } });
        await expect(completeGoal(7, false)).resolves.toBe('pending');
        mockAxiosState.request = async () => ({ data: { ...apiGoal } });
        await expect(completeGoal(7, true)).resolves.toBeUndefined();

        const event = await createEvent({
            parent_id: 1,
            parent_type: 'task',
            scheduled_timestamp: new Date(1_700_000_000_000),
            duration: 30,
            priority: 'high',
        });
        expect(event.goal_type).toBe('task');
        await completeEvent(4);
        await deleteEvent(4, true);
        await deleteEvent(4, false);
        const copy = await duplicateGoal(7, { include_children: true });
        expect(copy.name).toBe('Alpha');

        mockAxiosState.request = async () => ({
            data: {
                task_id: 3,
                events: [apiGoal],
                total_duration: 30,
                next_scheduled: 1_700_000_000_000,
                last_scheduled: null,
                event_count: 1,
                completed_event_count: 0,
                past_uncompleted_count: 0,
                future_uncompleted_count: 1,
                next_uncompleted_timestamp: 1_700_000_000_000,
            },
        });
        const taskEvents = await getTaskEvents(3);
        expect(taskEvents.events).toHaveLength(1);
        expect(taskEvents.next_scheduled).toBeInstanceOf(Date);
        expect(taskEvents.last_scheduled).toBeNull();
        expect(taskEvents.next_uncompleted).toBeInstanceOf(Date);

        mockAxiosState.request = async () => ({ data: [apiGoal] });
        const start = new Date(1_700_000_000_000);
        const end = new Date(1_700_000_100_000);
        await expect(updateRoutineEvent(4, start, 'range', start, end, 'completed')).resolves.toHaveLength(1);
        await expect(updateRoutineEvent(4, start, 'single')).resolves.toHaveLength(1);
        mockAxiosState.request = async () => {
            throw new Error('routine');
        };
        await expect(updateRoutineEvent(4, start, 'all')).rejects.toThrow('routine');

        mockAxiosState.request = async () => ({ data: [apiGoal] });
        await expect(updateRoutineEventProperties(4, {
            duration: 15,
            name: 'N',
            scheduled_timestamp: start,
        }, 'future', start, end)).resolves.toHaveLength(1);
        await expect(updateRoutineEventProperties(4, {}, 'single')).resolves.toHaveLength(1);
        mockAxiosState.request = async () => {
            throw new Error('props');
        };
        await expect(updateRoutineEventProperties(4, {}, 'all')).rejects.toThrow('props');

        mockAxiosState.request = async () => ({ data: { ...apiGoal } });
        const moved = await updateEvent(4, { scheduled_timestamp: start, duration: 20 });
        expect(moved.scheduled_timestamp).toBeInstanceOf(Date);
        await updateEvent(4, { resolution_status: 'completed' });

        mockAxiosState.request = async () => ({
            data: { suggestions: [{ timestamp: 1_700_000_000_000, reason: 'gap', score: 1 }] },
        });
        const options = await getRescheduleOptions(4, 3);
        expect(options.suggestions[0].timestamp).toBeInstanceOf(Date);
        const smart = await getSmartScheduleOptions({
            duration: 30,
            lookAheadDays: 2,
            preferredTimeStart: 9,
            preferredTimeEnd: 17,
            startAfterTimestamp: start,
            eventName: 'Focus',
            eventDescription: 'deep',
        });
        expect(smart.suggestions[0].reason).toBe('gap');
        await getSmartScheduleOptions({ duration: 30 });

        mockAxiosState.request = async () => ({ data: { ...apiGoal } });
        const expanded = await expandTaskDateRange({
            task_id: 3,
            new_start_timestamp: start,
            new_end_timestamp: end,
        });
        expect(expanded.id).toBe(7);
        await expandTaskDateRange({ task_id: 3 });

        const sync = { calendar_id: 'cal', sync_direction: 'from_gcal' as const };
        await syncFromGoogleCalendar(sync);
        await syncToGoogleCalendar(sync);
        await syncBidirectionalGoogleCalendar(sync);
        await resolveGCalConflict({
            goal_id: 1,
            calendar_id: 'cal',
            gcal_event_id: 'e',
            resolution: 'keep_local',
        } as any);
        await resetGCalSyncState('cal');
        await deleteGCalEvent(7);
        await getGCalSettings();
        await updateGCalSettings({ gcal_auto_sync_enabled: true } as any);
        await getGoogleStatus();
        await unlinkGoogleAccount();
        await expect(recomputeRoutineFuture(2, start)).resolves.toMatchObject({ id: 7 });
        await recomputeRoutineFuture(2);
        await getGoogleCalendars();
        await getTelegramSettings();
        await updateTelegramSettings({ chat_id: '1' });
        await sendTelegramTest();
        await getNotificationSettings();
        await updateNotificationSettings({
            notifications_enabled: true,
            notify_via_telegram: false,
            notify_high_priority_events: true,
            notify_event_reminders: true,
            reminder_offsets_minutes: [10],
        });
        await getAutofillSuggestions({
            field_name: 'name',
            goal_context: { name: 'A' },
        });

        mockAxiosState.request = async () => ({
            data: { parents: [apiGoal], children: [apiGoal] },
        });
        const relations = await getGoalRelations(7);
        expect(relations.parents).toHaveLength(1);
        mockAxiosState.request = async () => {
            throw new Error('relations');
        };
        await expect(getGoalRelations(7)).rejects.toThrow('relations');

        mockAxiosState.request = async () => ({
            data: {
                nodes: [apiGoal],
                edges: [{ from: 1, to: 2, relationship_type: 'child' }],
                truncated: false,
            },
        });
        const subgraph = await getGoalSubgraph(7);
        expect(subgraph.nodes[0].name).toBe('Alpha');
        expect(subgraph.truncated).toBe(false);

        mockAxiosState.request = async () => ({ data: { theme_name: 'dark' } });
        await expect(getThemeSettings()).resolves.toEqual({ theme_name: 'dark' });
        await updateThemeSettings({ theme_name: 'blue' });
    });
});
