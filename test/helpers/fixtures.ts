/**
 * Shared test fixtures and data
 */

// ============================================================================
// Step Content Fixtures (for parser tests)
// ============================================================================

/**
 * Sample step content with valid frontmatter
 */
export const SAMPLE_STEP_WITH_FRONTMATTER = `---
id: fetch
description: Fetch the article details
tool: http_get
---

Fetch the article with ID {{ article_id }} and return its details.

Include the following information:
- Summary
- Description
- Status
- Priority
`;

/**
 * Sample step content without frontmatter
 */
export const SAMPLE_STEP_NO_FRONTMATTER = `
Analyze the article and provide a summary.

Article details:
{{ article.summary }}

Status: {{ article.status }}
`;

/**
 * Sample step with tools list in frontmatter
 */
export const SAMPLE_STEP_WITH_TOOLS = `---
id: analyze
description: Analyze using multiple tools
tools:
  - web_search
  - http_get
toolMode: auto
---

Search for related content and documentation.
`;

/**
 * Empty step content
 */
export const SAMPLE_STEP_EMPTY = '';

/**
 * Step with malformed YAML in frontmatter
 */
export const SAMPLE_STEP_MALFORMED_YAML = `---
invalid: yaml: content: here
  bad indentation
---

Body content after malformed frontmatter.
`;

// ============================================================================
// Template Fixtures (for interpolation tests)
// ============================================================================

export const TEMPLATE_SAMPLES = {
    // Simple variables
    simpleVar: 'Hello {{ name }}!',
    multipleVars: '{{ greeting }} {{ name }}, your ID is {{ id }}',

    // Nested paths
    nestedPath: 'Article: {{ article.summary }} ({{ article.status }})',
    deepNested: '{{ report.metadata.author.name }}',

    // With filters
    withFilter: '{{ name | upcase }}',
    multipleFilters: '{{ items | size }} items: {{ name | downcase }}',

    // Conditionals
    simpleIf: '{% if status == "open" %}OPEN{% else %}CLOSED{% endif %}',
    nestedIf: '{% if flag %}{% if nested %}both{% endif %}{% endif %}',

    // Loops
    simpleLoop: '{% for item in items %}{{ item }}{% endfor %}',
    loopWithIndex: '{% for item in items %}{{ forloop.index }}: {{ item }}\n{% endfor %}',

    // No variables
    noVars: 'Just plain text with no variables',

    // Edge cases
    emptyTemplate: '',
    onlyWhitespace: '   \n\t  ',
    duplicateVars: '{{ name }} and {{ name }} again',
};

// ============================================================================
// Confirmation Options Fixtures (for executor tests)
// ============================================================================

export const CONFIRMATION_OPTIONS_SAMPLES = {
    simple: [
        { label: 'Continue', action: 'continue' as const },
        { label: 'Cancel', action: 'abort' as const },
    ],
    withGoto: [
        { label: 'Continue', action: 'continue' as const },
        { label: 'Retry', action: 'goto' as const, gotoStep: 'step-1' },
        { label: 'Cancel', action: 'abort' as const },
    ],
    multipleOptions: [
        { label: 'Option A', action: 'continue' as const },
        { label: 'Option B', action: 'continue' as const },
        { label: 'Option C', action: 'continue' as const },
        { label: 'Abort', action: 'abort' as const },
    ],
};
