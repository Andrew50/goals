import React, { useEffect, useState, useMemo } from 'react';
import { privateRequest } from '../../shared/utils/api';
import { getGoalStyle } from '../../shared/styles/colors';
import { Goal } from '../../types/goals';
import CompletionBar from '../../shared/components/CompletionBar';

interface DailyEffortPoint {
    date: string;
    duration_minutes: number;
    completed_events: number;
    weighted_completion: number;
}

interface ChildEffortTimeSeries {
    goal_id: number;
    goal_name: string;
    goal_type: string;
    total_events: number;
    completed_events: number;
    total_duration_minutes: number;
    weighted_completion_rate: number;
    daily_stats: DailyEffortPoint[];
}

type MetricType = 'time_spent' | 'completed_events' | 'weighted_completion';

interface Props {
    goalId: number;
    range: string;
}

const EffortRowExpansion: React.FC<Props> = ({ goalId, range }) => {
    const [children, setChildren] = useState<ChildEffortTimeSeries[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedMetric, setSelectedMetric] = useState<MetricType>('time_spent');
    const [selectedChildren, setSelectedChildren] = useState<Set<number>>(new Set());

    useEffect(() => {
        setLoading(true);
        privateRequest<ChildEffortTimeSeries[]>(`stats/effort/${goalId}/children?range=${range}`)
            .then(data => {
                setChildren(data);
                // Select all children by default
                setSelectedChildren(new Set(data.map(c => c.goal_id)));
            })
            .catch(err => console.error('Failed to fetch children effort:', err))
            .finally(() => setLoading(false));
    }, [goalId, range]);

    const formatMinutes = (minutes: number): string => {
        const h = Math.floor(minutes / 60);
        const m = Math.round(minutes % 60);
        return `${h}h ${m}m`;
    };

    // Generate colors for each child
    const childColors = useMemo(() => {
        if (!children) return {};
        return children.reduce((acc, child, idx) => {
            const hue = (idx * 360) / Math.max(children.length, 1);
            acc[child.goal_id] = `hsl(${hue}, 70%, 50%)`;
            return acc;
        }, {} as Record<number, string>);
    }, [children]);

    // Aggregate all dates across selected children for the graph
    const graphData = useMemo(() => {
        if (!children) return [];

        const dateMap = new Map<string, Map<number, DailyEffortPoint>>();

        children
            .filter(c => selectedChildren.has(c.goal_id))
            .forEach(child => {
                child.daily_stats.forEach(point => {
                    if (!dateMap.has(point.date)) {
                        dateMap.set(point.date, new Map());
                    }
                    dateMap.get(point.date)!.set(child.goal_id, point);
                });
            });

        return Array.from(dateMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, childPoints]) => ({ date, childPoints }));
    }, [children, selectedChildren]);

    // Calculate max values for normalization
    const maxValues = useMemo(() => {
        if (!graphData.length) return { duration: 1, events: 1 };

        let maxDuration = 0;
        let maxEvents = 0;

        graphData.forEach(d => {
            d.childPoints.forEach(point => {
                maxDuration = Math.max(maxDuration, point.duration_minutes);
                maxEvents = Math.max(maxEvents, point.completed_events);
            });
        });

        return {
            duration: Math.max(maxDuration, 1),
            events: Math.max(maxEvents, 1),
        };
    }, [graphData]);

    const toggleChild = (childGoalId: number) => {
        setSelectedChildren(prev => {
            const next = new Set(prev);
            if (next.has(childGoalId)) next.delete(childGoalId);
            else next.add(childGoalId);
            return next;
        });
    };

    const toggleAllChildren = () => {
        if (!children) return;
        if (selectedChildren.size === children.length) {
            setSelectedChildren(new Set());
        } else {
            setSelectedChildren(new Set(children.map(c => c.goal_id)));
        }
    };

    if (loading) {
        return (
            <tr className="effort-expansion-row">
                <td colSpan={5} className="effort-expansion-cell">
                    <div className="effort-expansion-loading">Loading children...</div>
                </td>
            </tr>
        );
    }

    if (!children || children.length === 0) {
        return (
            <tr className="effort-expansion-row">
                <td colSpan={5} className="effort-expansion-cell">
                    <div className="effort-expansion-empty">No children found</div>
                </td>
            </tr>
        );
    }

    return (
        <tr className="effort-expansion-row">
            <td colSpan={5} className="effort-expansion-cell">
                <div className="effort-expansion-content">
                    <h4 className="effort-expansion-title">Children Effort Breakdown</h4>

                    {/* Children table */}
                    <table className="effort-children-table">
                        <thead>
                            <tr>
                                <th className="effort-children-checkbox-col">
                                    <input
                                        type="checkbox"
                                        checked={selectedChildren.size === children.length}
                                        onChange={toggleAllChildren}
                                        title="Toggle all"
                                    />
                                </th>
                                <th>Child</th>
                                <th>Time Spent</th>
                                <th>Completed Events</th>
                                <th>Weighted Completion</th>
                            </tr>
                        </thead>
                        <tbody>
                            {children.map(child => {
                                const pseudoGoal: Goal = {
                                    id: child.goal_id,
                                    name: child.goal_name,
                                    goal_type: child.goal_type as Goal['goal_type'],
                                } as Goal;
                                const goalStyle = getGoalStyle(pseudoGoal);

                                return (
                                    <tr key={child.goal_id}>
                                        <td className="effort-children-checkbox-col">
                                            <input
                                                type="checkbox"
                                                checked={selectedChildren.has(child.goal_id)}
                                                onChange={() => toggleChild(child.goal_id)}
                                            />
                                            <span
                                                className="effort-child-color-indicator"
                                                style={{ background: childColors[child.goal_id] }}
                                            />
                                        </td>
                                        <td>
                                            <span
                                                className="goal-type-badge"
                                                style={{
                                                    backgroundColor: `${goalStyle.backgroundColor}20`,
                                                    color: goalStyle.backgroundColor,
                                                }}
                                            >
                                                {child.goal_name}
                                            </span>
                                        </td>
                                        <td className="effort-children-center">
                                            {formatMinutes(child.total_duration_minutes)}
                                        </td>
                                        <td className="effort-children-center">
                                            {child.completed_events} / {child.total_events}
                                        </td>
                                        <td>
                                            <div className="effort-children-completion">
                                                <CompletionBar
                                                    value={child.weighted_completion_rate}
                                                    hasTasks={true}
                                                    width={60}
                                                    height={8}
                                                />
                                                <span>{(child.weighted_completion_rate * 100).toFixed(1)}%</span>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {/* Metric toggle and graph */}
                    <div className="effort-graph-section">
                        <div className="effort-metric-toggles">
                            <button
                                className={`effort-metric-btn ${selectedMetric === 'time_spent' ? 'active' : ''}`}
                                onClick={() => setSelectedMetric('time_spent')}
                            >
                                Time Spent
                            </button>
                            <button
                                className={`effort-metric-btn ${selectedMetric === 'completed_events' ? 'active' : ''}`}
                                onClick={() => setSelectedMetric('completed_events')}
                            >
                                Completed Events
                            </button>
                            <button
                                className={`effort-metric-btn ${selectedMetric === 'weighted_completion' ? 'active' : ''}`}
                                onClick={() => setSelectedMetric('weighted_completion')}
                            >
                                Weighted Completion
                            </button>
                        </div>

                        {graphData.length > 0 && selectedChildren.size > 0 ? (
                            <svg viewBox="0 0 800 200" className="effort-graph-svg">
                                {/* Y-axis grid lines */}
                                {[0, 25, 50, 75, 100].map(pct => (
                                    <g key={pct}>
                                        <line
                                            x1="60"
                                            y1={180 - pct * 1.6}
                                            x2="780"
                                            y2={180 - pct * 1.6}
                                            stroke="#e0e0e0"
                                        />
                                        <text
                                            x="55"
                                            y={185 - pct * 1.6}
                                            fill="#666"
                                            fontSize="10"
                                            textAnchor="end"
                                        >
                                            {selectedMetric === 'weighted_completion'
                                                ? `${pct}%`
                                                : selectedMetric === 'time_spent'
                                                    ? `${Math.round((pct / 100) * maxValues.duration)}m`
                                                    : Math.round((pct / 100) * maxValues.events)}
                                        </text>
                                    </g>
                                ))}

                                {/* X-axis labels (show a few dates) */}
                                {graphData
                                    .filter((_, i) => i % Math.max(1, Math.floor(graphData.length / 6)) === 0)
                                    .map((d, i) => {
                                        const idx = graphData.findIndex(g => g.date === d.date);
                                        const x = 60 + (idx / Math.max(graphData.length - 1, 1)) * 720;
                                        return (
                                            <text
                                                key={d.date}
                                                x={x}
                                                y={195}
                                                fill="#666"
                                                fontSize="9"
                                                textAnchor="middle"
                                            >
                                                {d.date.slice(5)} {/* MM-DD */}
                                            </text>
                                        );
                                    })}

                                {/* Lines for each selected child */}
                                {children
                                    .filter(c => selectedChildren.has(c.goal_id))
                                    .map(child => {
                                        const points = graphData
                                            .map((d, i) => {
                                                const point = d.childPoints.get(child.goal_id);
                                                if (!point) return null;

                                                const x = 60 + (i / Math.max(graphData.length - 1, 1)) * 720;
                                                let y: number;

                                                if (selectedMetric === 'time_spent') {
                                                    y = 180 - (point.duration_minutes / maxValues.duration) * 160;
                                                } else if (selectedMetric === 'completed_events') {
                                                    y = 180 - (point.completed_events / maxValues.events) * 160;
                                                } else {
                                                    y = 180 - point.weighted_completion * 160;
                                                }

                                                return { x, y };
                                            })
                                            .filter(Boolean) as { x: number; y: number }[];

                                        if (points.length < 2) return null;

                                        const pathD = points
                                            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                                            .join(' ');

                                        return (
                                            <path
                                                key={child.goal_id}
                                                d={pathD}
                                                fill="none"
                                                stroke={childColors[child.goal_id]}
                                                strokeWidth="2"
                                            />
                                        );
                                    })}
                            </svg>
                        ) : (
                            <div className="effort-graph-empty">
                                {selectedChildren.size === 0
                                    ? 'Select children to view graph'
                                    : 'No data available for selected children'}
                            </div>
                        )}

                        {/* Legend */}
                        {selectedChildren.size > 0 && (
                            <div className="effort-graph-legend">
                                {children
                                    .filter(c => selectedChildren.has(c.goal_id))
                                    .map(child => (
                                        <div key={child.goal_id} className="effort-legend-item">
                                            <span
                                                className="effort-legend-color"
                                                style={{ background: childColors[child.goal_id] }}
                                            />
                                            <span className="effort-legend-name">{child.goal_name}</span>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
                </div>
            </td>
        </tr>
    );
};

export default EffortRowExpansion;






