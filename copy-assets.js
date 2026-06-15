/**
 * Cross-platform asset copy script
 * Copies required vendor files to the media/ directory for the extension
 */
const fs = require('fs');
const path = require('path');

const mediaDir = path.join(__dirname, 'media');

// Ensure media directory exists (recursive: true = like mkdir -p)
fs.mkdirSync(mediaDir, { recursive: true });

const assets = [
  'node_modules/mermaid/dist/mermaid.min.js',
  'node_modules/svg-pan-zoom/dist/svg-pan-zoom.min.js'
];

for (const asset of assets) {
  const src = path.join(__dirname, asset);
  const dest = path.join(mediaDir, path.basename(asset));

  if (!fs.existsSync(src)) {
    console.error(`Missing asset: ${asset}`);
    console.error('Run "npm install" first.');
    process.exit(1);
  }

  fs.copyFileSync(src, dest);
}

console.log(`Copied ${assets.length} assets to media/`);
