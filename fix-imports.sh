#!/bin/bash

# Fix missing .js extensions in TypeScript imports for ES modules
# This script adds .js extensions to relative imports that are missing them

echo "Fixing ES module imports by adding missing .js extensions..."

cd "$(dirname "$0")/container_src/src"

# Find all TypeScript files and fix relative imports missing .js extension
find . -name "*.ts" -type f | while read -r file; do
    echo "Processing: $file"
    
    # Fix imports that start with ./ or ../ and don't end with .js
    sed -i '' -E "s|from ['\"]([.][^'\"]*[^.js])['\"]|from '\1.js'|g" "$file"
    
    # Fix export statements too
    sed -i '' -E "s|export \* from ['\"]([.][^'\"]*[^.js])['\"]|export * from '\1.js'|g" "$file"
done

echo "Fixed all TypeScript import statements!"
echo "Now rebuild the container with: cd container_src && npm run build"