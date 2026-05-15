// Shared utility functions for Claude Exporter

// Helper function to reconstruct the current branch from the message tree
function getCurrentBranch(data) {
  if (!data.chat_messages || !data.current_leaf_message_uuid) {
    return [];
  }
  
  // Create a map of UUID to message for quick lookup
  const messageMap = new Map();
  data.chat_messages.forEach(msg => {
    messageMap.set(msg.uuid, msg);
  });
  
  // Trace back from the current leaf to the root
  const branch = [];
  let currentUuid = data.current_leaf_message_uuid;
  
  while (currentUuid && messageMap.has(currentUuid)) {
    const message = messageMap.get(currentUuid);
    branch.unshift(message); // Add to beginning to maintain order
    currentUuid = message.parent_message_uuid;
    
    // Stop if we hit the root (parent UUID that doesn't exist in our messages)
    if (!messageMap.has(currentUuid)) {
      break;
    }
  }
  
  return branch;
}

// Convert to markdown format
function convertToMarkdown(data, includeMetadata, conversationId = null, includeArtifacts = true, includeThinking = true) {
  console.log('🔧 convertToMarkdown - conversationId:', conversationId, 'includeArtifacts:', includeArtifacts, 'includeThinking:', includeThinking);
  let markdown = `# ${data.name || 'Untitled Conversation'}\n\n`;

  if (includeMetadata) {
    markdown += `**Created:** ${new Date(data.created_at).toLocaleString()}\n`;
    markdown += `**Updated:** ${new Date(data.updated_at).toLocaleString()}\n`;
    markdown += `**Exported:** ${new Date().toLocaleString()}\n`;
    markdown += `**Model:** ${data.model}\n`;
    if (conversationId) {
      markdown += `**Link:** [https://claude.ai/chat/${conversationId}](https://claude.ai/chat/${conversationId})\n`;
    }
    if (data.truncated !== undefined) {
      markdown += `**Truncated:** ${data.truncated}\n`;
    }
    markdown += `\n---\n\n`;
  }

  // Get only the current branch messages
  const branchMessages = getCurrentBranch(data);

  for (const message of branchMessages) {
    const sender = message.sender === 'human' ? '## User' : '## Claude';
    markdown += `${sender}\n`;

    if (includeMetadata && message.created_at) {
      markdown += `**${new Date(message.created_at).toISOString()}**\n`;
    }
    markdown += `\n`;

    // Extract artifacts from the entire message (handles both old and new formats)
    const messageArtifacts = includeArtifacts ? extractArtifactsFromMessage(message) : [];
    if (messageArtifacts.length > 0) {
      console.log('📦 Found', messageArtifacts.length, 'artifact(s) in message:', messageArtifacts.map(a => a.title));
    }

    // Render message text (excluding tool_use and artifact tags)
    if (message.content) {
      for (const content of message.content) {
        // Handle thinking blocks (extended thinking)
        if (content.type === 'thinking' && content.thinking && includeThinking) {
          markdown += `### Thinking\n\`\`\`\`\n${content.thinking}\n\`\`\`\`\n\n`;
        }
        // Handle regular text content (skip tool_use, we handle artifacts separately)
        else if (content.type === 'text' && content.text) {
          // Remove old-format artifact tags from text
          let textWithoutArtifacts = content.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
          if (textWithoutArtifacts) {
            markdown += `${textWithoutArtifacts}\n\n`;
          }
        }
      }
    } else if (message.text) {
      // Handle old format - remove artifact tags from text
      let textWithoutArtifacts = message.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
      if (textWithoutArtifacts) {
        markdown += `${textWithoutArtifacts}\n\n`;
      }
    }

    // Handle attachments (file uploads and pasted content)
    if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        if (attachment.file_name) {
          // File attachment — show file metadata + extracted content if present
          let header = `### Attachment: ${attachment.file_name}`;
          const meta = [];
          if (attachment.file_size) {
            meta.push(`${(attachment.file_size / 1024).toFixed(1)} KB`);
          }
          if (attachment.file_type) {
            meta.push(attachment.file_type);
          }
          if (meta.length > 0) {
            header += ` _(${meta.join(', ')})_`;
          }
          markdown += `${header}\n`;
          if (attachment.extracted_content) {
            markdown += `\`\`\`\`\n${attachment.extracted_content}\n\`\`\`\`\n\n`;
          } else {
            markdown += `\n`;
          }
        } else if (attachment.extracted_content) {
          // Pasted content (no file_name) — legacy label
          markdown += `### Pasted\n\`\`\`\`\n${attachment.extracted_content}\n\`\`\`\`\n\n`;
        }
      }
    }

    // Render all artifacts found in the message
    for (const artifact of messageArtifacts) {
      markdown += `#### 📦 Artifact: ${artifact.title}\n`;
      markdown += `**Type:** ${artifact.type} | **Language:** ${artifact.language}\n\n`;

      if (artifact.type === 'code' || isProgrammingLanguage(artifact.language)) {
        markdown += `\`\`\`${artifact.language}\n${artifact.content}\n\`\`\`\n\n`;
      } else {
        markdown += `${artifact.content}\n\n`;
      }
    }
  }

  return markdown;
}

// Convert to plain text
function convertToText(data, includeMetadata, includeArtifacts = true, includeThinking = true) {
  let text = '';

  // Add metadata header if requested
  if (includeMetadata) {
    text += `${data.name || 'Untitled Conversation'}\n`;
    text += `Created: ${new Date(data.created_at).toLocaleString()}\n`;
    text += `Updated: ${new Date(data.updated_at).toLocaleString()}\n`;
    text += `Model: ${data.model}\n\n`;
    text += '---\n\n';
  }

  // Get only the current branch messages
  const branchMessages = getCurrentBranch(data);

  branchMessages.forEach((message) => {
    // Extract artifacts from the entire message (handles both old and new formats)
    const artifacts = includeArtifacts ? extractArtifactsFromMessage(message) : [];

    // Get the message text (excluding artifacts)
    let messageText = '';
    let thinkingText = '';
    if (message.content) {
      for (const content of message.content) {
        // Handle thinking blocks
        if (content.type === 'thinking' && content.thinking && includeThinking) {
          const summary = content.summaries && content.summaries.length > 0
            ? content.summaries[content.summaries.length - 1].summary
            : 'Thought process';
          thinkingText += `[Thinking: ${summary}]\n${content.thinking}\n[End Thinking]\n\n`;
        }
        // Only include text content, skip tool_use
        else if (content.type === 'text' && content.text) {
          // Remove old-format artifact tags
          messageText += content.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim() + ' ';
        }
      }
    } else if (message.text) {
      // Handle old format - remove artifact tags
      messageText = message.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
    }

    messageText = messageText.trim();

    // Use full label for all messages
    let senderLabel;
    if (message.sender === 'human') {
      senderLabel = 'User';
    } else {
      senderLabel = 'Claude';
    }

    // Add thinking text if present
    if (thinkingText) {
      text += thinkingText;
    }

    text += `${senderLabel}: ${messageText}\n`;

    // Add artifacts if present
    if (artifacts.length > 0) {
      for (const artifact of artifacts) {
        text += `\n[Artifact: ${artifact.title} (${artifact.language})]\n`;
        text += `${artifact.content}\n`;
        text += `[End Artifact]\n`;
      }
    }

    // Add pasted content if present
    if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        if (attachment.extracted_content) {
          const size = attachment.file_size ? ` (${attachment.file_size} bytes)` : '';
          text += `\n[Pasted content${size}]\n`;
          text += `${attachment.extracted_content}\n`;
          text += `[End Pasted content]\n`;
        }
      }
    }

    text += `\n`;
  });

  return text.trim();
}

// Download file utility
function downloadFile(content, filename, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================================
// Artifact Extraction Functions
// ============================================================================

// Extract artifacts from message content (supports both old and new formats)
function extractArtifactsFromMessage(message) {
  const artifacts = [];

  // Check if message has content array (new format)
  if (message.content && Array.isArray(message.content)) {
    for (const content of message.content) {
      // NEW FORMAT: tool_use with display_content
      // Only the `artifacts` tool produces real artifacts — bash, web_search, repl, etc. are filtered out
      if (content.type === 'tool_use' && content.name === 'artifacts' && content.display_content) {
        const displayContent = content.display_content;

        // Check for code_block format (newer artifact format)
        if (displayContent.type === 'code_block' && displayContent.code) {
          const language = displayContent.language || 'txt';
          const code = displayContent.code || '';
          const filename = displayContent.filename || 'artifact';

          // Extract title from filename (remove path and extension)
          const title = filename.split('/').pop().replace(/\.[^.]+$/, '');

          artifacts.push({
            title: title || 'Untitled',
            language: language,
            type: isProgrammingLanguage(language) ? 'code' : 'document',
            identifier: null,
            content: code.trim(),
          });
        }
        // Check for json_block format (older artifact format)
        else if (displayContent.type === 'json_block' && displayContent.json_block) {
          try {
            const artifactData = JSON.parse(displayContent.json_block);

            // Only treat as artifact if it has a filename (real artifacts, not tool uses like bash)
            if (artifactData.filename) {
              // Extract artifact details
              const language = artifactData.language || 'txt';
              const code = artifactData.code || '';
              const filename = artifactData.filename;

              // Extract title from filename (remove path and extension)
              const title = filename.split('/').pop().replace(/\.[^.]+$/, '');

              artifacts.push({
                title: title || 'Untitled',
                language: language,
                type: isProgrammingLanguage(language) ? 'code' : 'document',
                identifier: null,
                content: code.trim(),
              });
            }
          } catch (e) {
            // JSON parse failed, skip this artifact
            console.warn('Failed to parse artifact json_block:', e);
          }
        }
      }

      // OLD FORMAT: Check text content for <antArtifact> tags
      if (content.text) {
        const textArtifacts = extractArtifactsFromText(content.text);
        artifacts.push(...textArtifacts);
      }
    }
  }

  // Fallback: Check message.text directly (older format)
  if (message.text) {
    const textArtifacts = extractArtifactsFromText(message.text);
    artifacts.push(...textArtifacts);
  }

  return artifacts;
}

// Extract artifacts from text using regex (OLD FORMAT: <antArtifact> tags)
function extractArtifactsFromText(text) {
  const artifactRegex = /<antArtifact[^>]*>([\s\S]*?)<\/antArtifact>/g;
  const artifacts = [];
  let match;

  while ((match = artifactRegex.exec(text)) !== null) {
    const fullTag = match[0];
    const content = match[1];

    // Extract attributes - handle both old and new formats
    const titleMatch = fullTag.match(/title="([^"]*)"/);
    const typeMatch = fullTag.match(/type="([^"]*)"/);
    const languageMatch = fullTag.match(/language="([^"]*)"/);
    const identifierMatch = fullTag.match(/identifier="([^"]*)"/);

    // Determine the artifact type and language
    let artifactType = 'text';
    let language = 'txt';

    if (typeMatch) {
      const type = typeMatch[1];
      // Map type to language/format
      if (type === 'text/html') {
        language = 'html';
        artifactType = 'code';
      } else if (type === 'text/markdown') {
        language = 'markdown';
        artifactType = 'document';
      } else if (type === 'application/vnd.ant.code') {
        language = languageMatch ? languageMatch[1] : 'txt';
        artifactType = 'code';
      } else if (type === 'text/css') {
        language = 'css';
        artifactType = 'code';
      } else if (type === 'application/vnd.ant.mermaid') {
        language = 'mermaid';
        artifactType = 'document';
      } else if (type === 'application/vnd.ant.react') {
        language = 'jsx';
        artifactType = 'code';
      } else if (type === 'image/svg+xml') {
        language = 'svg';
        artifactType = 'code';
      }
    } else if (languageMatch) {
      // Old format - just language attribute
      language = languageMatch[1];
      artifactType = 'code';
    }

    artifacts.push({
      title: titleMatch ? titleMatch[1] : 'Untitled',
      language: language,
      type: artifactType,
      identifier: identifierMatch ? identifierMatch[1] : null,
      content: content.trim(),
    });
  }

  return artifacts;
}

// Legacy function name for backward compatibility
function extractArtifacts(text) {
  return extractArtifactsFromText(text);
}

// Get file extension from language
function getFileExtension(language) {
  const languageToExt = {
    javascript: '.js',
    html: '.html',
    css: '.css',
    python: '.py',
    java: '.java',
    c: '.c',
    cpp: '.cpp',
    'c++': '.cpp',
    ruby: '.rb',
    php: '.php',
    swift: '.swift',
    go: '.go',
    rust: '.rs',
    typescript: '.ts',
    tsx: '.tsx',
    jsx: '.jsx',
    shell: '.sh',
    bash: '.sh',
    sql: '.sql',
    kotlin: '.kt',
    scala: '.scala',
    r: '.r',
    matlab: '.m',
    json: '.json',
    xml: '.xml',
    yaml: '.yaml',
    yml: '.yml',
    markdown: '.md',
    md: '.md',
    text: '.txt',
    txt: '.txt',
    latex: '.tex',
    tex: '.tex',
    bibtex: '.bib',
    bib: '.bib',
    mermaid: '.mmd',
    svg: '.svg',
    csv: '.csv',
    toml: '.toml',
    ini: '.ini',
    perl: '.pl',
    lua: '.lua',
    dart: '.dart',
    elixir: '.ex',
    erlang: '.erl',
    haskell: '.hs',
    clojure: '.clj',
    fsharp: '.fs',
    'f#': '.fs',
    'c#': '.cs',
    csharp: '.cs',
    'objective-c': '.m',
    ocaml: '.ml',
    scheme: '.scm',
    lisp: '.lisp',
    fortran: '.f90',
    assembly: '.asm',
    asm: '.asm',
    scss: '.scss',
    sass: '.sass',
    less: '.less',
    stylus: '.styl',
    dockerfile: '.dockerfile',
    makefile: '.mk',
    gradle: '.gradle',
    groovy: '.groovy',
  };
  return languageToExt[language.toLowerCase()] || '.txt';
}

// Check if a language is a programming language (should be saved in original format only)
function isProgrammingLanguage(language) {
  const programmingLanguages = [
    'javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'c++', 'ruby', 'php',
    'swift', 'go', 'rust', 'jsx', 'tsx', 'shell', 'bash', 'sql', 'kotlin', 'scala',
    'r', 'perl', 'lua', 'dart', 'elixir', 'erlang', 'haskell', 'clojure', 'fsharp',
    'f#', 'c#', 'csharp', 'objective-c', 'ocaml', 'scheme', 'lisp', 'fortran',
    'assembly', 'asm', 'groovy', 'html', 'css', 'scss', 'sass', 'less', 'stylus'
  ];
  return programmingLanguages.includes(language.toLowerCase());
}

// Convert artifact content and filename based on selected format
function convertArtifactFormat(content, language, baseFilename, format) {
  // Get original extension
  const originalExtension = getFileExtension(language);

  // Keep code files and non-markdown files in original format
  if (isProgrammingLanguage(language) || originalExtension !== '.md') {
    return {
      filename: `${baseFilename}${originalExtension}`,
      content: content
    };
  }

  // For markdown documents, convert based on selected format
  switch (format) {
    case 'markdown':
    case 'original':
      // Keep as markdown
      return {
        filename: `${baseFilename}.md`,
        content: content
      };

    case 'text':
      // Convert to plain text (remove markdown formatting)
      let plainText = content;

      // Remove code blocks
      plainText = plainText.replace(/```[\s\S]*?```/g, (match) => {
        // Extract just the code content without backticks and language
        return match.replace(/```\w*\n?/, '').replace(/\n?```$/, '');
      });

      // Remove inline code
      plainText = plainText.replace(/`([^`]+)`/g, '$1');

      // Remove bold/italic
      plainText = plainText.replace(/\*\*([^*]+)\*\*/g, '$1');
      plainText = plainText.replace(/\*([^*]+)\*/g, '$1');
      plainText = plainText.replace(/__([^_]+)__/g, '$1');
      plainText = plainText.replace(/_([^_]+)_/g, '$1');

      // Remove headers (replace with just the text)
      plainText = plainText.replace(/^#{1,6}\s+(.+)$/gm, '$1');

      // Remove links but keep text
      plainText = plainText.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

      // Remove images
      plainText = plainText.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');

      // Remove horizontal rules
      plainText = plainText.replace(/^[-*_]{3,}$/gm, '');

      // Clean up excessive newlines
      plainText = plainText.replace(/\n{3,}/g, '\n\n');

      return {
        filename: `${baseFilename}.txt`,
        content: plainText.trim()
      };

    case 'json':
      // Convert to JSON format
      const jsonData = {
        title: baseFilename,
        language: language,
        content: content,
        format: 'markdown'
      };

      return {
        filename: `${baseFilename}.json`,
        content: JSON.stringify(jsonData, null, 2)
      };

    default:
      // Default to original format
      return {
        filename: `${baseFilename}${originalExtension}`,
        content: content
      };
  }
}

// Extract all artifacts from a conversation into separate files
function extractArtifactFiles(data, artifactFormat = 'original') {
  const artifactFiles = [];
  const usedFilenames = new Set();

  // Get only the current branch messages
  const branchMessages = getCurrentBranch(data);

  for (const message of branchMessages) {
    const artifacts = extractArtifactsFromMessage(message);

    for (const artifact of artifacts) {
      // Generate filename from title and language
      let baseFilename = artifact.title || 'artifact';
      // Sanitize filename (remove invalid characters)
      baseFilename = baseFilename.replace(/[<>:"/\\|?*]/g, '_');

      // Convert artifact based on selected format
      const converted = convertArtifactFormat(
        artifact.content,
        artifact.language,
        baseFilename,
        artifactFormat
      );

      let filename = converted.filename;

      // Handle duplicate filenames
      let counter = 1;
      const extensionMatch = filename.match(/(\.[^.]+)$/);
      const extension = extensionMatch ? extensionMatch[1] : '';
      const nameWithoutExt = extension ? filename.slice(0, -extension.length) : filename;

      while (usedFilenames.has(filename)) {
        filename = `${nameWithoutExt}_${counter}${extension}`;
        counter++;
      }

      usedFilenames.add(filename);

      artifactFiles.push({
        filename: filename,
        content: converted.content
      });
    }
  }

  return artifactFiles;
}
// ----- Model utilities -----

// Default model timeline for null models — each entry is when that model became the default
const DEFAULT_MODEL_TIMELINE = [
  { date: new Date('2024-01-01'), model: 'claude-3-sonnet-20240229' },
  { date: new Date('2024-06-20'), model: 'claude-3-5-sonnet-20240620' },
  { date: new Date('2024-10-22'), model: 'claude-3-5-sonnet-20241022' },
  { date: new Date('2025-02-24'), model: 'claude-3-7-sonnet-20250219' },
  { date: new Date('2025-05-22'), model: 'claude-sonnet-4-20250514' },
  { date: new Date('2025-09-29'), model: 'claude-sonnet-4-5-20250929' },
  { date: new Date('2026-02-17'), model: 'claude-sonnet-4-6' }
];

// Returns conversation.model if set; otherwise infers from created_at via the timeline
function inferModel(conversation) {
  if (conversation.model) {
    return conversation.model;
  }
  const conversationDate = new Date(conversation.created_at);
  for (let i = DEFAULT_MODEL_TIMELINE.length - 1; i >= 0; i--) {
    if (conversationDate >= DEFAULT_MODEL_TIMELINE[i].date) {
      return DEFAULT_MODEL_TIMELINE[i].model;
    }
  }
  return DEFAULT_MODEL_TIMELINE[0].model;
}

// Format a model ID like `claude-sonnet-4-5-20250929` into "Claude Sonnet 4.5".
// Schema reference: https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions
// Handles three documented shapes for the sonnet/opus/haiku families:
//   - Dateless 4.6+:        claude-{name}-{major}-{minor}            (canonical snapshot)
//   - Dated pre-4.6:        claude-{name}-{major}-{minor}-{YYYYMMDD}
//   - Convenience alias:    claude-{name}-{major}-{minor}            (resolves to most recent dated snapshot)
// Unknown families (anything not in `(sonnet|opus|haiku)`) fall through to raw display.
function formatModelName(model) {
  if (!model || !model.startsWith('claude-')) {
    return model || 'Unknown';
  }

  // New format: claude-{type}-{major}[-{minor}][-{date}]
  const newFormatMatch = model.match(/^claude-(sonnet|opus|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i);
  if (newFormatMatch) {
    const [, modelType, major, minor] = newFormatMatch;
    const modelName = modelType.charAt(0).toUpperCase() + modelType.slice(1);
    const version = minor ? `${major}.${minor}` : major;
    return `Claude ${modelName} ${version}`;
  }

  // Old format: claude-{major}[-{minor}]-{type}-{date}
  const oldFormatMatch = model.match(/^claude-(\d+)(?:-(\d+))?-(sonnet|opus|haiku)-\d{8}$/i);
  if (oldFormatMatch) {
    const [, major, minor, modelType] = oldFormatMatch;
    const modelName = modelType.charAt(0).toUpperCase() + modelType.slice(1);
    const version = minor ? `${major}.${minor}` : major;
    return `Claude ${modelName} ${version}`;
  }

  return model;
}

// Returns CSS badge class name based on the model family
function getModelBadgeClass(model) {
  if (!model) return '';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  return '';
}

// ----- Extension data backup / restore -----

// Download all extension storage (local + sync) as a structured JSON file.
// onComplete(success, message) reports the result so each caller can show it
// its own way (options page status line vs. browse-page toast).
function backupExtensionData(onComplete) {
  chrome.storage.local.get(null, (local) => {
    chrome.storage.sync.get(null, (sync) => {
      const backup = {
        _meta: {
          app: 'claude-exporter',
          backupVersion: 1,
          extensionVersion: chrome.runtime.getManifest().version,
          createdAt: new Date().toISOString()
        },
        local: local || {},
        sync: sync || {}
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `claude-exporter-backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const snapCount = Object.keys(backup.local.modelSnapshots || {}).length;
      const exportCount = Object.keys(backup.local.exportTimestamps || {}).length;
      if (onComplete) onComplete(true, `Backup downloaded — ${snapCount} model snapshot(s), ${exportCount} export record(s).`);
    });
  });
}

// Restore extension storage from a file produced by backupExtensionData.
// Validates the file, confirms with the user, then writes to local + sync.
function restoreExtensionData(file, onComplete) {
  const reader = new FileReader();
  reader.onload = (e) => {
    let backup;
    try {
      backup = JSON.parse(e.target.result);
    } catch (err) {
      if (onComplete) onComplete(false, 'Restore failed: the file is not valid JSON.');
      return;
    }

    // Make sure this is actually one of our backup files
    if (!backup || typeof backup !== 'object' || !backup._meta ||
        backup._meta.app !== 'claude-exporter' || typeof backup.local !== 'object') {
      if (onComplete) onComplete(false, 'Restore failed: this does not look like a Claude Exporter backup file.');
      return;
    }

    const snapCount = Object.keys(backup.local.modelSnapshots || {}).length;
    const exportCount = Object.keys(backup.local.exportTimestamps || {}).length;
    const proceed = confirm(
      `Restore this backup?\n\n` +
      `It contains ${snapCount} model snapshot(s) and ${exportCount} export record(s), ` +
      `created ${backup._meta.createdAt || 'an unknown date'}.\n\n` +
      `This overwrites the extension's current data with the backup's contents.`
    );
    if (!proceed) {
      if (onComplete) onComplete(false, 'Restore cancelled.');
      return;
    }

    chrome.storage.local.set(backup.local, () => {
      const syncData = (backup.sync && typeof backup.sync === 'object') ? backup.sync : {};
      chrome.storage.sync.set(syncData, () => {
        if (onComplete) onComplete(true, `Restore complete — ${snapCount} model snapshot(s), ${exportCount} export record(s) restored. Reload any open Claude pages and the browse page to see the changes.`);
      });
    });
  };
  reader.readAsText(file);
}

// Functions are available globally in the browser context
// In Node (vitest), expose them via module.exports for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getCurrentBranch,
    convertToMarkdown,
    convertToText,
    downloadFile,
    extractArtifactsFromMessage,
    extractArtifactsFromText,
    extractArtifacts,
    getFileExtension,
    isProgrammingLanguage,
    convertArtifactFormat,
    extractArtifactFiles,
    DEFAULT_MODEL_TIMELINE,
    inferModel,
    formatModelName,
    getModelBadgeClass,
    backupExtensionData,
    restoreExtensionData,
  };
}
