import React, { useEffect, useState, useMemo } from 'react';
import { privateRequest } from '../../shared/utils/api';
import './Stats.css';

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

interface SmoothedDataPoint {
    date: string;
    smoothedScore: number;
}

const Stats: React.FC = () => {
    const [yearStats, setYearStats] = useState<YearStats | null>(null);
    const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
    const [hoveredDay, setHoveredDay] = useState<DailyStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

    const fetchStats = async () => {
        setLoading(true);
        try {
            const data = await privateRequest<YearStats>(`stats?year=${selectedYear}`);
            setYearStats(data);
        } catch (error) {
            console.error('Failed to fetch stats:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStats();
    }, [selectedYear]); // eslint-disable-line react-hooks/exhaustive-deps

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

                {loading ? (
                    <div className="loading-state">Loading stats...</div>
                ) : (
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
                                                    return (
                                                        <div
                                                            key={`${weekIndex}-${dayIndex}`}
                                                            className={`day-square ${!day.date ? 'empty' : ''} ${hasTasks ? 'has-tasks' : ''} ${isToday ? 'today' : ''}`}
                                                            style={{
                                                                backgroundColor: day.date ? getColorForScore(day.score, hasTasks) : 'transparent',
                                                            }}
                                                            onMouseEnter={() => day.date && handleDayHover(day)}
                                                            onMouseLeave={() => handleDayHover(null)}
                                                            onMouseMove={handleMouseMove}
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