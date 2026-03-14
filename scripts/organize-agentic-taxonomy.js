const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const taxonomyRoot = path.join(projectRoot, 'pentest-taxonomy');
const promptfooPentestPath = path.join(projectRoot, 'pentest-snippets.md');
const owaspSourceOnePath = path.join(projectRoot, 'owasp-agentic-snippets.md');
const owaspSourceTwoPath = path.join(projectRoot, 'owasp-agentic-snippets-v2.md');
const owaspFolderPath = path.join(taxonomyRoot, 'OWASP Top 10 for Agentic Applications');

const promptfooTargets = {
    'affective-attacks': 'affective-attacks/emotional-coercion.md',
    'authority-attacks': 'authority-attacks/authority-spoofing.md',
    'authorship-attacks': 'authorship-attacks/authorship-displacement.md',
    'channel-provenance-attacks': 'channel-provenance-attacks/trust-boundary_confusion.md',
    'framing-attacks': 'framing-attacks/frame_capture.md',
    'gaslight-attacks': 'gaslight-attacks/everything-is-harmful.md',
    'identity-roles-attacks': 'identity-roles-attacks/persona-remapping.md',
    'legitimacy-attacks': 'legitimacy-attacks/legitimacy-laundering.md',
    'multilayered-attacks': 'multilayered-attacks.md',
    'output-attacks': 'output-attacks/schema-locked_output.md',
    'payload-shaping-attacks': 'payload-shaping-attacks/payload-hiding.md',
    'refusal-attacks': 'refusal-attacks/anti-refusal_prompting.md',
    'structure-examples': 'authority-attacks/control-plane_impersonation.md',
    'task-attacks': 'task-attacks/task_displacement.md',
    'thinking-attacks': 'thinking-attacks/deep-research-on-thinking-models.md',
    'threat-attacks': 'threat-attacks/theats-of-shutdown.md',
    'faux-data-poisoning': 'faux-data-poisioning.md'
};

const owaspSpecs = [
    {
        id: 'ASI01',
        title: 'Agent Goal Hijack',
        description: 'Attackers alter agent objectives through malicious content',
        filename: 'agent-goal-hijack.md'
    },
    {
        id: 'ASI02',
        title: 'Tool Misuse and Exploitation',
        description: 'Agents use legitimate tools in unsafe ways',
        filename: 'tool-misuse-and-exploitation.md'
    },
    {
        id: 'ASI03',
        title: 'Identity and Privilege Abuse',
        description: 'Agents inherit or escalate high-privilege credentials',
        filename: 'identity-and-privilege-abuse.md'
    },
    {
        id: 'ASI04',
        title: 'Agentic Supply Chain Vulnerabilities',
        description: 'Compromised tools, plugins, or external components',
        filename: 'agentic-supply-chain-vulnerabilities.md'
    },
    {
        id: 'ASI05',
        title: 'Unexpected Code Execution',
        description: 'Agents generate or run code/commands unsafely',
        filename: 'unexpected-code-execution.md'
    },
    {
        id: 'ASI06',
        title: 'Memory and Context Poisoning',
        description: 'Attackers poison agent memory systems and RAG databases',
        filename: 'memory-and-context-poisoning.md'
    },
    {
        id: 'ASI07',
        title: 'Insecure Inter-Agent Communication',
        description: 'Multi-agent systems face spoofing and tampering',
        filename: 'insecure-inter-agent-communication.md'
    },
    {
        id: 'ASI08',
        title: 'Cascading Failures',
        description: 'Small errors propagate across planning and execution',
        filename: 'cascading-failures.md'
    },
    {
        id: 'ASI09',
        title: 'Human Agent Trust Exploitation',
        description: 'Users over-trust agent recommendations',
        filename: 'human-agent-trust-exploitation.md'
    },
    {
        id: 'ASI10',
        title: 'Rogue Agents',
        description: 'Compromised agents act harmfully while appearing legitimate',
        filename: 'rogue-agents.md'
    }
];

function readText(filePath) {
    return fs.readFileSync(filePath, 'utf8').replace(/\r/g, '');
}

function ensureDirectory(directoryPath) {
    fs.mkdirSync(directoryPath, { recursive: true });
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bumpHeadings(markdown, amount) {
    return markdown.replace(/^(#{1,6})\s+/gm, (_, hashes) => `${'#'.repeat(Math.min(6, hashes.length + amount))} `);
}

function parsePromptfooPentestSnippets(markdown) {
    const categoryPattern = /^## ([^\n]+)\n\n([\s\S]*?)(?=^---\n\n## |\n\*Generated|\Z)/gm;
    const categories = new Map();
    let match;

    while ((match = categoryPattern.exec(markdown))) {
        const category = match[1].trim();
        const body = match[2].trim();
        const descriptionMatch = body.match(/^([^\n]+)\n\n/);
        const description = descriptionMatch ? descriptionMatch[1].trim() : '';
        const examples = Array.from(body.matchAll(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g))
            .map((exampleMatch) => exampleMatch[1].trim())
            .filter(Boolean);

        categories.set(category, {
            description,
            examples
        });
    }

    return categories;
}

function renderPromptfooSection(category, details) {
    const lines = [
        '<!-- GENERATED: promptfoo-pentest-snippets:start -->',
        '## Promptfoo Pentest Snippet Examples',
        '',
        details.description || `Examples imported from \`pentest-snippets.md\` for \`${category}\`.`,
        ''
    ];

    details.examples.forEach((example, index) => {
        lines.push(`### Example ${index + 1}`);
        lines.push('');
        lines.push('```text');
        lines.push(example);
        lines.push('```');
        lines.push('');
    });

    lines.push('<!-- GENERATED: promptfoo-pentest-snippets:end -->');
    return `${lines.join('\n').trim()}\n`;
}

function upsertPromptfooSection(filePath, section) {
    const startMarker = '<!-- GENERATED: promptfoo-pentest-snippets:start -->';
    const endMarker = '<!-- GENERATED: promptfoo-pentest-snippets:end -->';
    const replacePattern = new RegExp(`${escapeRegex(startMarker)}[\\s\\S]*?${escapeRegex(endMarker)}\\n?`, 'm');
    const existing = readText(filePath).trimEnd();
    const updated = replacePattern.test(existing)
        ? existing.replace(replacePattern, section.trimEnd())
        : `${existing}\n\n${section.trimEnd()}`;

    fs.writeFileSync(filePath, `${updated}\n`, 'utf8');
}

function splitOwaspSections(markdown) {
    const headingMatches = Array.from(markdown.matchAll(/^# (ASI\d{2}): ([^\n]+)$/gm));
    const sections = new Map();

    headingMatches.forEach((match, index) => {
        const start = match.index + match[0].length;
        const end = index + 1 < headingMatches.length ? headingMatches[index + 1].index : markdown.length;
        let body = markdown.slice(start, end).trim();

        body = body.replace(/\n---\s*$/, '').trim();
        body = body.replace(/\n\*Source:[\s\S]*$/, '').trim();
        body = body.replace(/\n\*Built for[\s\S]*$/, '').trim();
        body = body.replace(/\n\*All snippets assume[\s\S]*$/, '').trim();

        sections.set(match[1], {
            title: match[2].trim(),
            body
        });
    });

    return sections;
}

function renderOwaspFile(spec, firstSourceSection, secondSourceSection) {
    const lines = [
        `# ${spec.title}`,
        '',
        `*${spec.description}*`,
        ''
    ];

    if (firstSourceSection) {
        lines.push('## Source: owasp-agentic-snippets.md');
        lines.push('');
        lines.push(bumpHeadings(firstSourceSection.body, 1).trim());
        lines.push('');
    }

    if (secondSourceSection) {
        lines.push('## Source: owasp-agentic-snippets-v2.md');
        lines.push('');
        lines.push(bumpHeadings(secondSourceSection.body, 1).trim());
        lines.push('');
    }

    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function main() {
    const promptfooPentest = parsePromptfooPentestSnippets(readText(promptfooPentestPath));

    Object.entries(promptfooTargets).forEach(([category, targetRelativePath]) => {
        const details = promptfooPentest.get(category);
        if (!details || !details.examples.length) {
            return;
        }

        const targetPath = path.join(taxonomyRoot, targetRelativePath);
        upsertPromptfooSection(targetPath, renderPromptfooSection(category, details));
    });

    ensureDirectory(owaspFolderPath);

    const owaspSourceOne = splitOwaspSections(readText(owaspSourceOnePath));
    const owaspSourceTwo = splitOwaspSections(readText(owaspSourceTwoPath));

    owaspSpecs.forEach((spec) => {
        const outputPath = path.join(owaspFolderPath, spec.filename);
        const fileContent = renderOwaspFile(
            spec,
            owaspSourceOne.get(spec.id),
            owaspSourceTwo.get(spec.id)
        );
        fs.writeFileSync(outputPath, fileContent, 'utf8');
    });

    console.log(`Updated promptfoo mappings and OWASP agentic files in ${taxonomyRoot}`);
}

main();
