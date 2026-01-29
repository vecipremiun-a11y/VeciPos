const fs = require('fs');
const path = 'src/store/useStore.js';
console.log('Reading file...');
try {
    let content = fs.readFileSync(path, 'utf8');
    // Note: view_file showed exactly this string.
    // However, we must be careful about spaces which might not be visible or copy-pasted correctly.
    // I will use a more robust replacement if exact match fails, but let's try exact first.
    const search = 'args.push(`% ${ searchTerm } % `, ` % ${ searchTerm } % `);';
    const replace = 'args.push(`%${searchTerm}%`, `%${searchTerm}%`);';

    if (content.indexOf(search) !== -1) {
        console.log('Found string, replacing...');
        content = content.replace(search, replace);
        fs.writeFileSync(path, content, 'utf8');
        console.log('File written successfully.');
    } else {
        console.log('String NOT found.');

        // Debugging what is there
        const lines = content.split(/\r?\n/);
        // Find line containing 'searchTerm' and 'args.push'
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('args.push') && lines[i].includes('searchTerm')) {
                console.log(`Found similar line at ${i + 1}:`);
                console.log(`"${lines[i]}"`);
                // Try to match it?
            }
        }
    }
} catch (e) {
    console.error('Error:', e);
}
