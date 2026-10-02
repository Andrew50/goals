import React, { useEffect, useState, useMemo } from 'react';
import { privateRequest } from '../../shared/utils/api';
import { goalToLocal } from '../../shared/utils/time';
import { Goal, ApiGoal, NetworkEdge } from '../../types/goals';
import { getGoalStyle, getPriorityBorderColor } from '../../shared/styles/colors';
import GoalMenu from '../../shared/components/GoalMenu';
import { SearchBar } from '../../shared/components/SearchBar';
import CompletionBar from '../../shared/components/CompletionBar';
import NewButton from '../../shared/components/NewButton';
import './Projects.css';

const isResolved = (g: Goal): boolean => !!g.resolution_status && g.resolution_status !== 'pending';

const getCompletionCounts = (items: Goal[]) => {
    const totalCount = items.length;
    const resolvedCount = items.filter(isResolved).length;
    return { totalCount, resolvedCount };
};

const Projects: React.FC = () => {
    const [achievements, setAchievements] = useState<Goal[]>([]);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [filterCompleted, setFilterCompleted] = useState<'all' | 'completed' | 'incomplete'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchIds, setSearchIds] = useState<Set<number>>(new Set());
    const [parentByChild, setParentByChild] = useState<Map<number, Goal>>(new Map());
    const [projects, setProjects] = useState<Goal[]>([]);

    useEffect(() => {
        // Fetch achievements from the API
        privateRequest<ApiGoal[]>('achievements').then(apiGoals => {
            // Convert ApiGoal[] to Goal[] using goalToLocal
            setAchievements(apiGoals.map(goalToLocal));
        });
    }, [refreshTrigger]);

    useEffect(() => {
        // Fetch network to build a mapping from achievement -> parent project.
        // Re-run whenever refreshTrigger changes so newly created or updated goals
        // are reflected in the projects view without a full page reload.
        (async () => {
            try {
                const network = await privateRequest<{ nodes: ApiGoal[]; edges: NetworkEdge[] }>('network');
                const idToGoal = new Map<number, Goal>();
                (network.nodes || []).forEach(api => {
                    const g = goalToLocal(api);
                    if (g.id != null) idToGoal.set(g.id, g);
                });
                // Collect all projects from the network
                const allProjects = Array.from(idToGoal.values()).filter(g => g && g.goal_type === 'project');
                setProjects(allProjects);
                const map = new Map<number, Goal>();
                (network.edges || [])
                    .filter(e => e.relationship_type === 'child')
                    .forEach(e => {
                        const parent = idToGoal.get(e.from as any);
                        const child = idToGoal.get(e.to as any);
                        if (parent && child && child.goal_type === 'achievement' && parent.goal_type === 'project') {
                            map.set(child.id!, parent);
                        }
                    });
                setParentByChild(map);
            } catch {
                // Ignore network mapping failures silently for this view
                setParentByChild(new Map());
                setProjects([]);
            }
        })();
    }, [refreshTrigger]);

    // Build combined search items (projects + achievements)
    const searchItems = useMemo(() => {
        const uniqueProjects = Array.from(new Map(
            (projects || [])
                .filter(p => p && p.id != null)
                .map(p => [p.id!, p])
        ).values());
        return [...achievements, ...uniqueProjects];
    }, [achievements, projects]);

    // Group achievements by parent project, applying filters and search
    const projectGroups = useMemo(() => {
        const groups = new Map<number, { project: Goal; items: Goal[] }>();
        const trimmed = (searchQuery || '').trim();
        const isSearching = !!trimmed;

        // Initialize groups for all projects so we show project bubbles even with no achievements
        (projects || []).forEach(p => {
            if (p && p.id != null) {
                groups.set(p.id, { project: p, items: [] });
            }
        });

        const list = achievements.filter(a => {
            const isCompleted = a.resolution_status && a.resolution_status !== 'pending';
            if (filterCompleted === 'completed') return isCompleted;
            if (filterCompleted === 'incomplete') return !isCompleted;
            return true;
        });

        list.forEach(a => {
            const p = parentByChild.get(a.id);
            if (!p || p.id == null) return; // only show achievements tied to a project
            const g = groups.get(p.id) || { project: p, items: [] };
            g.items.push(a);
            groups.set(p.id, g);
        });

        groups.forEach(g => {
            g.items.sort((a, b) => {
                const ca = (a.resolution_status && a.resolution_status !== 'pending') ? 1 : 0;
                const cb = (b.resolution_status && b.resolution_status !== 'pending') ? 1 : 0;
                if (ca !== cb) return ca - cb; // incomplete first
                const ta = a.end_timestamp ? a.end_timestamp.getTime() : Number.POSITIVE_INFINITY;
                const tb = b.end_timestamp ? b.end_timestamp.getTime() : Number.POSITIVE_INFINITY;
                return ta - tb; // soonest first
            });
        });

        // Convert to array and apply search filtering:
        // - keep groups where project matches search or any child achievement matches search
        let arr = Array.from(groups.values());
        if (isSearching) {
            arr = arr.filter(g => {
                const pid = g.project.id!;
                if (searchIds.has(pid)) return true;
                return g.items.some(i => i.id != null && searchIds.has(i.id));
            });
        }
        arr.sort((ga, gb) => {
            const aHasItems = ga.items.length > 0;
            const bHasItems = gb.items.length > 0;

            // Projects with at least one achievement should come before
            // projects that have no achievements at all.
            if (aHasItems && !bHasItems) return -1;
            if (!aHasItems && bHasItems) return 1;

            const fa = ga.items[0];
            const fb = gb.items[0];
            // Respect resolution_status priority:
            // pending (or unset) should sort above any resolved state (completed/failed/skipped).
            const aPending = !!fa && (!fa.resolution_status || fa.resolution_status === 'pending');
            const bPending = !!fb && (!fb.resolution_status || fb.resolution_status === 'pending');
            if (aPending !== bPending) return aPending ? -1 : 1;

            const ta = fa && fa.end_timestamp ? fa.end_timestamp.getTime() : Number.POSITIVE_INFINITY;
            const tb = fb && fb.end_timestamp ? fb.end_timestamp.getTime() : Number.POSITIVE_INFINITY;
            if (ta !== tb) return ta - tb;
            // tie-breaker by project name to keep stable UI
            const na = (ga.project.name || '').toLowerCase();
            const nb = (gb.project.name || '').toLowerCase();
            if (na < nb) return -1;
            if (na > nb) return 1;
            return 0;
        });
        return arr;
    }, [achievements, parentByChild, filterCompleted, searchQuery, searchIds, projects]);

    // Horizontal auto-scroll disabled for the projects view
    // useEffect(() => {
    //     // Auto-scroll to the achievement whose end date is closest to "now"
    //     const container = scrollContainerRef.current;
    //     if (!container || filteredAchievements.length === 0) return;
    //     const now = Date.now();
    //     let bestIdx = 0;
    //     let bestDiff = Number.POSITIVE_INFINITY;
    //     filteredAchievements.forEach((a, i) => {
    //         const t = a.end_timestamp?.getTime();
    //         if (t == null) return;
    //         const d = Math.abs(t - now);
    //         if (d < bestDiff) {
    //             bestDiff = d;
    //             bestIdx = i;
    //         }
    //     });
    //     const cards = container.querySelectorAll('.achievement-card') as NodeListOf<HTMLElement>;
    //     const el = cards[bestIdx];
    //     if (el) {
    //         const left = el.offsetLeft - container.clientWidth / 2 + el.clientWidth / 2;
    //         container.scrollTo({ left: Math.max(left, 0), behavior: 'auto' });
    //     }
    // }, [filteredAchievements]);

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
        // Allow creating any goal type; if a project is created, update the list immediately
        GoalMenu.open({ goal_type: 'project' } as Goal, 'create', (newGoal) => {
            if (newGoal && newGoal.goal_type === 'project') {
                setProjects(prev => {
                    const exists = prev.some(p => p.id === newGoal.id);
                    return exists ? prev : [...prev, newGoal];
                });
            }
            // Still refresh achievements so new achievements appear
            setRefreshTrigger(prev => prev + 1);
        });
    };

    const handleProjectClick = (project: Goal) => {
        GoalMenu.open(project, 'view', () => {
            setRefreshTrigger(prev => prev + 1);
        });
    };

    const formatDueDate = (timestamp: Date | null | undefined) => {
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

    const getDueDateClass = (timestamp: Date | null | undefined) => {
        if (!timestamp) return '';
        const now = new Date();
        const diffTime = new Date(timestamp).getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return 'overdue';
        if (diffDays <= 3) return 'urgent';
        if (diffDays <= 7) return 'upcoming';
        return '';
    };

    // Suggestions: projects that are not complete and have no incomplete achievements underneath
    const suggestionProjects = useMemo(() => {
        const byProjectId = new Map<number, Goal[]>();
        (achievements || []).forEach(a => {
            const p = parentByChild.get(a.id);
            if (!p || p.id == null || p.goal_type !== 'project') return;
            const arr = byProjectId.get(p.id) || [];
            arr.push(a);
            byProjectId.set(p.id, arr);
        });
        const res = (projects || []).filter(p => {
            if (!p || p.id == null) return false;
            const projectResolved = p.resolution_status && p.resolution_status !== 'pending';
            if (projectResolved) return false;
            const achs = byProjectId.get(p.id) || [];
            // keep if there are no achievements OR all achievements are resolved (completed/failed/skipped)
            return achs.every(a => a.resolution_status && a.resolution_status !== 'pending');
        });
        return res.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }, [projects, achievements, parentByChild]);

    return (
        <div className="achievements-container">
            <div className="achievements-content">
                <div className="achievements-header">
                    <h1 className="achievements-title">Projects</h1>
                    <div className="header-actions">
                        <SearchBar
                            items={searchItems}
                            value={searchQuery}
                            onChange={setSearchQuery}
                            onResults={(_, ids) => setSearchIds(new Set(ids))}
                            size="md"
                            fullWidth={false}
                        />
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
                        <NewButton onClick={handleCreateAchievement} />
                    </div>
                </div>

                {suggestionProjects.length > 0 && (
                    <section className="project-block">
                        <div className="project-block-header">
                            <h2 className="project-heading">Suggestions</h2>
                        </div>
                        {suggestionProjects.map((p) => (
                            <div
                                key={`suggestion-${p.id}`}
                                className="project-row"
                                onClick={() => handleProjectClick(p)}
                            >
                                <span
                                    className="project-dot"
                                    style={{ backgroundColor: getGoalStyle(p).backgroundColor }}
                                />
                                <div className="project-row-main">
                                    <div className="project-row-name">{p.name}</div>
                                    <div className="project-row-meta">No active achievements</div>
                                </div>
                            </div>
                        ))}
                    </section>
                )}

                <div className="achievements-list">
                    {/* Old horizontally scrolling list commented out */}
                    {/* <div className="achievements-scroll" ref={scrollContainerRef}> ... </div> */}
                    {projectGroups.length === 0 ? (
                        <div className="empty-state">
                            <p>No projects found</p>
                            <NewButton onClick={handleCreateAchievement} />
                        </div>
                    ) : (
                        <div className="projects-list">
                            {projectGroups.map(({ project, items }) => {
                                const stats = getCompletionCounts(items);
                                const hasTasks = stats.totalCount > 0;
                                const value = hasTasks ? (stats.resolvedCount / stats.totalCount) : 0;
                                const projectBg = getGoalStyle(project).backgroundColor;
                                return (
                                    <section key={project.id} className="project-block">
                                        <div className="project-block-header">
                                            <span className="project-dot" style={{ backgroundColor: projectBg }} />
                                            <h2
                                                className="project-title"
                                                onClick={() => handleProjectClick(project)}
                                            >
                                                {project.name}
                                            </h2>
                                            <CompletionBar
                                                value={value}
                                                hasTasks={hasTasks}
                                                width={140}
                                                height={8}
                                                style={{ marginLeft: 'auto' }}
                                                title={`${stats.resolvedCount}/${stats.totalCount} resolved`}
                                            />
                                            <span
                                                className="project-count"
                                                title={`${stats.resolvedCount}/${stats.totalCount} resolved`}
                                            >
                                                {stats.resolvedCount}/{stats.totalCount}
                                            </span>
                                        </div>
                                        {items.map(achievement => {
                                            const dueDateClass = getDueDateClass(achievement.end_timestamp);
                                            const isDone = achievement.resolution_status && achievement.resolution_status !== 'pending';
                                            const isHigh = achievement.priority === 'high' && !isDone;
                                            return (
                                                <div
                                                    key={achievement.id}
                                                    className={`project-row ${isDone ? 'done' : ''}`}
                                                    onClick={() => handleAchievementClick(achievement)}
                                                    onContextMenu={(e) => handleAchievementContextMenu(e, achievement)}
                                                >
                                                    <span
                                                        className="project-priority-bar"
                                                        style={{ backgroundColor: isHigh ? getPriorityBorderColor('high') : 'transparent' }}
                                                    />
                                                    <div className="project-row-main">
                                                        <div className="project-row-name">{achievement.name}</div>
                                                        <div className="project-row-meta">
                                                            Achievement{isHigh ? ' · High' : ''}
                                                        </div>
                                                    </div>
                                                    <span className={`project-row-due ${dueDateClass}`}>
                                                        {isDone ? 'Done' : formatDueDate(achievement.end_timestamp)}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </section>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Projects;


