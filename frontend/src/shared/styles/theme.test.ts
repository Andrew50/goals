import { theme } from './theme';

describe('theme', () => {
    test('exports a valid MUI theme', () => {
        expect(theme).toBeDefined();
        expect(theme.palette).toBeDefined();
        expect(theme.typography).toBeDefined();
        expect(theme.components).toBeDefined();
    });

    test('has correct palette colors', () => {
        expect(theme.palette.primary.main).toBe('#4299e1');
        expect(theme.palette.secondary.main).toBe('#718096');
        expect(theme.palette.error.main).toBe('#e53e3e');
        expect(theme.palette.warning.main).toBe('#ed8936');
        expect(theme.palette.success.main).toBe('#48bb78');
    });

    test('has correct z-index for appBar', () => {
        expect(theme.zIndex.appBar).toBe(1200);
    });

    test('has component overrides defined', () => {
        expect(theme.components?.MuiPaper).toBeDefined();
        expect(theme.components?.MuiAppBar).toBeDefined();
        expect(theme.components?.MuiButton).toBeDefined();
        expect(theme.components?.MuiTextField).toBeDefined();
    });

    test('has correct shape borderRadius', () => {
        expect(theme.shape.borderRadius).toBe(8);
    });
});

