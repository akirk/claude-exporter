import { describe, it, expect } from 'vitest';
import utils from '../chrome/utils.js';

const {
  getCurrentBranch,
  convertToMarkdown,
  extractArtifactsFromMessage,
  extractArtifactFiles,
  getFileExtension,
  isProgrammingLanguage,
} = utils;

// Regression coverage for the bug fixed in v1.9.1: bash/web_search/repl
// tool_use entries used to slip through as fake artifacts. Now gated on
// `tool_use.name === 'artifacts'`.
describe('extractArtifactsFromMessage — tool name filter', () => {
  it('rejects a bash tool_use even with code_block display content', () => {
    const message = {
      content: [
        {
          type: 'tool_use',
          name: 'bash',
          display_content: {
            type: 'code_block',
            code: 'ls -la',
            language: 'bash',
            filename: 'cmd.sh',
          },
        },
      ],
    };
    expect(extractArtifactsFromMessage(message)).toEqual([]);
  });

  it('rejects a web_search tool_use', () => {
    const message = {
      content: [
        {
          type: 'tool_use',
          name: 'web_search',
          display_content: {
            type: 'code_block',
            code: 'results...',
            language: 'json',
          },
        },
      ],
    };
    expect(extractArtifactsFromMessage(message)).toEqual([]);
  });

  it('extracts an artifacts tool_use with code_block format', () => {
    const message = {
      content: [
        {
          type: 'tool_use',
          name: 'artifacts',
          display_content: {
            type: 'code_block',
            code: 'def hello():\n    pass',
            language: 'python',
            filename: 'hello.py',
          },
        },
      ],
    };
    const artifacts = extractArtifactsFromMessage(message);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe('hello');
    expect(artifacts[0].language).toBe('python');
    expect(artifacts[0].content).toBe('def hello():\n    pass');
  });

  it('extracts an artifacts tool_use with json_block format when filename is present', () => {
    const message = {
      content: [
        {
          type: 'tool_use',
          name: 'artifacts',
          display_content: {
            type: 'json_block',
            json_block: JSON.stringify({
              filename: 'app.js',
              language: 'javascript',
              code: 'console.log("hi");',
            }),
          },
        },
      ],
    };
    const artifacts = extractArtifactsFromMessage(message);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe('app');
  });

  it('rejects a json_block artifacts entry that has no filename', () => {
    const message = {
      content: [
        {
          type: 'tool_use',
          name: 'artifacts',
          display_content: {
            type: 'json_block',
            json_block: JSON.stringify({
              code: 'echo hi',
            }),
          },
        },
      ],
    };
    expect(extractArtifactsFromMessage(message)).toEqual([]);
  });
});

describe('extractArtifactFiles — end-to-end', () => {
  function makeConversationWithMessages(messages) {
    const last = messages[messages.length - 1];
    return {
      current_leaf_message_uuid: last.uuid,
      chat_messages: messages,
    };
  }

  it('returns artifact files only from real artifact tool calls', () => {
    const data = makeConversationWithMessages([
      {
        uuid: 'm1',
        sender: 'human',
        content: [{ type: 'text', text: 'make me something' }],
        parent_message_uuid: '00000000-0000-0000-0000-000000000000',
      },
      {
        uuid: 'm2',
        sender: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'artifacts',
            display_content: {
              type: 'code_block',
              code: '<h1>hi</h1>',
              language: 'html',
              filename: 'page.html',
            },
          },
          {
            type: 'tool_use',
            name: 'bash',
            display_content: {
              type: 'code_block',
              code: 'ls',
              language: 'bash',
              filename: 'noise.sh',
            },
          },
        ],
        parent_message_uuid: 'm1',
      },
    ]);
    const files = extractArtifactFiles(data);
    expect(files).toHaveLength(1);
    expect(files[0].filename).toMatch(/\.html$/);
  });

  it('deduplicates duplicate filenames with a counter suffix', () => {
    const data = makeConversationWithMessages([
      {
        uuid: 'm1',
        sender: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'artifacts',
            display_content: {
              type: 'code_block',
              code: 'a',
              language: 'javascript',
              filename: 'app.js',
            },
          },
          {
            type: 'tool_use',
            name: 'artifacts',
            display_content: {
              type: 'code_block',
              code: 'b',
              language: 'javascript',
              filename: 'app.js',
            },
          },
        ],
        parent_message_uuid: '00000000-0000-0000-0000-000000000000',
      },
    ]);
    const files = extractArtifactFiles(data);
    expect(files).toHaveLength(2);
    const names = files.map(f => f.filename);
    expect(new Set(names).size).toBe(2); // both unique
  });
});

describe('getCurrentBranch', () => {
  it('returns empty array when there are no messages', () => {
    expect(getCurrentBranch({ chat_messages: [], current_leaf_message_uuid: 'x' })).toEqual([]);
  });

  it('returns empty array when leaf uuid is missing', () => {
    expect(getCurrentBranch({ chat_messages: [{ uuid: 'a' }] })).toEqual([]);
  });

  it('walks from leaf back to root in chronological order', () => {
    const data = {
      current_leaf_message_uuid: 'm3',
      chat_messages: [
        { uuid: 'm1', parent_message_uuid: 'root', text: 'first' },
        { uuid: 'm2', parent_message_uuid: 'm1', text: 'second' },
        { uuid: 'm3', parent_message_uuid: 'm2', text: 'third' },
      ],
    };
    const branch = getCurrentBranch(data);
    expect(branch.map(m => m.uuid)).toEqual(['m1', 'm2', 'm3']);
  });

  it('only includes messages on the current branch (ignores siblings)', () => {
    // m1 → m2a → m3 (current leaf), m1 → m2b is a sibling branch and should be excluded
    const data = {
      current_leaf_message_uuid: 'm3',
      chat_messages: [
        { uuid: 'm1', parent_message_uuid: 'root', text: 'first' },
        { uuid: 'm2a', parent_message_uuid: 'm1', text: 'kept' },
        { uuid: 'm2b', parent_message_uuid: 'm1', text: 'sibling' },
        { uuid: 'm3', parent_message_uuid: 'm2a', text: 'leaf' },
      ],
    };
    const branch = getCurrentBranch(data);
    expect(branch.map(m => m.uuid)).toEqual(['m1', 'm2a', 'm3']);
  });
});

describe('getFileExtension', () => {
  it('maps common programming languages correctly', () => {
    expect(getFileExtension('javascript')).toBe('.js');
    expect(getFileExtension('python')).toBe('.py');
    expect(getFileExtension('bash')).toBe('.sh');
  });

  it('falls back to .txt for unknown languages', () => {
    expect(getFileExtension('totally-not-a-language')).toBe('.txt');
  });
});

describe('isProgrammingLanguage', () => {
  it('recognizes common programming languages', () => {
    expect(isProgrammingLanguage('javascript')).toBe(true);
    expect(isProgrammingLanguage('python')).toBe(true);
    expect(isProgrammingLanguage('rust')).toBe(true);
  });

  it('rejects markup/document formats', () => {
    expect(isProgrammingLanguage('markdown')).toBe(false);
  });
});

describe('convertToMarkdown — smoke test', () => {
  it('renders both human and assistant message text', () => {
    const data = {
      name: 'Test Chat',
      model: 'claude-sonnet-4-5-20250929',
      created_at: '2026-04-01T12:00:00Z',
      updated_at: '2026-04-01T12:00:00Z',
      current_leaf_message_uuid: 'm2',
      chat_messages: [
        {
          uuid: 'm1',
          sender: 'human',
          content: [{ type: 'text', text: 'Hello there' }],
          parent_message_uuid: '00000000-0000-0000-0000-000000000000',
        },
        {
          uuid: 'm2',
          sender: 'assistant',
          content: [{ type: 'text', text: 'General Kenobi' }],
          parent_message_uuid: 'm1',
        },
      ],
    };
    const md = convertToMarkdown(data, false);
    expect(md).toContain('Hello there');
    expect(md).toContain('General Kenobi');
  });

  it('includes metadata block when includeMetadata is true', () => {
    const data = {
      name: 'My Chat',
      model: 'claude-opus-4-5-20251101',
      created_at: '2026-04-01T12:00:00Z',
      updated_at: '2026-04-01T12:00:00Z',
      current_leaf_message_uuid: 'm1',
      chat_messages: [
        {
          uuid: 'm1',
          sender: 'human',
          content: [{ type: 'text', text: 'hi' }],
          parent_message_uuid: '00000000-0000-0000-0000-000000000000',
        },
      ],
    };
    const md = convertToMarkdown(data, true);
    expect(md).toContain('My Chat');
  });
});
