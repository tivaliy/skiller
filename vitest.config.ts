import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        // Test file patterns
        include: ['test/unit/**/*.test.ts'],
        exclude: ['**/node_modules/**', '**/out/**'],

        // Environment - Node for extension code
        environment: 'node',

        // Don't inject globals - use explicit imports for clarity
        globals: false,

        // Execution settings
        testTimeout: 5000,
        hookTimeout: 10000,

        // Setup files
        setupFiles: ['./test/setup.ts'],

        // Mocking behavior
        clearMocks: true,
        restoreMocks: true,

        // Reporters
        reporters: ['default'],

        // TypeScript configuration
        typecheck: {
            tsconfig: './tsconfig.test.json',
        },
    },

    // Resolve settings
    resolve: {
        alias: {
            // Mock vscode module for unit tests
            vscode: path.resolve(__dirname, './test/helpers/mocks/vscode.ts'),
        },
    },
});
