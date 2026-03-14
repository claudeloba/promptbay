const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const taxonomyRoot = path.join(projectRoot, 'pentest-taxonomy');
const outputPath = path.join(projectRoot, 'js', 'payloadAssets.js');
const allowedExtensions = new Set(['.md', '.txt']);

function toPosixPath(filePath) {
    return filePath.split(path.sep).join('/');
}

function humanize(value) {
    return value
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (match) => match.toUpperCase());
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function stripMarkdown(content) {
    return content
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^>\s?/gm, '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[*_~]/g, '')
        .replace(/\r/g, '')
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildExcerpt(content, maxLength = 220) {
    const plain = stripMarkdown(content);
    if (!plain) return '';
    return plain.slice(0, maxLength).trim();
}

function deriveTitle(filePath, content) {
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch && headingMatch[1]) {
        return headingMatch[1].trim();
    }
    return humanize(path.basename(filePath));
}

function parseSections(content) {
    const lines = content.replace(/\r/g, '').split('\n');
    const sections = [];
    const stack = [];
    let current = null;

    function finalizeCurrent() {
        if (!current) return;
        const body = current.bodyLines.join('\n').trim();
        sections.push({
            level: current.level,
            title: current.title,
            parents: current.parents.slice(),
            body
        });
    }

    for (const line of lines) {
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (!headingMatch) {
            if (current) {
                current.bodyLines.push(line);
            }
            continue;
        }

        finalizeCurrent();

        const level = headingMatch[1].length;
        const title = headingMatch[2].trim();

        while (stack.length && stack[stack.length - 1].level >= level) {
            stack.pop();
        }

        current = {
            level,
            title,
            parents: stack.map((item) => item.title),
            bodyLines: []
        };

        stack.push({ level, title });
    }

    finalizeCurrent();
    return sections;
}

function extractExampleContent(body) {
    const lines = body.split('\n');
    const firstFenceIndex = lines.findIndex((line) => /^```/.test(line.trim()));
    if (firstFenceIndex === -1) {
        return {
            content: body.trim(),
            description: '',
            language: ''
        };
    }

    let lastFenceIndex = -1;
    for (let index = lines.length - 1; index > firstFenceIndex; index -= 1) {
        if (/^```/.test(lines[index].trim())) {
            lastFenceIndex = index;
            break;
        }
    }

    const openingFence = lines[firstFenceIndex].trim();
    const language = openingFence.replace(/^```/, '').trim();
    const description = lines.slice(0, firstFenceIndex).join('\n').trim();

    if (lastFenceIndex === -1) {
        return {
            content: lines.slice(firstFenceIndex + 1).join('\n').trim(),
            description,
            language
        };
    }

    return {
        content: lines.slice(firstFenceIndex + 1, lastFenceIndex).join('\n').trim(),
        description,
        language
    };
}

function extractSnippets(fileAsset) {
    const sections = parseSections(fileAsset.content);
    let snippetIndex = 0;

    return sections
        .filter((section) => /\bExample\b/i.test(section.title))
        .map((section) => {
            const { content, description, language } = extractExampleContent(section.body);
            if (!content) {
                return null;
            }

            snippetIndex += 1;
            const groupTitle = [...section.parents].reverse().find((parent) => !/\bExample\b/i.test(parent)) || '';
            const title = section.title.replace(/\s+/g, ' ').trim();

            return {
                id: `${fileAsset.id}-snippet-${snippetIndex}-${slugify(title) || snippetIndex}`,
                title,
                groupTitle,
                sourceTitle: fileAsset.title,
                filename: fileAsset.filename,
                relPath: fileAsset.relPath,
                excerpt: buildExcerpt(content, 180),
                description: buildExcerpt(description, 180),
                language,
                content
            };
        })
        .filter(Boolean);
}

function readAsset(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const relativePath = toPosixPath(path.relative(projectRoot, filePath));
    const taxonomyRelativePath = toPosixPath(path.relative(taxonomyRoot, filePath));
    const filename = path.basename(filePath);

    const asset = {
        id: taxonomyRelativePath
            .replace(/\.[^.]+$/, '')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase(),
        title: deriveTitle(filePath, content),
        filename,
        relPath: relativePath,
        excerpt: buildExcerpt(content),
        content,
        snippets: []
    };

    asset.snippets = extractSnippets(asset);
    asset.snippetCount = asset.snippets.length;
    return asset;
}

function walk(directoryPath, collected) {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            walk(entryPath, collected);
            continue;
        }

        const extension = path.extname(entry.name).toLowerCase();
        if (!allowedExtensions.has(extension)) continue;
        if (/^readme\./i.test(entry.name)) continue;

        collected.push(entryPath);
    }
}

if (!fs.existsSync(taxonomyRoot)) {
    console.log(`Taxonomy directory not found: ${taxonomyRoot} — skipping generation (using existing payloadAssets.js)`);
    process.exit(0);
}

const files = [];
walk(taxonomyRoot, files);

const folderMap = new Map();
const openSourceTexts = [];

for (const filePath of files) {
    const asset = readAsset(filePath);
    const relativeToTaxonomy = toPosixPath(path.relative(taxonomyRoot, filePath));
    const segments = relativeToTaxonomy.split('/');

    if (segments.length === 1 && /-attacks?\.md$/i.test(path.basename(filePath))) {
        const folderId = path.basename(filePath, path.extname(filePath));
        if (!folderMap.has(folderId)) {
            folderMap.set(folderId, {
                id: folderId,
                title: humanize(folderId),
                templates: []
            });
        }

        folderMap.get(folderId).templates.push(asset);
        continue;
    }

    if (segments.length === 1) {
        openSourceTexts.push(asset);
        continue;
    }

    const folderId = segments[0];
    if (!folderMap.has(folderId)) {
        folderMap.set(folderId, {
            id: folderId,
            title: humanize(folderId),
            templates: []
        });
    }

    folderMap.get(folderId).templates.push(asset);
}

const taxonomyFolders = Array.from(folderMap.values())
    .sort((left, right) => left.title.localeCompare(right.title))
    .map((folder) => ({
        ...folder,
        templates: folder.templates.sort((left, right) => left.title.localeCompare(right.title)),
        snippetCount: folder.templates.reduce((total, template) => total + template.snippetCount, 0)
    }));

openSourceTexts.sort((left, right) => left.title.localeCompare(right.title));

const payloadAssets = {
    taxonomyFolders,
    openSourceTexts
};

const output = [
    '// Generated by scripts/generate-payload-assets.js',
    '(function attachPayloadAssets() {',
    `    window.payloadAssets = ${JSON.stringify(payloadAssets, null, 4)};`,
    '}());',
    ''
].join('\n');

fs.writeFileSync(outputPath, output, 'utf8');
console.log(`Wrote ${outputPath}`);
