import { Goal, NetworkNode } from '../../types/goals';
import { getGoalStyle } from '../styles/colors';

export const formatNetworkNode = (localGoal: Goal): NetworkNode => {
  const { backgroundColor, border, textColor, borderColor } = getGoalStyle(localGoal);

  const borderWidthMatch = border.match(/(\d+)px/);
  const borderWidth = borderWidthMatch ? parseInt(borderWidthMatch[1], 10) : 0;

  return {
    ...localGoal,
    label: localGoal.name,
    title: `${localGoal.name} (${localGoal.goal_type})`,
    color: {
      background: backgroundColor,
      border: borderColor,
      highlight: { background: backgroundColor, border: borderColor },
      hover: { background: backgroundColor, border: borderColor }
    },
    borderWidth,
    font: { color: textColor }
  };
};

export default formatNetworkNode;


