const fs = require('fs');
const path = require('path');

const booksDir = path.join(process.cwd(), 'books');
const outputIndex = path.join(process.cwd(), 'js', 'booksData.js');
const outputDir = path.join(process.cwd(), 'books-processed');

// Create output dir for individual book word files
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

function stripHtml(text) {
  return text
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const entries = fs.readdirSync(booksDir);
const books = [];

for (const entry of entries) {
  const fullPath = path.join(booksDir, entry);
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) continue;

  const ext = path.extname(entry).toLowerCase();
  if (ext !== '.txt' && ext !== '.html') continue;

  let content = fs.readFileSync(fullPath, 'utf-8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  if (ext === '.html') content = stripHtml(content);
  content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const wordCount = content.split(/\s+/).filter(Boolean).length;
  if (wordCount < 10) continue;

  const name = entry.replace(/\.[^.]+$/, '').replace(/\s+/g, ' ').trim();
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Write the full text to a separate file
  fs.writeFileSync(path.join(outputDir, id + '.txt'), content, 'utf-8');

  books.push({ id, name, wordCount });
}

books.sort((a, b) => a.name.localeCompare(b.name));

const js = 'window.booksData = ' + JSON.stringify(books) + ';\n';
fs.writeFileSync(outputIndex, js, 'utf-8');

console.log(`Generated index: ${books.length} books → ${outputIndex}`);
console.log(`Book texts → ${outputDir}/`);
books.forEach(b => console.log(`  ${b.id}.txt  (${b.wordCount.toLocaleString()} words)`));
