# ThePromptBay — Pentest Prompt Editor

A web-based toolkit for AI security research and red-teaming. Build, transform, encode, and mutate prompts using dozens of text transforms, steganography, fuzzing tools, and more.

## Features

### Payload Editor
- Rich contenteditable editor with undo/redo
- Snippet sidebar with searchable pentest taxonomy (affective attacks, authority attacks, framing attacks, etc.)
- Inline selection popup for quick transforms (Base64, L33t, Reverse, ROT13, Invisible)
- Book insertion with word-range slicing and split-around-cursor mode
- End sequences library
- Word, character, and token metrics

### Transform
50+ text transforms organized by category — encodings (Base64, Hex, Binary, ASCII85, URL), ciphers (ROT13, ROT47, Caesar, Vigenere, Atbash, Rail Fence), visual styles (Upside Down, Full Width, Small Caps, Bubble, Braille, Zalgo), Unicode scripts (Medieval, Cursive, Fraktur, Monospace, Double-Struck, Greek, Cyrillic), fantasy languages (Quenya, Tengwar, Klingon, Aurebesh, Dovahzul), ancient scripts (Elder Futhark, Hieroglyphics, Ogham), and more.

### Emoji Steganography
Hide secret messages inside emoji using Unicode variation selectors. Encode and decode.

### Tokenade Generator
Generate nested emoji token bombs with configurable depth, breadth, separators, and variation selectors.

### Mutation Lab
Fuzzer that generates mutated payload variants with zero-width chars, Unicode noise, whitespace injection, random casing, and Zalgo.

### Tokenizer
Visualize how text gets split into tokens (byte-level UTF-8 or naive word splitting).

### Bijection Attack Generator
Create custom encoded languages for AI safety research. Character-to-number, symbol, hex, emoji, Greek, and mixed mappings with configurable attack budgets.

### Syntactic Anti-Classifier
Use OpenAI API to transform prompts via synonym substitution, bypassing content filters while preserving semantic meaning.

### Gibberish Generator
Generate gibberish dictionaries with deterministic seed-based mapping, or remove characters (random or specific) from text.

### Message Splitter
Split text into multiple copyable messages by character chunks or word splitting, with optional transforms and encapsulation.

### Universal Decoder
Auto-detect and decode encoded text. Tries all reversible transforms with priority ordering, shows alternatives, and supports manual mode selection.

## Getting Started

### Docker

```bash
docker build -t thepromptbay .
docker run -d -p 8080:80 --name thepromptbay thepromptbay
# Open http://localhost:8080
```

### Local

Open `index.html` in any modern browser. No build step required — all assets are pre-generated.

### Regenerating Assets

If you have a `pentest-taxonomy/` directory with markdown payload files:

```bash
node scripts/generate-payload-assets.js
```

If you have books in `books/`:

```bash
node scripts/generate-books-data.js
```

## Adding a New Transform

1. Define it in `js/transforms.js`:

```js
new_transform_key: {
    name: 'Human Friendly Name',
    func: function(text) { /* return transformed */ },
    reverse: function(text) { /* return decoded */ }
}
```

2. The transform grid in the Transform tab auto-populates from `window.transforms`.

3. If it has a `reverse()` function, the Universal Decoder will automatically try it during auto-detection.

## License

See LICENSE file for details.
