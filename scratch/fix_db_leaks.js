const fs = require('fs');
const path = require('path');

function fixFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Pattern to match:
    // const client = await this.db.pool.connect();
    // const result = await client.query(...);
    // client.release();
    
    // Replace single queries
    content = content.replace(/const\s+client\s*=\s*await\s+this\.db\.pool\.connect\(\);\s*const\s+result\s*=\s*await\s+client\.query\((.*?)\);\s*client\.release\(\);/g, 
        'const result = await this.db.pool.query($1);');
        
    // Sometimes there's an intermediate variable, let's just do a more generic replacement
    // Wait, the regex above handles multiline if we use [\s\S]*? but let's be careful.
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Fixed ${filePath}`);
}

const modelsDir = path.join(__dirname, '../models');
const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.js'));

for (const file of files) {
    let filePath = path.join(modelsDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace:
    // const client = await this.db.pool.connect();
    // const result = await client.query(...);
    // client.release();
    
    // This regex works for the standard block:
    const regex = /const client = await this\.db\.pool\.connect\(\);[\s\S]*?const (.*?) = await client\.query\((.*?)\);[\s\S]*?client\.release\(\);/g;
    content = content.replace(regex, 'const $1 = await this.db.pool.query($2);');
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Processed ${file}`);
}
