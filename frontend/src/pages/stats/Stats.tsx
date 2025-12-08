import React, { useEffect, useState, useMemo } from 'react';
import { privateRequest } from '../../shared/utils/api';
import './Stats.css';
import '../../shared/styles/badges.css';
import { useNavigate } from 'react-router-dom';
import { Goal } from '../../types/goals';
import { getGoalStyle } from '../../shared/styles/colors';
import { SearchBar } from '../../shared/components/SearchBar';
import GoalMenu from '../../shared/components/GoalMenu';
import CompletionBar from '../../shared/components/CompletionBar';
import EffortRowExpansion from './EffortRowExpansion';

interface DailyStats {
    date: string;
    score: number;
    total_events: number;
    completed_events: number;
    weighted_total: number;
    weighted_completed: number;
}

interface YearStats {
    year: number;
    daily_stats: DailyStats[];
}

interface PeriodStats {
    period: string; // "2024-W01", "2024-01", "2024"
    completion_rate: number; // 0.0 to 1.0
    total_events: number;
    completed_events: number;
    days_with_tasks: number;
    days_with_no_tasks_complete: number;
    weighted_total: number;
    weighted_completed: number;
}

interface ExtendedStats {
    year: number;
    daily_stats: DailyStats[];
    weekly_stats: PeriodStats[];
    monthly_stats: PeriodStats[];
    yearly_stats: PeriodStats;
}

interface RoutineStats {
    routine_id: number;
    routine_name: string;
    completion_rate: number;
    total_events: number;
    completed_events: number;
    smoothed_completion: SmoothedPoint[];
}

interface SmoothedPoint {
    date: string;
    completion_rate: number;
}

interface RoutineSearchResult {
    id: number;
    name: string;
    description?: string;
}

interface EventReschedulingStats {
    total_reschedules: number;
    avg_reschedule_distance_hours: number;
    reschedule_frequency_by_month: MonthlyRescheduleStats[];
    most_rescheduled_events: RescheduledEventInfo[];
}

interface MonthlyRescheduleStats {
    month: string; // "2024-01"
    reschedule_count: number;
    total_events: number;
    reschedule_rate: number;
}

interface RescheduledEventInfo {
    event_name: string;
    reschedule_count: number;
    parent_type: string;
}

interface SmoothedDataPoint {
    date: string;
    smoothedScore: number;
}

// New analytics interfaces
interface EventAnalytics {
    duration_stats: DurationStats[];
    priority_stats: PriorityStats[];
    source_stats: SourceStats;
}

interface DurationStats {
    duration_range: string;
    completion_rate: number;
    total_events: number;
    completed_events: number;
    avg_duration_minutes: number;
}

interface PriorityStats {
    priority: string;
    completion_rate: number;
    total_events: number;
    completed_events: number;
}

interface SourceStats {
    routine_events: SourceBreakdown;
    task_events: SourceBreakdown;
}

interface SourceBreakdown {
    completion_rate: number;
    total_events: number;
    completed_events: number;
    avg_priority_weight: number;
}

// Effort stats (all-time, per non-event goal)
interface EffortStat {
    goal_id: number;
    goal_name: string;
    goal_type: string;
    total_events: number;
    completed_events: number;
    total_duration_minutes: number;
    weighted_completion_rate: number;
    children_count: number;
}

const Stats: React.FC = () => {
    const navigate = useNavigate();
    const [yearStats, setYearStats] = useState<YearStats | null>(null);
    const [extendedStats, setExtendedStats] = useState<ExtendedStats | null>(null);
    const [eventAnalytics, setEventAnalytics] = useState<EventAnalytics | null>(null);
    const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
    const [hoveredDay, setHoveredDay] = useState<DailyStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
    const [activeTab, setActiveTab] = useState<'overview' | 'effort' | 'periods' | 'routines' | 'rescheduling' | 'analytics'>('overview');

    // Routine-specific state
    const [routineSearchTerm, setRoutineSearchTerm] = useState('');
    const [routineSearchResults, setRoutineSearchResults] = useState<RoutineSearchResult[]>([]);
    const [selectedRoutineIds, setSelectedRoutineIds] = useState<number[]>([]);
    const [routineStats, setRoutineStats] = useState<RoutineStats[]>([]);
    const [reschedulingStats, setReschedulingStats] = useState<EventReschedulingStats | null>(null);
    const [effortStats, setEffortStats] = useState<EffortStat[] | null>(null);
    const [effortRange, setEffortRange] = useState<'all' | '5y' | '1y' | '6m' | '3m' | '1m' | '2w'>('all');
    const [effortSortKey, setEffortSortKey] = useState<'children_count' | 'total_duration_minutes' | 'total_events' | 'weighted_completion_rate'>('total_duration_minutes');
    const [effortSortDir, setEffortSortDir] = useState<'asc' | 'desc'>('desc');
    const [effortSearchQuery, setEffortSearchQuery] = useState('');
    const [effortSearchIds, setEffortSearchIds] = useState<Set<number>>(new Set());
    const [effortGoalTypeFilter, setEffortGoalTypeFilter] = useState<Goal['goal_type'] | ''>('');
    const [expandedGoalIds, setExpandedGoalIds] = useState<Set<number>>(new Set());

    const toggleExpandGoal = (goalId: number) => {
        setExpandedGoalIds(prev => {
            const next = new Set(prev);
            if (next.has(goalId)) next.delete(goalId);
            else next.add(goalId);
            return next;
        });
    };

    const fetchStats = async () => {
        setLoading(true);
        try {
            const [yearData, extendedData, reschedulingData, analyticsData] = await Promise.all([
                privateRequest<YearStats>(`stats?year=${selectedYear}`),
                privateRequest<ExtendedStats>(`stats/extended?year=${selectedYear}`),
                privateRequest<EventReschedulingStats>(`stats/rescheduling?year=${selectedYear}`),
                privateRequest<EventAnalytics>(`stats/analytics?year=${selectedYear}`)
            ]);
            setYearStats(yearData);
            setExtendedStats(extendedData);
            setReschedulingStats(reschedulingData);
            setEventAnalytics(analyticsData);
        } catch (error) {
            console.error('Failed to fetch stats:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStats();
    }, [selectedYear]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const delayedSearch = setTimeout(() => {
            searchRoutines(routineSearchTerm);
        }, 300); // Debounce search

        return () => clearTimeout(delayedSearch);
    }, [routineSearchTerm]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        fetchRoutineStats();
    }, [selectedRoutineIds, selectedYear]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (activeTab === 'effort') {
            setEffortStats(null);
            privateRequest<EffortStat[]>(`stats/effort?range=${effortRange}`)
                .then(setEffortStats)
                .catch((err) => console.error('Failed to fetch effort stats:', err));
        }
    }, [activeTab, effortRange]);

    const getColorForScore = (score: number, hasTasks: boolean): string => {
        if (!hasTasks) return 'transparent'; // No tasks - transparent

        // If there are tasks but score is 0, show red
        if (score === 0) return 'rgb(255, 0, 0)';

        // Red to Yellow to Green gradient
        if (score <= 0.5) {
            // Red to Yellow (0 to 0.5)
            const ratio = score * 2; // 0 to 1
            const r = 255;
            const g = Math.round(255 * ratio);
            const b = 0;
            return `rgb(${r}, ${g}, ${b})`;
        } else {
            // Yellow to Green (0.5 to 1)
            const ratio = (score - 0.5) * 2; // 0 to 1
            const r = Math.round(255 * (1 - ratio));
            const g = 255;
            const b = 0;
            return `rgb(${r}, ${g}, ${b})`;
        }
    };

    const organizedStats = useMemo(() => {
        if (!yearStats) return [];

        const weeks: DailyStats[][] = [];
        let currentWeek: DailyStats[] = [];

        // Find the first day of the year and pad with empty days if needed
        const firstDate = new Date(selectedYear, 0, 1);
        const firstDayOfWeek = firstDate.getDay();

        // Pad the beginning with empty days
        for (let i = 0; i < firstDayOfWeek; i++) {
            currentWeek.push({
                date: '',
                score: 0,
                total_events: 0,
                completed_events: 0,
                weighted_total: 0,
                weighted_completed: 0,
            });
        }

        // Add all days of the year
        yearStats.daily_stats.forEach((day, index) => {
            currentWeek.push(day);

            if (currentWeek.length === 7) {
                weeks.push(currentWeek);
                currentWeek = [];
            }
        });

        // Add any remaining days
        if (currentWeek.length > 0) {
            weeks.push(currentWeek);
        }

        return weeks;
    }, [yearStats, selectedYear]);

    const smoothedData = useMemo(() => {
        if (!yearStats) return [];

        const windowSize = 10;
        const result: SmoothedDataPoint[] = [];

        for (let i = 0; i < yearStats.daily_stats.length; i++) {
            let sum = 0;
            let count = 0;

            // Calculate average for window around current point
            for (let j = Math.max(0, i - Math.floor(windowSize / 2));
                j <= Math.min(yearStats.daily_stats.length - 1, i + Math.floor(windowSize / 2));
                j++) {
                // Only include days with tasks in the average
                if (yearStats.daily_stats[j].total_events > 0) {
                    sum += yearStats.daily_stats[j].score;
                    count++;
                }
            }

            result.push({
                date: yearStats.daily_stats[i].date,
                smoothedScore: count > 0 ? sum / count : 0
            });
        }

        return result;
    }, [yearStats]);

    const formatDate = (dateStr: string): string => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    const formatMinutes = (minutes: number): string => {
        const h = Math.floor(minutes / 60);
        const m = Math.round(minutes % 60);
        return `${h}h ${m}m`;
    };

    const effortPseudoGoals = useMemo(() => {
        return (effortStats ?? []).map(g => ({
            id: g.goal_id,
            name: g.goal_name,
            goal_type: g.goal_type as any,
        } as Goal));
    }, [effortStats]);

    const filteredEffortStats = useMemo(() => {
        if (!effortStats) return null;
        let arr = [...effortStats];
        if (effortGoalTypeFilter) {
            arr = arr.filter(g => g.goal_type === effortGoalTypeFilter);
        }
        if (effortSearchQuery) {
            arr = arr.filter(g => effortSearchIds.has(g.goal_id));
        }
        return arr;
    }, [effortStats, effortGoalTypeFilter, effortSearchQuery, effortSearchIds]);

    const sortedEffortStats = useMemo(() => {
        if (!filteredEffortStats) return null;
        const arr = [...filteredEffortStats];
        arr.sort((a, b) => {
            const dir = effortSortDir === 'asc' ? 1 : -1;
            let av: number;
            let bv: number;
            if (effortSortKey === 'children_count') {
                av = a.children_count;
                bv = b.children_count;
            } else if (effortSortKey === 'total_duration_minutes') {
                av = a.total_duration_minutes;
                bv = b.total_duration_minutes;
            } else if (effortSortKey === 'total_events') {
                av = a.total_events;
                bv = b.total_events;
            } else {
                av = a.weighted_completion_rate;
                bv = b.weighted_completion_rate;
            }
            if (av === bv) {
                // Tie-break by goal name
                return a.goal_name.localeCompare(b.goal_name);
            }
            return av > bv ? dir : -dir;
        });
        return arr;
    }, [filteredEffortStats, effortSortKey, effortSortDir]);

    const handleEffortSort = (key: 'children_count' | 'total_duration_minutes' | 'total_events' | 'weighted_completion_rate') => {
        if (effortSortKey === key) {
            setEffortSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setEffortSortKey(key);
            setEffortSortDir('desc');
        }
    };

    const months = useMemo(() => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], []);

    const monthPositions = useMemo(() => {
        const positions: { month: string; position: number }[] = [];
        let currentMonth = -1;

        organizedStats.forEach((week, weekIndex) => {
            week.forEach((day) => {
                if (day.date) {
                    const month = new Date(day.date).getMonth();
                    if (month !== currentMonth) {
                        currentMonth = month;
                        positions.push({ month: months[month], position: weekIndex });
                    }
                }
            });
        });

        return positions;
    }, [organizedStats, months]);

    const handleMouseMove = (e: React.MouseEvent) => {
        setMousePosition({ x: e.clientX, y: e.clientY });
    };

    const handleDayHover = (day: DailyStats | null) => {
        setHoveredDay(day);
    };

    const handleDayClick = (day: DailyStats) => {
        if (!day.date) return;
        // Prevent navigating to future dates
        const isFuture = new Date(day.date + 'T00:00:00') > new Date(today + 'T00:00:00');
        if (isFuture) return;
        navigate(`/day?date=${day.date}`);
    };

    // Get today's date in YYYY-MM-DD format using user's local timezone
    const today = useMemo(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }, []);

    // Filter smoothed data to exclude future dates
    const filteredSmoothedData = useMemo(() => {
        const todayDate = new Date(today + 'T00:00:00');
        return smoothedData.filter(point => {
            const pointDate = new Date(point.date + 'T00:00:00');
            return pointDate <= todayDate;
        });
    }, [smoothedData, today]);

    const searchRoutines = async (searchTerm: string) => {
        if (searchTerm.length < 2) {
            setRoutineSearchResults([]);
            return;
        }
        try {
            console.log('🔍 [FRONTEND] Searching routines with term:', searchTerm);
            const results = await privateRequest<RoutineSearchResult[]>(`stats/routines/search?q=${encodeURIComponent(searchTerm)}`);
            console.log('🔍 [FRONTEND] Search results:', results);
            setRoutineSearchResults(results);
        } catch (error) {
            console.error('Failed to search routines:', error);
        }
    };

    const fetchRoutineStats = async () => {
        if (selectedRoutineIds.length === 0) {
            setRoutineStats([]);
            return;
        }
        try {
            console.log('🔍 [FRONTEND] Fetching routine stats for IDs:', selectedRoutineIds, 'year:', selectedYear);
            const stats = await privateRequest<RoutineStats[]>(
                `stats/routines/stats?year=${selectedYear}`,
                'POST',
                { routine_ids: selectedRoutineIds }
            );
            console.log('🔍 [FRONTEND] Routine stats response:', stats);
            setRoutineStats(stats);
        } catch (error) {
            console.error('Failed to fetch routine stats:', error);
        }
    };

    return (
        <div className="stats-container">
            <div className="stats-content">
                <div className="stats-header">
                    <h1 className="stats-title">Completion Stats</h1>
                    <div className="year-selector">
                        <button
                            onClick={() => setSelectedYear(selectedYear - 1)}
                            className="year-nav-button"
                        >
                            ←
                        </button>
                        <span className="current-year">{selectedYear}</span>
                        <button
                            onClick={() => setSelectedYear(selectedYear + 1)}
                            className="year-nav-button"
                            disabled={selectedYear >= new Date().getFullYear()}
                        >
                            →
                        </button>
                    </div>
                </div>

                <div className="stats-tabs">
                    <button
                        className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`}
                        onClick={() => setActiveTab('overview')}
                    >
                        Overview
                    </button>
                    <button
                        className={`tab-button ${activeTab === 'effort' ? 'active' : ''}`}
                        onClick={() => setActiveTab('effort')}
                    >
                        Effort
                    </button>
                    {/*
                    <button className={`tab-button ${activeTab === 'periods' ? 'active' : ''}`} onClick={() => setActiveTab('periods')}>Period Analysis</button>
                    <button className={`tab-button ${activeTab === 'routines' ? 'active' : ''}`} onClick={() => setActiveTab('routines')}>Routine Stats</button>
                    <button className={`tab-button ${activeTab === 'rescheduling' ? 'active' : ''}`} onClick={() => setActiveTab('rescheduling')}>Rescheduling</button>
                    <button className={`tab-button ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')}>Analytics</button>
                    */}
                </div>

                {loading ? (
                    <div className="loading-state">Loading stats...</div>
                ) : (
                    <>
                        {activeTab === 'overview' && (
                            <>
                                <div className="activity-graph">
                                    <div className="graph-container">
                                        <div className="weekday-labels">
                                            <div className="weekday-label"></div>
                                            <div className="weekday-label">Mon</div>
                                            <div className="weekday-label"></div>
                                            <div className="weekday-label">Wed</div>
                                            <div className="weekday-label"></div>
                                            <div className="weekday-label">Fri</div>
                                            <div className="weekday-label"></div>
                                        </div>

                                        <div className="calendar-graph">
                                            <div className="months-labels">
                                                {monthPositions.map(({ month, position }) => (
                                                    <div
                                                        key={`${month}-${position}`}
                                                        className="month-label"
                                                        style={{ left: `${position * 18}px` }}
                                                    >
                                                        {month}
                                                    </div>
                                                ))}
                                            </div>

                                            <div className="activity-grid">
                                                {organizedStats.map((week, weekIndex) => (
                                                    <div key={weekIndex} className="week-column">
                                                        {week.map((day, dayIndex) => {
                                                            const hasTasks = day.date !== '' && day.total_events > 0;
                                                            const isToday = day.date === today;
                                                            const isFutureDay = day.date !== '' && new Date(day.date + 'T00:00:00') > new Date(today + 'T00:00:00');

                                                            return (
                                                                <div
                                                                    key={`${weekIndex}-${dayIndex}`}
                                                                    className={`day-square ${!day.date ? 'empty' : ''} ${hasTasks ? 'has-tasks' : ''} ${isToday ? 'today' : ''} ${isFutureDay ? 'future' : ''}`}
                                                                    style={{
                                                                        backgroundColor: day.date && !isFutureDay ? getColorForScore(day.score, hasTasks) : 'transparent',
                                                                    }}
                                                                    onMouseEnter={() => day.date && !isFutureDay && handleDayHover(day)}
                                                                    onMouseLeave={() => handleDayHover(null)}
                                                                    onMouseMove={handleMouseMove}
                                                                onClick={() => day.date && !isFutureDay && handleDayClick(day)}
                                                                    data-date={day.date}
                                                                />
                                                            );
                                                        })}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="legend">
                                        <span className="legend-label">0%</span>
                                        <div className="legend-squares">
                                            <div className="legend-square no-tasks" title="No tasks"></div>
                                            <div className="legend-square" style={{ backgroundColor: 'rgb(255, 0, 0)' }}></div>
                                            <div className="legend-square" style={{ backgroundColor: 'rgb(255, 128, 0)' }}></div>
                                            <div className="legend-square" style={{ backgroundColor: 'rgb(255, 255, 0)' }}></div>
                                            <div className="legend-square" style={{ backgroundColor: 'rgb(128, 255, 0)' }}></div>
                                            <div className="legend-square" style={{ backgroundColor: 'rgb(0, 255, 0)' }}></div>
                                        </div>
                                        <span className="legend-label">100%</span>
                                        <span className="legend-separator">|</span>
                                        <div className="legend-square today-indicator" title="Today"></div>
                                        <span className="legend-label">Today</span>
                                    </div>
                                </div>

                                <div className="smoothed-graph">
                                    <h2 className="graph-title">10-Day Smoothed Completion Rate</h2>
                                    <div className="chart-container">
                                        <svg viewBox="0 0 1000 300" className="line-chart">
                                            <defs>
                                                <linearGradient id="gridGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                                                    <stop offset="0%" style={{ stopColor: '#e0e0e0', stopOpacity: 0.5 }} />
                                                    <stop offset="100%" style={{ stopColor: '#e0e0e0', stopOpacity: 0.1 }} />
                                                </linearGradient>
                                            </defs>

                                            {/* Grid lines */}
                                            {[0, 25, 50, 75, 100].map(percent => (
                                                <g key={percent}>
                                                    <line
                                                        x1="50"
                                                        y1={250 - (percent * 2)}
                                                        x2="950"
                                                        y2={250 - (percent * 2)}
                                                        stroke="#e0e0e0"
                                                        strokeWidth="1"
                                                    />
                                                    <text
                                                        x="35"
                                                        y={255 - (percent * 2)}
                                                        fill="#666"
                                                        fontSize="12"
                                                        textAnchor="end"
                                                    >
                                                        {percent}%
                                                    </text>
                                                </g>
                                            ))}

                                            {/* Month labels */}
                                            {monthPositions.map(({ month, position }) => {
                                                const x = 50 + (position / 53) * 900; // 53 weeks in a year
                                                return (
                                                    <text
                                                        key={`${month}-${position}-chart`}
                                                        x={x}
                                                        y={280}
                                                        fill="#666"
                                                        fontSize="12"
                                                        textAnchor="middle"
                                                    >
                                                        {month}
                                                    </text>
                                                );
                                            })}

                                            {/* Line chart */}
                                            {filteredSmoothedData.length > 0 && (
                                                <path
                                                    d={filteredSmoothedData.map((point, index) => {
                                                        const x = 50 + (index / smoothedData.length) * 900;
                                                        const y = 250 - (point.smoothedScore * 200);
                                                        return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
                                                    }).join(' ')}
                                                    fill="none"
                                                    stroke="#2563eb"
                                                    strokeWidth="2"
                                                />
                                            )}

                                            {/* Points */}
                                            {filteredSmoothedData.filter((_, index) => index % 7 === 0).map((point, filterIndex) => {
                                                const actualIndex = filteredSmoothedData.findIndex(p => p === point);
                                                const x = 50 + (actualIndex / smoothedData.length) * 900;
                                                const y = 250 - (point.smoothedScore * 200);
                                                return (
                                                    <circle
                                                        key={actualIndex}
                                                        cx={x}
                                                        cy={y}
                                                        r="3"
                                                        fill="#2563eb"
                                                    />
                                                );
                                            })}
                                        </svg>
                                    </div>
                                </div>
                            </>
                        )}

                        {activeTab === 'effort' && (
                            <div className="period-stats">
                                <div className="summary-card">
                                    <h3>Effort by Goal (All Time)</h3>
                                    <div className="effort-controls">
                                        <label htmlFor="effort-range" style={{ color: '#666', fontSize: '0.9rem' }}>
                                            Range:
                                        </label>
                                        <select
                                            id="effort-range"
                                            className="effort-select"
                                            value={effortRange}
                                            onChange={(e) => setEffortRange(e.target.value as typeof effortRange)}
                                        >
                                            <option value="all">All time</option>
                                            <option value="5y">5 years</option>
                                            <option value="1y">1 year</option>
                                            <option value="6m">6 months</option>
                                            <option value="3m">3 months</option>
                                            <option value="1m">1 month</option>
                                            <option value="2w">2 weeks</option>
                                        </select>
                                        <SearchBar
                                            items={effortPseudoGoals}
                                            value={effortSearchQuery}
                                            onChange={setEffortSearchQuery}
                                            onResults={(_, ids) => setEffortSearchIds(new Set(ids))}
                                            placeholder="Search goals…"
                                        />
                                        <label htmlFor="effort-type" style={{ color: '#666', fontSize: '0.9rem' }}>
                                            Type:
                                        </label>
                                        <select
                                            id="effort-type"
                                            className="effort-select"
                                            value={effortGoalTypeFilter}
                                            onChange={(e) => setEffortGoalTypeFilter(e.target.value as any)}
                                        >
                                            <option value="">All</option>
                                            <option value="directive">directive</option>
                                            <option value="project">project</option>
                                            <option value="achievement">achievement</option>
                                            <option value="routine">routine</option>
                                            <option value="task">task</option>
                                        </select>
                                    </div>
                                    <div className="table-container">
                                        <table className="effort-table">
                                            <thead>
                                                <tr>
                                                    <th className="sticky">Goal</th>
                                                    <th
                                                        className="sortable sticky"
                                                        onClick={() => handleEffortSort('children_count')}
                                                        title="Sort by number of descendants"
                                                    >
                                                        Children {effortSortKey === 'children_count' ? (effortSortDir === 'asc' ? '▲' : '▼') : ''}
                                                    </th>
                                                    <th
                                                        className="sortable sticky"
                                                        onClick={() => handleEffortSort('total_duration_minutes')}
                                                        title="Sort by time spent"
                                                    >
                                                        Time Spent {effortSortKey === 'total_duration_minutes' ? (effortSortDir === 'asc' ? '▲' : '▼') : ''}
                                                    </th>
                                                    <th
                                                        className="sortable sticky"
                                                        onClick={() => handleEffortSort('total_events')}
                                                        title="Sort by completed events"
                                                    >
                                                        Completed Events {effortSortKey === 'total_events' ? (effortSortDir === 'asc' ? '▲' : '▼') : ''}
                                                    </th>
                                                    <th
                                                        className="sortable sticky"
                                                        onClick={() => handleEffortSort('weighted_completion_rate')}
                                                        title="Sort by weighted completion"
                                                    >
                                                        Weighted Completion {effortSortKey === 'weighted_completion_rate' ? (effortSortDir === 'asc' ? '▲' : '▼') : ''}
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {sortedEffortStats && sortedEffortStats.length > 0 ? (
                                                    sortedEffortStats.flatMap((g) => {
                                                        const pseudoGoal: Goal = {
                                                            id: g.goal_id,
                                                            name: g.goal_name,
                                                            goal_type: g.goal_type as any,
                                                        } as Goal;
                                                        const goalStyle = getGoalStyle(pseudoGoal);
                                                        const isExpanded = expandedGoalIds.has(g.goal_id);
                                                        const rows: React.ReactNode[] = [
                                                            <tr key={g.goal_id} className={isExpanded ? 'effort-row-expanded' : ''}>
                                                                <td>
                                                                    <div className="goal-cell">
                                                                        {g.children_count > 0 && (
                                                                            <button
                                                                                className="effort-expand-btn"
                                                                                onClick={() => toggleExpandGoal(g.goal_id)}
                                                                                title={isExpanded ? 'Collapse' : 'Expand children'}
                                                                            >
                                                                                {isExpanded ? '▼' : '▶'}
                                                                            </button>
                                                                        )}
                                                                        <span
                                                                            className="goal-type-badge"
                                                                            style={{
                                                                                backgroundColor: `${goalStyle.backgroundColor}20`,
                                                                                color: goalStyle.backgroundColor,
                                                                                cursor: 'pointer'
                                                                            }}
                                                                            onClick={() => GoalMenu.open(pseudoGoal, 'view')}
                                                                        >
                                                                            {g.goal_name}
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                                <td>{g.children_count}</td>
                                                                <td>{formatMinutes(g.total_duration_minutes)}</td>
                                                                <td>{g.total_events}</td>
                                                                <td>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                        <CompletionBar
                                                                            value={g.weighted_completion_rate}
                                                                            hasTasks={true}
                                                                            width={60}
                                                                            height={8}
                                                                            title={`${(g.weighted_completion_rate * 100).toFixed(1)}%`}
                                                                        />
                                                                        <span>{(g.weighted_completion_rate * 100).toFixed(1)}%</span>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ];
                                                        if (isExpanded) {
                                                            rows.push(
                                                                <EffortRowExpansion
                                                                    key={`${g.goal_id}-expansion`}
                                                                    goalId={g.goal_id}
                                                                    range={effortRange}
                                                                />
                                                            );
                                                        }
                                                        return rows;
                                                    })
                                                ) : (
                                                    <tr>
                                                        <td colSpan={5} style={{ color: '#666' }}>
                                                            {effortStats === null ? 'Loading...' : (effortStats.length === 0 ? 'No data' : 'No matches')}
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        )}

                        {false && activeTab === 'periods' && (null)}

                        {false && activeTab === 'routines' && (null)}

                        {false && activeTab === 'rescheduling' && (null)}

                        {false && activeTab === 'analytics' && (null)}
                    </>
                )}

                {hoveredDay && (
                    <div
                        className="tooltip"
                        style={{
                            left: mousePosition.x,
                            top: mousePosition.y,
                        }}
                    >
                        <div className="tooltip-content">
                            <strong>{formatDate(hoveredDay.date)}</strong>
                            <div>Score: {(hoveredDay.score * 100).toFixed(1)}%</div>
                            <div>Completed: {hoveredDay.completed_events} / {hoveredDay.total_events} events</div>
                            <div>Weighted: {hoveredDay.weighted_completed.toFixed(1)} / {hoveredDay.weighted_total.toFixed(1)}</div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Stats; 