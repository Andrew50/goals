import React, { useEffect, useState, useMemo } from 'react';
import { privateRequest } from '../../shared/utils/api';
import { goalToLocal } from '../../shared/utils/time';
import { Goal, ApiGoal } from '../../types/goals';
import { getGoalStyle } from '../../shared/styles/colors';
import GoalMenu from '../../shared/components/GoalMenu';
import './Achievements.css';

const Achievements: React.FC = () => {
    const [achievements, setAchievements] = useState<Goal[]>([]);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [filterCompleted, setFilterCompleted] = useState<'all' | 'completed' | 'incomplete'>('all');

    useEffect(() => {
        // Fetch achievements from the API
        privateRequest<ApiGoal[]>('achievements').then(apiGoals => {
            // Convert ApiGoal[] to Goal[] using goalToLocal
            setAchievements(apiGoals.map(goalToLocal));
        });
    }, [refreshTrigger]);

    const filteredAchievements = useMemo(() => {
        return achievements.filter(achievement => {
            if (filterCompleted === 'completed') return achievement.completed;
            if (filterCompleted === 'incomplete') return !achievement.completed;
            return true;
        });
    }, [achievements, filterCompleted]);

    const handleAchievementClick = (achievement: Goal) => {
        GoalMenu.open(achievement, 'view', (updatedGoal) => {
            setRefreshTrigger(prev => prev + 1);
        });
    };

    const handleAchievementContextMenu = (event: React.MouseEvent, achievement: Goal) => {
        event.preventDefault();
        GoalMenu.open(achievement, 'edit', (updatedGoal) => {
            setRefreshTrigger(prev => prev + 1);
        });
    };

    const handleCreateAchievement = () => {
        const newAchievement: Partial<Goal> = {
            goal_type: 'achievement' as Goal['goal_type']
        };
        GoalMenu.open(newAchievement as Goal, 'create', (newGoal) => {
            setRefreshTrigger(prev => prev + 1);
        });
    };

    const formatDueDate = (timestamp: Date | undefined) => {
        if (!timestamp) return 'No due date';
        const date = new Date(timestamp);
        const now = new Date();
        const diffTime = date.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
            return `Overdue by ${Math.abs(diffDays)} days`;
        } else if (diffDays === 0) {
            return 'Due today';
        } else if (diffDays === 1) {
            return 'Due tomorrow';
        } else if (diffDays <= 7) {
            return `Due in ${diffDays} days`;
        } else {
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        }
    };

    const getDueDateClass = (timestamp: Date | undefined) => {
        if (!timestamp) return '';
        const now = new Date();
        const diffTime = new Date(timestamp).getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return 'overdue';
        if (diffDays <= 3) return 'urgent';
        if (diffDays <= 7) return 'upcoming';
        return '';
    };

    return (
        <div className="achievements-container">
            <div className="achievements-content">
                <div className="achievements-header">
                    <h1 className="achievements-title">Achievements</h1>
                    <div className="header-actions">
                        <div className="filter-buttons">
                            <button
                                className={`filter-button ${filterCompleted === 'all' ? 'active' : ''}`}
                                onClick={() => setFilterCompleted('all')}
                            >
                                All
                            </button>
                            <button
                                className={`filter-button ${filterCompleted === 'incomplete' ? 'active' : ''}`}
                                onClick={() => setFilterCompleted('incomplete')}
                            >
                                In Progress
                            </button>
                            <button
                                className={`filter-button ${filterCompleted === 'completed' ? 'active' : ''}`}
                                onClick={() => setFilterCompleted('completed')}
                            >
                                Completed
                            </button>
                        </div>
                        <button
                            onClick={handleCreateAchievement}
                            className="new-achievement-button"
                        >
                            <svg className="new-achievement-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            <span>New Achievement</span>
                        </button>
                    </div>
                </div>

                <div className="achievements-stats">
                    <div className="stat-card">
                        <div className="stat-value">{achievements.length}</div>
                        <div className="stat-label">Total Achievements</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value">{achievements.filter(a => a.completed).length}</div>
                        <div className="stat-label">Completed</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value">{achievements.filter(a => !a.completed).length}</div>
                        <div className="stat-label">In Progress</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value">
                            {Math.round((achievements.filter(a => a.completed).length / achievements.length) * 100) || 0}%
                        </div>
                        <div className="stat-label">Completion Rate</div>
                    </div>
                </div>

                <div className="achievements-list">
                    {filteredAchievements.length === 0 ? (
                        <div className="empty-state">
                            <p>No achievements found</p>
                            <button onClick={handleCreateAchievement} className="create-first-button">
                                Create your first achievement
                            </button>
                        </div>
                    ) : (
                        <div className="achievements-grid">
                            {filteredAchievements.map(achievement => {
                                const goalStyle = getGoalStyle(achievement);
                                const dueDateClass = getDueDateClass(achievement.end_timestamp);

                                return (
                                    <div
                                        key={achievement.id}
                                        className={`achievement-card ${achievement.completed ? 'completed' : ''} ${dueDateClass}`}
                                        onClick={() => handleAchievementClick(achievement)}
                                        onContextMenu={(e) => handleAchievementContextMenu(e, achievement)}
                                        style={{
                                            borderTop: `4px solid ${goalStyle.backgroundColor}`,
                                            border: goalStyle.border,
                                        }}
                                    >
                                        <div className="achievement-header">
                                            <h3 className="achievement-name">{achievement.name}</h3>
                                            {achievement.completed && (
                                                <svg className="completed-icon" fill="currentColor" viewBox="0 0 20 20">
                                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                                </svg>
                                            )}
                                        </div>

                                        {achievement.description && (
                                            <p className="achievement-description">{achievement.description}</p>
                                        )}

                                        <div className="achievement-footer">
                                            <div className={`due-date ${dueDateClass}`}>
                                                <svg className="calendar-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                </svg>
                                                {formatDueDate(achievement.end_timestamp)}
                                            </div>
                                            {achievement.priority && (
                                                <span
                                                    className="priority-indicator"
                                                    data-priority={achievement.priority}
                                                >
                                                    {achievement.priority}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Achievements; 