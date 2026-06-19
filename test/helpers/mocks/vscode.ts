/**
 * Minimal VS Code API mock for unit tests
 *
 * Only mock what's needed - add more as tests require.
 * This file is aliased to 'vscode' in vitest.config.ts.
 */

import { vi } from 'vitest';

// Language Model Chat Message
export const LanguageModelChatMessage = {
    User: vi.fn((content: string | unknown[]) => ({ role: 'user', content })),
    Assistant: vi.fn((content: string | unknown[]) => ({ role: 'assistant', content })),
};

// Language Model Parts
export class LanguageModelTextPart {
    constructor(public readonly value: string) {}
}

export class LanguageModelToolCallPart {
    constructor(
        public readonly callId: string,
        public readonly name: string,
        public readonly input: unknown
    ) {}
}

export class LanguageModelToolResultPart {
    constructor(
        public readonly callId: string,
        public readonly content: unknown
    ) {}
}

// Tool Mode enum
export const LanguageModelChatToolMode = {
    Auto: 'Auto' as const,
    Required: 'Required' as const,
};

// Language Model namespace
export const lm = {
    tools: [] as Array<{ name: string; description: string; inputSchema: unknown }>,
    invokeTool: vi.fn(),
    selectChatModels: vi.fn().mockResolvedValue([]),
};

// CancellationToken mock
export class CancellationTokenSource {
    token = { isCancellationRequested: false };
    cancel = vi.fn();
    dispose = vi.fn();
}

// EventEmitter mock (matches vscode.EventEmitter shape)
export class EventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];

    event = (listener: (e: T) => void): { dispose: () => void } => {
        this.listeners.push(listener);
        return {
            dispose: () => {
                const index = this.listeners.indexOf(listener);
                if (index >= 0) {
                    this.listeners.splice(index, 1);
                }
            }
        };
    };

    fire(data: T): void {
        for (const listener of this.listeners.slice()) {
            listener(data);
        }
    }

    dispose(): void {
        this.listeners = [];
    }
}

// FileType enum (matches vscode.FileType)
export enum FileType {
    Unknown = 0,
    File = 1,
    Directory = 2,
    SymbolicLink = 64,
}

// FileSystemError class (matches vscode.FileSystemError)
export class FileSystemError extends Error {
    static FileNotFound(messageOrUri?: string | { fsPath: string }): FileSystemError {
        const msg = typeof messageOrUri === 'string' ? messageOrUri : messageOrUri?.fsPath;
        return new FileSystemError(`FileNotFound: ${msg}`);
    }
    static FileExists(messageOrUri?: string | { fsPath: string }): FileSystemError {
        const msg = typeof messageOrUri === 'string' ? messageOrUri : messageOrUri?.fsPath;
        return new FileSystemError(`FileExists: ${msg}`);
    }
    static FileNotADirectory(messageOrUri?: string | { fsPath: string }): FileSystemError {
        const msg = typeof messageOrUri === 'string' ? messageOrUri : messageOrUri?.fsPath;
        return new FileSystemError(`FileNotADirectory: ${msg}`);
    }
    static FileIsADirectory(messageOrUri?: string | { fsPath: string }): FileSystemError {
        const msg = typeof messageOrUri === 'string' ? messageOrUri : messageOrUri?.fsPath;
        return new FileSystemError(`FileIsADirectory: ${msg}`);
    }
    static NoPermissions(messageOrUri?: string | { fsPath: string }): FileSystemError {
        const msg = typeof messageOrUri === 'string' ? messageOrUri : messageOrUri?.fsPath;
        return new FileSystemError(`NoPermissions: ${msg}`);
    }
    static Unavailable(messageOrUri?: string | { fsPath: string }): FileSystemError {
        const msg = typeof messageOrUri === 'string' ? messageOrUri : messageOrUri?.fsPath;
        return new FileSystemError(`Unavailable: ${msg}`);
    }
    readonly code?: string;
}

// Uri class (matches vscode.Uri)
export class Uri {
    readonly scheme: string;
    readonly authority: string;
    readonly path: string;
    readonly query: string;
    readonly fragment: string;
    readonly fsPath: string;

    private constructor(scheme: string, authority: string, path: string, query: string, fragment: string) {
        this.scheme = scheme;
        this.authority = authority;
        this.path = path;
        this.query = query;
        this.fragment = fragment;
        this.fsPath = path;
    }

    static file(path: string): Uri {
        return new Uri('file', '', path, '', '');
    }

    static parse(value: string): Uri {
        return new Uri('file', '', value, '', '');
    }

    static joinPath(base: Uri, ...pathSegments: string[]): Uri {
        const joined = [base.path, ...pathSegments].join('/');
        return new Uri(base.scheme, base.authority, joined, base.query, base.fragment);
    }

    static from(components: {
        scheme: string;
        authority?: string;
        path?: string;
        query?: string;
        fragment?: string;
    }): Uri {
        return new Uri(
            components.scheme,
            components.authority ?? '',
            components.path ?? '',
            components.query ?? '',
            components.fragment ?? ''
        );
    }

    with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
        return new Uri(
            change.scheme ?? this.scheme,
            change.authority ?? this.authority,
            change.path ?? this.path,
            change.query ?? this.query,
            change.fragment ?? this.fragment
        );
    }

    toString(): string {
        return `${this.scheme}://${this.path}`;
    }
}

// Workspace configuration mock with fs support
export const workspace = {
    getConfiguration: vi.fn(() => ({
        get: vi.fn(),
        update: vi.fn(),
        has: vi.fn(),
        inspect: vi.fn(),
    })),
    workspaceFolders: undefined as
        | Array<{ uri: { fsPath: string }; name: string }>
        | undefined,
    fs: {
        stat: vi.fn().mockResolvedValue({
            type: FileType.File,
            ctime: Date.now(),
            mtime: Date.now(),
            size: 100,
        }),
        readFile: vi.fn().mockResolvedValue(new Uint8Array()),
        readDirectory: vi.fn().mockResolvedValue([]),
        writeFile: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        rename: vi.fn().mockResolvedValue(undefined),
        copy: vi.fn().mockResolvedValue(undefined),
        createDirectory: vi.fn().mockResolvedValue(undefined),
    },
};

// Export default for module resolution
export default {
    LanguageModelChatMessage,
    LanguageModelTextPart,
    LanguageModelToolCallPart,
    LanguageModelToolResultPart,
    LanguageModelChatToolMode,
    lm,
    CancellationTokenSource,
    EventEmitter,
    FileType,
    FileSystemError,
    Uri,
    workspace,
};
