/**
 * Quick test script to verify the sanitization function
 */

/**
 * Sanitizes a path segment (folder or file name) by removing invalid characters
 * and cleaning problematic characters at the end
 * @param pathSegment The path segment to sanitize
 * @returns Sanitized path segment
 */
function sanitizePathSegment(pathSegment: string): string {
  if (!pathSegment) return '';
  
  // Check if this segment has a file extension
  // Look for .md or any other typical file extensions at the end
  const extensionMatch = pathSegment.match(/(\.[a-zA-Z0-9]+)$/);
  let basename = pathSegment;
  let extension = '';
  
  if (extensionMatch) {
    extension = extensionMatch[0];
    basename = pathSegment.substring(0, pathSegment.length - extension.length);
  }
  
  // First, replace characters that are not allowed in file names
  let sanitized = basename.replace(/[*"\\/<>:|?]/g, '_');
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  // Remove periods and spaces at the end (which cause errors in Obsidian)
  sanitized = sanitized.replace(/[\s.]+$/, '');
  
  // Replace multiple spaces with a single space
  sanitized = sanitized.replace(/\s+/g, ' ');
  
  // Replace periods in the middle with underscores
  sanitized = sanitized.replace(/\./g, '_');
  
  // Replace commas with underscores
  sanitized = sanitized.replace(/,/g, '_');
  
  // If after all sanitization the string is empty, use a fallback
  if (!sanitized) {
    sanitized = 'unnamed';
  }
  
  // Add back the extension if it existed
  if (extension) {
    sanitized += extension;
  }
  
  return sanitized;
}

// Test cases
console.log('--- File Sanitization Tests ---');
console.log('Original: "Mindmixer_md" → Sanitized: "' + sanitizePathSegment('Mindmixer_md') + '"');
console.log('Original: "Mindmixer.md" → Sanitized: "' + sanitizePathSegment('Mindmixer.md') + '"');
console.log('Original: "Mind.mixer.md" → Sanitized: "' + sanitizePathSegment('Mind.mixer.md') + '"');
console.log('Original: "File with spaces.md" → Sanitized: "' + sanitizePathSegment('File with spaces.md') + '"');
console.log('Original: "File.with.dots.md" → Sanitized: "' + sanitizePathSegment('File.with.dots.md') + '"');
console.log('Original: "File.with.dots" → Sanitized: "' + sanitizePathSegment('File.with.dots') + '"');
console.log('Original: "Folder/File.md" → Sanitized: "' + sanitizePathSegment('Folder/File.md') + '"');
console.log('Original: "File.with.trailing.space " → Sanitized: "' + sanitizePathSegment('File.with.trailing.space ') + '"');
console.log('Original: "File.with.trailing.period." → Sanitized: "' + sanitizePathSegment('File.with.trailing.period.') + '"'); 